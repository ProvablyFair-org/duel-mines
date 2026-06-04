/**
 * Duel.com Mines — RNG implementation.
 *
 * Algorithm: backward Fisher-Yates shuffle with per-step rejection sampling.
 * Same pattern as Duel Keno but on a 25-tile grid instead of 40.
 *
 *   positions = [0, 1, ..., 24]
 *   for i from 24 downto 1:
 *     cursor = 24 - i
 *     range  = i + 1
 *     maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)
 *     loop:
 *       hash = HMAC-SHA256(key=hex_bytes(serverSeed), msg=clientSeed:nonce:cursor)
 *       scan 4-byte chunks of hash:
 *         if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break
 *       else cursor++ and retry
 *   mine_positions = positions[0..mineCount-1]
 *
 * Key encoding: Buffer.from(serverSeed, 'hex') — hex-decoded bytes, NOT UTF-8.
 * Output: mine position SET is deterministic; order in API may vary.
 */

import * as crypto from 'crypto';

const GRID_SIZE  = 25;
const MAX_UINT32 = 0xFFFFFFFF;

export function computeMinePositionsFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  mineCount: number,
  gridSize = GRID_SIZE,
): number[] {
  const positions: number[] = Array.from({ length: gridSize }, (_, i) => i);

  for (let i = gridSize - 1; i > 0; i--) {
    const range   = i + 1;
    const maxFair = MAX_UINT32 - (MAX_UINT32 % range);
    let cursor    = gridSize - 1 - i;

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;
      const hmac    = crypto.createHmac('sha256', keyBuffer).update(message).digest('hex');
      let found     = false;

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

  return positions.slice(0, mineCount).sort((a, b) => a - b);
}

export function computeMinePositions(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  mineCount: number,
  gridSize = GRID_SIZE,
): number[] {
  const key = Buffer.from(serverSeed, 'hex');
  return computeMinePositionsFromBuffer(key, clientSeed, nonce, mineCount, gridSize);
}

/** SHA-256 commit-reveal: verify SHA-256(hex_bytes(serverSeed)) === serverSeedHashed */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  const seedBytes = Buffer.from(serverSeed, 'hex');
  const computed  = crypto.createHash('sha256').update(seedBytes).digest('hex');
  return computed === serverSeedHashed;
}

/**
 * Multiplier formula: C(n,k) / C(n-m,k) × (1 - house_edge)
 * n = grid_size (25), m = mines_count, k = reveals so far
 */
export function theoreticalMultiplier(mineCount: number, reveals: number, houseEdge = 0.001): number {
  const n = GRID_SIZE;
  const m = mineCount;
  const k = reveals;
  return comb(n, k) / comb(n - m, k) * (1 - houseEdge);
}

/** Win chance for next reveal: (n - m - k) / (n - k) */
export function winChance(mineCount: number, revealsSoFar: number): number {
  const n = GRID_SIZE;
  return (n - mineCount - revealsSoFar) / (n - revealsSoFar);
}

/** Binomial coefficient C(n, k) */
function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return result;
}
