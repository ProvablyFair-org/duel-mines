/**
 * DRAW-BIAS BOUND (profile MINES-08) — the audit's own measurement, not part of the RNG.
 *
 * Moved here from src/rng.ts on 20 Oct 2026 (v1.2.0), when src/rng.ts was replaced by the clean-room
 * module rebuilt from docs/ALGORITHM.md. This file is the auditor's code, not Duel's and not the
 * clean-room implementer's: it measures the module, it does not implement it. It is built ON TOP of
 * src/rng.ts drawFromChunk — the single-chunk draw the shuffle calls for every chunk it reads — so the
 * bound still measures the code the game runs: a change to the acceptance rule the shuffle uses is a
 * change to the bound Step 5 prints.
 */

import { drawFromChunk, maxFairFor, MAX_UINT32, GRID_SIZE } from './rng';

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
  const domainSize = MAX_UINT32 + 1;   // a 4-byte big-endian chunk: 2^32 values
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
