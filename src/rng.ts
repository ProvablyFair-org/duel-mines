/**
 * Duel.com Mines — RNG implementation.
 *
 * PORTED FROM THE OPERATOR'S OWN SOURCE: the Mines code panel of duel.com → Provably Fair → Verify
 * (Expand → Copy), copied verbatim by Paulo on 2026-09-25 to
 * evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js (SHA-256 88f5268b…cff592, pinned in
 * src/operator-verifier.ts). "Lxx" below is a line of that file. Every citation is listed in
 * OPERATOR_SOURCE_CITES and checked against the pinned bytes by Step 5 and the unit tests — a cited
 * line that does not carry the quoted text FAILs. Step 5 also EXECUTES that file on every captured
 * round and requires its mine set to equal this module's and the served one.
 *
 * Algorithm: backward Fisher-Yates shuffle with per-step rejection sampling.
 *
 *   positions = [0, 1, ..., 24]                                                   L50
 *   for i from 24 downto 1:                                                       L53
 *     range  = i + 1                                                              L54
 *     maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)                                 L49, L55
 *     cursor = 24 - i                                                             L56
 *     loop:
 *       hash = HMAC-SHA256(key=hex_bytes(serverSeed), msg=clientSeed:nonce:cursor) L30, L36, L62
 *       scan 4-byte chunks (8 hex chars) of hash, first to last:                  L66, L67
 *         if chunk < maxFair → j = chunk % range; swap positions[i] ↔ positions[j]; break   L68–L70
 *       else cursor++ and retry                                                   L77
 *   mine_positions = positions[0..mineCount-1], sorted ascending                  L82
 *
 * Key encoding: Buffer.from(serverSeed, 'hex') — hex-decoded bytes, NOT UTF-8 (operator L30, hexToBytes).
 * Output: mine position SET is deterministic; order in API may vary.
 *
 * NOT in the operator file: the commitment encoding (verifyHash below — SHA-256 of the hex-decoded
 * seed). It is established from the capture (Step 1: every revealed seed hashes to its commitment),
 * not from operator source.
 */

import * as crypto from 'crypto';

// ── Operator source citations (checked, not decorative) ────────────────────
/**
 * Each entry: a line of evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js and text that line
 * must contain verbatim. src/operator-verifier.ts checkOperatorCites reads the pinned file and FAILs
 * any entry whose line does not carry its text.
 */
export const OPERATOR_SOURCE_CITES: ReadonlyArray<{ line: number; text: string; ports: string }> = Object.freeze([
  { line: 30, text: 'const keyBytes = hexToBytes(keyHex);', ports: 'the server seed is hex-decoded to the HMAC key' },
  { line: 36, text: "{ name: 'HMAC', hash: 'SHA-256' },", ports: 'HMAC-SHA256' },
  { line: 49, text: 'const MAX_UINT32 = 0xFFFFFFFF;', ports: 'MAX_UINT32' },
  { line: 50, text: 'const positions = Array.from({ length: gridSize }, (_, i) => i);', ports: 'positions = [0 … gridSize − 1]' },
  { line: 53, text: 'for (let i = gridSize - 1; i > 0; i--) {', ports: 'backward Fisher-Yates, i = 24 … 1' },
  { line: 54, text: 'const range = i + 1;', ports: 'range = i + 1' },
  { line: 55, text: 'const maxFair = MAX_UINT32 - (MAX_UINT32 % range);', ports: 'maxFairFor' },
  { line: 56, text: 'let cursor = gridSize - 1 - i;', ports: 'cursor starts at gridSize − 1 − i for every i' },
  { line: 62, text: 'new TextEncoder().encode(`${clientSeed}:${nonce}:${cursor}`)', ports: 'the HMAC message' },
  { line: 66, text: 'for (let off = 0; off + 8 <= hash.length; off += 8) {', ports: 'eight 4-byte chunks, first to last' },
  { line: 67, text: 'const value = parseInt(hash.slice(off, off + 8), 16);', ports: 'chunk read as a big-endian uint32 (8 hex chars)' },
  { line: 68, text: 'if (value < maxFair) {', ports: 'drawFromChunk: accept below maxFair' },
  { line: 69, text: 'const j = value % range;', ports: 'drawFromChunk: j = value mod range' },
  { line: 70, text: '[positions[i], positions[j]] = [positions[j], positions[i]];', ports: 'the swap' },
  { line: 77, text: 'cursor++; // otherwise try a new cursor', ports: 'all 8 chunks rejected → next cursor' },
  { line: 82, text: 'return positions.slice(0, minesCount).sort((a, b) => a - b);', ports: 'computeMinePositionsFromBuffer: first m, sorted' },
]);

export const GRID_SIZE  = 25;
export const MAX_UINT32 = 0xFFFFFFFF;   // operator L49

/**
 * Exclusive upper end of the accepted chunk window for one shuffle step on `range` tiles:
 * a 32-bit chunk v is accepted iff v < maxFairFor(range). By construction a whole number of
 * ranges, which is what makes the step exactly uniform — tests/steps/determinism.ts (Step 5,
 * MINES-08) re-derives that from the predicate below rather than trusting this sentence.
 */
export function maxFairFor(range: number): number {
  return MAX_UINT32 - (MAX_UINT32 % range);   // operator L55
}

/**
 * THE SINGLE-CHUNK DRAW the shuffle uses — the one place the acceptance rule and the
 * chunk-to-index mapping live. Returns the swap index j in [0, range), or null when the chunk
 * falls in the rejected tail. The bias bound (drawBiasBound) probes THIS function, so a change
 * to the rule the shuffle actually runs is a change to the bound the step prints.
 */
export function drawFromChunk(value: number, range: number): number | null {
  return value < maxFairFor(range) ? value % range : null;   // operator L68–L69
}

/** Optional census filled by the shuffle: how often the rejection branch was actually taken. */
export interface DrawCensus {
  /** Shuffle steps executed (gridSize − 1 per round). */
  draws: number;
  /** 4-byte chunks read, accepted or not. */
  chunksRead: number;
  /** Chunks that fell in a rejected tail. */
  rejectedChunks: number;
  /** Times all 8 chunks of one HMAC were rejected and the cursor advanced. */
  cursorAdvances: number;
}

export function newDrawCensus(): DrawCensus {
  return { draws: 0, chunksRead: 0, rejectedChunks: 0, cursorAdvances: 0 };
}

export function computeMinePositionsFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  mineCount: number,
  gridSize = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  return shuffleTilesFromBuffer(keyBuffer, clientSeed, nonce, gridSize, census)
    .slice(0, mineCount).sort((a, b) => a - b);   // operator L82
}

/**
 * The shuffle itself: the full permutation of the grid, in DRAW ORDER. positions[i] is final after
 * the step for i (i = 24 … 1), so the mines positions[0 … m−1] are placed last-to-first and
 * positions[m − 1] is the FIRST mine the shuffle places. computeMinePositionsFromBuffer is the
 * sorted prefix of this; Step 26 reads the first-drawn mine from it.
 */
export function shuffleTilesFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  gridSize = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  const positions: number[] = Array.from({ length: gridSize }, (_, i) => i);   // operator L50

  for (let i = gridSize - 1; i > 0; i--) {   // operator L53
    const range   = i + 1;                   // operator L54
    let cursor    = gridSize - 1 - i;        // operator L56
    if (census) census.draws++;

    while (true) {
      const message = `${clientSeed}:${nonce}:${cursor}`;   // operator L62
      const hmac    = crypto.createHmac('sha256', keyBuffer).update(message).digest('hex');   // operator L29–L43
      let found     = false;

      for (let off = 0; off + 8 <= hmac.length; off += 8) {           // operator L66
        const value = parseInt(hmac.substring(off, off + 8), 16);   // operator L67
        if (census) census.chunksRead++;
        const j = drawFromChunk(value, range);
        if (j !== null) {
          [positions[i], positions[j]] = [positions[j], positions[i]];   // operator L70
          found = true;
          break;
        }
        if (census) census.rejectedChunks++;
      }

      if (found) break;
      if (census) census.cursorAdvances++;
      // operator L77: all 8 chunks rejected → next cursor
      cursor++;
    }
  }

  return positions;
}

/** One range's row of the draw-bias bound. */
export interface RangeBias {
  range: number;
  /** maxFairFor(range) — the constant the acceptance rule is written against. */
  maxFair: number;
  /** The accepted window's exclusive end AS MEASURED from drawFromChunk (binary search). */
  acceptedWindow: number;
  /** Chunk values in the rejected tail [acceptedWindow, 2^32). */
  rejectedValues: number;
  rejectionProbabilityPerChunk: number;
  /** acceptedWindow mod range: 0 ⇔ every index receives the same number of accepted values. */
  remainder: number;
  minIndexCount: number;
  maxIndexCount: number;
  /** max over j of |P(j | accepted) − 1/range|. */
  bias: number;
  /** P(max) / P(min) − 1. */
  relativeBias: number;
  /** The same two figures for the UNCORRECTED draw (plain v mod range over all 2^32 values). */
  uncorrectedBias: number;
  uncorrectedRelativeBias: number;
  /** Probes where drawFromChunk disagreed with "v < acceptedWindow ? v % range : null". */
  predicateProbeFailures: number;
  exact: boolean;
}

/**
 * THE DRAW BIAS BOUND, MEASURED FROM THE FUNCTION THE SHUFFLE CALLS.
 *
 * For every range the shuffle draws on (2 … gridSize), the accepted window is located by binary
 * search on drawFromChunk itself — not read off maxFairFor — then ~600 probes (both ends of the
 * domain, both sides of the window edge, and a stride across it) confirm the predicate IS
 * "v < window ? v % range : null". Given that shape the per-index counts are exact integer
 * arithmetic: floor(W / range) or that plus one, the larger for the low `W mod range` indices.
 * Returned as numbers so a step can compare them with the profile's 2^-32 ceiling.
 */
export function drawBiasBound(gridSize = GRID_SIZE): {
  algorithm: 'rejection-sampling';
  domainSize: number;
  ranges: RangeBias[];
  worstBias: number;
  worstRelativeBias: number;
  worstUncorrectedBias: number;
  worstUncorrectedRelativeBias: number;
  inexactRanges: number[];
  predicateProbeFailures: number;
  /** Expected rejected chunks per round: Σ_r p_r / (1 − p_r) over the gridSize − 1 steps. */
  expectedRejectedChunksPerRound: number;
} {
  const domainSize = MAX_UINT32 + 1;   // parseInt of 8 hex chars: 2^32 values
  const ranges: RangeBias[] = [];
  for (let range = 2; range <= gridSize; range++) {
    // Largest accepted value + 1, assuming the accepted set is a prefix of [0, 2^32).
    let lo = 0, hi = domainSize;       // invariant: accepted(lo-1) (or lo = 0), rejected(hi) (or hi = 2^32)
    if (drawFromChunk(0, range) === null) hi = 0;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if (drawFromChunk(mid, range) !== null) lo = mid; else hi = mid;
    }
    const W = hi === 0 ? 0 : (drawFromChunk(lo, range) !== null ? lo + 1 : lo);

    const expect = (v: number): number | null => (v < W ? v % range : null);
    const probes = new Set<number>();
    for (let d = 0; d < 100; d++) {
      probes.add(d);
      probes.add(MAX_UINT32 - d);
      if (W - 1 - d >= 0) probes.add(W - 1 - d);
      if (W + d <= MAX_UINT32) probes.add(W + d);
    }
    for (let k = 0; k < 200; k++) probes.add(Math.floor(k * (domainSize / 200)) + (k % range));
    let predicateProbeFailures = 0;
    for (const v of probes) {
      if (v < 0 || v > MAX_UINT32) continue;
      if (drawFromChunk(v, range) !== expect(v)) predicateProbeFailures++;
    }

    const remainder = W % range;
    const minIndexCount = Math.floor(W / range);
    const maxIndexCount = remainder === 0 ? minIndexCount : minIndexCount + 1;
    // Integer numerators (all < 2^53), one division: |count/W − 1/range| = |count·range − W| / (W·range).
    const bias = W === 0 ? 1
      : Math.max(maxIndexCount * range - W, W - minIndexCount * range) / (W * range);
    const relativeBias = minIndexCount === 0 ? Infinity : maxIndexCount / minIndexCount - 1;

    const uRem = domainSize % range;
    const uMin = Math.floor(domainSize / range);
    const uMax = uRem === 0 ? uMin : uMin + 1;
    const uncorrectedBias = Math.max(uMax * range - domainSize, domainSize - uMin * range) / (domainSize * range);
    const uncorrectedRelativeBias = uMax / uMin - 1;

    const rejectedValues = domainSize - W;
    ranges.push({
      range, maxFair: maxFairFor(range), acceptedWindow: W, rejectedValues,
      rejectionProbabilityPerChunk: rejectedValues / domainSize,
      remainder, minIndexCount, maxIndexCount, bias, relativeBias,
      uncorrectedBias, uncorrectedRelativeBias, predicateProbeFailures,
      exact: remainder === 0 && W > 0 && predicateProbeFailures === 0,
    });
  }
  return {
    algorithm: 'rejection-sampling',
    domainSize,
    ranges,
    worstBias: Math.max(...ranges.map(r => r.bias)),
    worstRelativeBias: Math.max(...ranges.map(r => r.relativeBias)),
    worstUncorrectedBias: Math.max(...ranges.map(r => r.uncorrectedBias)),
    worstUncorrectedRelativeBias: Math.max(...ranges.map(r => r.uncorrectedRelativeBias)),
    inexactRanges: ranges.filter(r => !r.exact).map(r => r.range),
    predicateProbeFailures: ranges.reduce((n, r) => n + r.predicateProbeFailures, 0),
    expectedRejectedChunksPerRound: ranges.reduce(
      (n, r) => n + r.rejectionProbabilityPerChunk / (1 - r.rejectionProbabilityPerChunk), 0),
  };
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
