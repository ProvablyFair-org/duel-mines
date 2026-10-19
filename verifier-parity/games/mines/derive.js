import { hmacSha256Hex, hexToBytes } from '../../lib/hmac-sha256';

/**
 * Mines RNG — port of Duel's HMAC-SHA256 + Fisher-Yates shuffle algorithm.
 *
 * Source of truth (audit repo):
 *   https://github.com/ProvablyFair-org/duel-mines/blob/main/src/rng.ts
 *
 * Same shuffle pattern as Keno but on a 25-tile grid (5×5) instead of 40.
 *
 * Algorithm:
 *
 *   positions = [0, 1, ..., 24]
 *   for i from 24 down to 1:
 *     range   = i + 1
 *     maxFair = MAX_U32 - (MAX_U32 % range)
 *     cursor  = 24 - i
 *     loop:
 *       hash = HMAC-SHA256(hexBytes(serverSeed), `${clientSeed}:${nonce}:${cursor}`)
 *       scan 4-byte chunks of hash:
 *         if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break
 *       else cursor++ and retry
 *   minePositions = positions[0..mineCount-1]   (0-indexed, sorted ascending)
 *
 * Multiplier formula (no paytable; pure combinatoric):
 *
 *   raw     = C(25, k) / C(25 - m, k)              where m = mines, k = reveals
 *   payout  = raw × 0.999                          ← what Duel actually pays
 *
 * Naming caveat: Duel's API field 'multiplier' returns the raw (no-edge) value
 * and 'no_house_edge_multiplier' confusingly returns the edged (paid) value.
 * The verifier reports the edged/paid figure since that's what the user
 * actually got in their balance.
 *
 * Verified against all 6,500 captured mines bets in the audit dataset:
 *   - mine positions: 6500 / 6500
 *   - paid multipliers (over 2,795 winning bets): 2795 / 2795
 */

const GRID_SIZE = 25;
const MAX_U32 = 0xffffffff;
const HOUSE_EDGE_FACTOR = 0.999;

/**
 * Derive a single Mines bet outcome.
 *
 * Note: Mines doesn't take "picks" the way Keno does — the user's gameplay
 * (which tiles they click, when they cash out) isn't part of the seed
 * derivation. The verifier proves the mine layout is what the casino said
 * it was; how the user played that layout is independent.
 *
 * @param {Object} p
 * @param {string} p.clientSeed
 * @param {string} p.serverSeed
 * @param {number} p.nonce
 * @param {number} p.mineCount     1..24
 *
 * @returns {{
 *   minePositions: number[],       // 0-indexed tile indices, sorted ascending
 *   safePositions: number[],       // the other 25 - mineCount tiles
 *   mineCount: number,
 *   firstHmac: string,
 *   cashoutCurve: Array<{reveals: number, multiplier: number}>
 *                                  // For each k = 1..(25 - mineCount), the
 *                                  // payout multiplier IF the user revealed
 *                                  // k safe tiles and cashed out. Lets the
 *                                  // user reconcile with whatever cashout
 *                                  // they made on Duel without us needing
 *                                  // to model their click sequence.
 * }}
 */
export function deriveMines({ clientSeed, serverSeed, nonce, mineCount }) {
  const key = seedKey(serverSeed);
  const positions = Array.from({ length: GRID_SIZE }, (_, i) => i);
  let firstHmac = '';

  for (let i = GRID_SIZE - 1; i > 0; i--) {
    const range = i + 1;
    const maxFair = MAX_U32 - (MAX_U32 % range);
    let cursor = GRID_SIZE - 1 - i;

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;
      const hmac = hmacSha256Hex(key, message);
      if (cursor === 0 && firstHmac === '') firstHmac = hmac;

      let found = false;
      for (let off = 0; off + 8 <= hmac.length; off += 8) {
        const value = parseInt(hmac.substring(off, off + 8), 16);
        if (value < maxFair) {
          const j = value % range;
          [positions[i], positions[j]] = [positions[j], positions[i]];
          found = true;
          break;
        }
      }
      if (found) break;
      cursor++;
    }
  }

  const minePositions = positions.slice(0, mineCount).sort((a, b) => a - b);
  const mineSet = new Set(minePositions);
  const safePositions = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    if (!mineSet.has(i)) safePositions.push(i);
  }

  // Cashout curve — multiplier for each possible reveal count
  const maxReveals = GRID_SIZE - mineCount;
  const cashoutCurve = [];
  for (let k = 1; k <= maxReveals; k++) {
    cashoutCurve.push({
      reveals: k,
      multiplier: cashoutMultiplier(mineCount, k),
    });
  }

  return {
    minePositions,
    safePositions,
    mineCount,
    firstHmac,
    cashoutCurve,
  };
}

/**
 * Paid cashout multiplier for `reveals` safe-tile reveals at a given mine count.
 *
 *   raw    = C(25, reveals) / C(25 - mines, reveals)
 *   paid   = raw * 0.999
 *
 * Returns 0 if `reveals` exceeds the maximum possible safe count.
 */
export function cashoutMultiplier(mineCount, reveals) {
  if (reveals < 1) return 0;
  const safeTiles = GRID_SIZE - mineCount;
  if (reveals > safeTiles) return 0;
  return (combination(GRID_SIZE, reveals) / combination(safeTiles, reveals)) * HOUSE_EDGE_FACTOR;
}

function combination(n, k) {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function seedKey(serverSeed) {
  if (isHex(serverSeed)) return hexToBytes(serverSeed);
  return utf8Bytes(serverSeed);
}

function isHex(s) {
  return typeof s === 'string' && s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

function utf8Bytes(s) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}

export const MINES_GRID_SIZE = GRID_SIZE;
export const MINES_MIN = 1;
export const MINES_MAX = 24;
