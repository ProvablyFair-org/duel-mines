/**
 * The simulation's statistics as functions of INTEGER CENSUS DATA.
 *
 * WHY THIS MODULE EXISTS. The Pass-1 rows used to carry only finished statistics — positionPValue,
 * r1Z, runsPValue — and the verifier counted flags without being able to re-derive a single one of
 * them, so a forged p-value was trusted (profile MINES-20). The simulator now writes the integer
 * census each statistic is a function of (src/simulate.ts Pass1Census), and both the simulator and
 * the verifier compute the statistics HERE, from that census. The verifier therefore scores a
 * statistic it derived itself, and cross-checks the one the artifact carries.
 *
 * Nothing here reads an artifact. Every function is pure arithmetic over its arguments.
 */

import { chiSquaredPValue, normalTwoSidedP } from './stats';
import { theoreticalMultiplier, winChance, GRID_SIZE } from './rng';

/** Rounds after which Pass 1 records a checkpoint census — what the verifier replays each run. */
export const PASS1_CHECKPOINT_ROUNDS = 10_000;

/**
 * MINE-POSITION UNIFORMITY WITH THE WITHOUT-REPLACEMENT CORRECTION (profile MINES-20).
 *
 * Each round places m DISTINCT mines, so the 25 per-tile indicators of one round are not
 * independent: Var(I_j) = p(1-p) with p = m/25, and Cov(I_i, I_j) = -p(1-p)/24. Over N rounds the
 * count vector has covariance N p(1-p) (25/24) (I - J/25), and because the counts always sum to
 * exactly N·m the deviation vector lies in the subspace where that matrix is (25/24) N p(1-p) times
 * the identity. The correct statistic is therefore
 *
 *     X²_WR = Σ_j (O_j - N p)² / (N p (1-p) · 25/24)   ~   χ²(24)
 *
 * which is Pearson's Σ (O-E)²/E multiplied by 24 / (25 - m). Pearson alone treats the m mines of a
 * round as m independent draws and is UNDER-dispersed by that factor — by 24x at m = 24 — so an
 * uncorrected test is blind exactly where the board is fullest.
 */
export function positionChi2WithoutReplacement(
  counts: number[], mineCount: number, rounds: number,
): { positionChi2WR: number; positionDfWR: number; positionPValueWR: number } {
  if (counts.length !== GRID_SIZE) throw new Error(`expected ${GRID_SIZE} position counts, got ${counts.length}`);
  const p = mineCount / GRID_SIZE;
  const expected = rounds * p;
  const scale = rounds * p * (1 - p) * (GRID_SIZE / (GRID_SIZE - 1));
  let x2 = 0;
  for (const o of counts) x2 += (o - expected) ** 2;
  x2 /= scale;
  const df = GRID_SIZE - 1;
  return { positionChi2WR: x2, positionDfWR: df, positionPValueWR: chiSquaredPValue(x2, df) };
}

/** Pearson's statistic over the same 25 bins, E = N·m/25 — what the artifact's legacy positionChi2 is. */
export function positionChi2Pearson(counts: number[], mineCount: number, rounds: number): number {
  const expected = rounds * mineCount / GRID_SIZE;
  let x2 = 0;
  for (const o of counts) x2 += (o - expected) ** 2 / expected;
  return x2;
}

export interface SerialCensus {
  rounds: number;
  wins: number;
  adjacentWinPairs: number;
  transitions: number;
  firstOutcome: number;
  lastOutcome: number;
}

/**
 * Lag-1 autocorrelation of a 0/1 series, in closed form from the census:
 *   num = S11 - x̄ (Σ_{i<n-1} x_i + Σ_{i>0} x_i) + (n-1) x̄²,   den = W - W²/n,   r1 = num/den
 * with S11 the adjacent (1,1) pairs. Identical in exact arithmetic to src/stats.ts
 * lag1Autocorrelation over the series; the two differ in floating point only by summation order.
 */
export function lag1FromCensus(c: SerialCensus): { r1: number; r1Z: number } {
  const n = c.rounds, W = c.wins;
  const mean = W / n;
  const num = c.adjacentWinPairs - mean * ((W - c.lastOutcome) + (W - c.firstOutcome)) + (n - 1) * mean * mean;
  const den = W - W * W / n;
  const r1 = den === 0 ? 0 : num / den;
  return { r1, r1Z: r1 * Math.sqrt(n) };
}

/**
 * Wald–Wolfowitz runs test on the WIN/LOSS dichotomy: n1 = wins, n2 = losses, R = transitions + 1.
 *
 * This is the test the simulator's serial check was meant to be. The legacy form (src/stats.ts
 * runsTest) dichotomises at the series MEDIAN with `>=`, and for a 0/1 series whose losses are the
 * majority the median is 0, every value is "above" it, and the test returns z = 0, p = 1 whatever
 * the sequence — which is what the committed rows show for every mine count 13-24. Re-derived here
 * on the outcome itself, it is live for all 24 configurations.
 */
export function runsFromCensus(c: SerialCensus): { runs: number; expected: number; z: number; pValue: number } {
  const n = c.rounds, n1 = c.wins, n2 = n - c.wins;
  const runs = c.transitions + 1;
  const expected = (2 * n1 * n2) / n + 1;
  const varRuns = (2 * n1 * n2 * (2 * n1 * n2 - n)) / (n * n * (n - 1));
  const z = varRuns > 0 ? (runs - expected) / Math.sqrt(varRuns) : 0;
  return { runs, expected, z, pValue: normalTwoSidedP(z) };
}

/**
 * The legacy median-split runs statistic, reproduced from the census so the verifier can
 * cross-check the figure the artifact carries (and show where it is vacuous). For a 0/1 series:
 * wins in the majority (or an exact tie) → the median split IS the win/loss split; losses in the
 * majority → median 0, one run, z = 0, p = 1.
 */
export function legacyMedianRunsFromCensus(c: SerialCensus): { z: number; pValue: number; vacuous: boolean } {
  const n = c.rounds, losses = n - c.wins;
  if (losses > n / 2) return { z: 0, pValue: 1, vacuous: true };
  const r = runsFromCensus(c);
  return { z: r.z, pValue: r.pValue, vacuous: false };
}

// ── Pass 2, Test C — the served-configuration return ────────────────────────────────────────────

/** Exact per-round mean and variance of the return when tile 0 is opened on an m-mine board. */
export function servedRoundMoments(m: number): { mult: number; p: number; mean: number; variance: number } {
  const p = winChance(m, 0);
  const mult = theoreticalMultiplier(m, 1, 0.001);
  const mean = p * mult;
  return { mult, p, mean, variance: p * mult * mult - mean * mean };
}

/**
 * The standardised return of one window: z = (Σ R_i − Σ μ_i) / √(Σ σ²_i), where round i is played
 * at the served config m_i (configs[i]) and returns R_i = multiplier(m_i, 1) on a win, 0 on a loss.
 */
export function windowReturnZ(configs: number[], outcomes: number[]): number {
  if (configs.length !== outcomes.length) throw new Error('configs and outcomes differ in length');
  let r = 0, mu = 0, v = 0;
  for (let i = 0; i < configs.length; i++) {
    const mo = servedRoundMoments(configs[i]);
    if (outcomes[i] === 1) r += mo.mult;
    mu += mo.mean;
    v += mo.variance;
  }
  return (r - mu) / Math.sqrt(v);
}

/** Outcomes (bit i = round i won) as a lowercase hex bitmask. */
export function encodeWinBits(outcomes: number[]): string {
  let x = 0n;
  for (let i = 0; i < outcomes.length; i++) if (outcomes[i] === 1) x |= 1n << BigInt(i);
  return x.toString(16);
}

export function decodeWinBits(hex: string, length: number): number[] {
  if (!/^[0-9a-f]+$/.test(hex)) throw new Error(`not a hex bitmask: ${JSON.stringify(hex)}`);
  const x = BigInt('0x' + hex);
  if (x >> BigInt(length) !== 0n) throw new Error(`bitmask ${hex} has bits beyond ${length}`);
  return Array.from({ length }, (_, i) => Number((x >> BigInt(i)) & 1n));
}

/** P(X > bound) for X ~ Binomial(n, p), summed exactly term by term in log space. */
export function binomialUpperTail(n: number, p: number, bound: number): number {
  const kMin = Math.floor(bound) + 1;
  if (kMin > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let logC = 0;
  let total = 0;
  for (let k = 0; k <= n; k++) {
    if (k > 0) logC += Math.log(n - k + 1) - Math.log(k);
    if (k >= kMin) total += Math.exp(logC + k * Math.log(p) + (n - k) * Math.log(1 - p));
  }
  return Math.min(1, total);
}

/** P(X ≥ k) for X ~ Binomial(n, p). */
export function binomialTailAtLeast(n: number, p: number, k: number): number {
  return binomialUpperTail(n, p, k - 1);
}

/**
 * THE COUNT RULE. A per-seed rule applied to N seeds is N tests, so "any seed trips it" has a
 * false-alarm rate that grows with N: a seed off in both windows at 0.05 × 0.05 = 1 in 400 occurs
 * by chance in at least one of 130 fair seeds with probability 0.28. The rule therefore scores the
 * COUNT K of seeds that trip it, against Binomial(N, p): the threshold is the smallest k whose
 * upper tail P(K ≥ k) is below alpha, so the rule's false-alarm rate on a fair game is
 * P(K ≥ threshold) < alpha by construction.
 */
export function countRuleThreshold(n: number, p: number, alpha: number): number {
  for (let k = 0; k <= n; k++) if (binomialTailAtLeast(n, p, k) < alpha) return k;
  return n + 1;
}

/**
 * The exact probability, under Binomial(n, p), that a two-cell test on (wins, n − wins) against
 * (p·n, (1 − p)·n) rejects at `alpha`, given the test's own p-value function. For a discrete
 * window this is the rule's actual per-window false-alarm rate, which can sit either side of the
 * nominal alpha.
 */
export function windowRejectProbability(n: number, p: number, alpha: number, pValueOf: (wins: number) => number): number {
  let logC = 0, total = 0;
  for (let w = 0; w <= n; w++) {
    if (w > 0) logC += Math.log(n - w + 1) - Math.log(w);
    if (pValueOf(w) < alpha) total += Math.exp(logC + w * Math.log(p) + (n - w) * Math.log(1 - p));
  }
  return Math.min(1, total);
}
