/**
 * EXACT ARITHMETIC for the multiplier formula — integer binomials and rational comparison.
 *
 * WHY THIS MODULE EXISTS. Every multiplier comparison in this package used to be
 * `|parseFloat(served) − theoreticalMultiplier(m, k)| ≤ 1e-6` — an ABSOLUTE bound on a figure the
 * API publishes to 18 decimals, computed on both sides in floating point. A served multiplier off
 * the formula by 1e-7 passed. Here the closed form is an exact rational,
 *
 *     multiplier(m, k)            = C(25, k) / C(25 − m, k)
 *     no_house_edge_multiplier    = C(25, k) · 999 / (C(25 − m, k) · 1000)
 *
 * with C(n, k) an integer computed in BigInt, and the served decimal string is parsed exactly, so
 * the deviation of a served value from the formula is MEASURED exactly rather than estimated.
 *
 * THE BOUND, AND WHY IT IS NOT ZERO. Measured over every served multiplier in both datasets
 * (2026-09-23, tests/steps/payouts.ts and tests/steps/multireveal.ts emit the figure every run):
 *   - k = 1: the served string is the exact rational rounded to 18 decimals — worst relative
 *     deviation 6.4e-19, i.e. half a unit in the 18th place;
 *   - k > 1: the operator evaluates the product in IEEE-754 double and prints 18 digits of the
 *     result, so the value carries double-precision error — worst relative deviation 9.2e-15
 *     (about 41 × the double machine epsilon 2^-52 = 2.2e-16).
 * No exact equality is therefore available: an exact test would FAIL an honest operator on
 * floating-point noise it cannot avoid. MULT_REL_TOL = 1e-12 is the reproduction rule's own
 * relative bound, 108x the worst measured deviation, and 1e5 tighter than the smallest formula
 * change worth detecting (an edge moved in its 7th significant digit, 0.999 → 0.9990001, moves every
 * multiplier by 1e-7 relative). The measured worst deviation is printed beside the bound on every
 * run, so the headroom is visible rather than asserted.
 */

export const GRID = 25;

/** Relative bound for a served multiplier against the exact closed form. See the header. */
export const MULT_REL_TOL = 1e-12;

/** House-edge retention as an exact fraction: 0.999 = 999/1000. */
export const EDGE_NUM = 999n;
export const EDGE_DEN = 1000n;

/** C(n, k) as an exact integer. 0 outside 0 ≤ k ≤ n. */
export function binomialBig(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  let r = 1n;
  for (let i = 0; i < k; i++) r = (r * BigInt(n - i)) / BigInt(i + 1);
  return r;
}

export interface Rational { num: bigint; den: bigint }

/** The closed-form multiplier at (m, k) as an exact rational; `withEdge` applies 999/1000. */
export function exactMultiplier(m: number, k: number, withEdge: boolean): Rational {
  const num = binomialBig(GRID, k) * (withEdge ? EDGE_NUM : 1n);
  const den = binomialBig(GRID - m, k) * (withEdge ? EDGE_DEN : 1n);
  if (den === 0n) throw new Error(`multiplier undefined at m=${m}, k=${k} (k exceeds the ${GRID - m} safe tiles)`);
  return { num, den };
}

/**
 * The paid multiplier at a stated house edge, `edge` a plain decimal ("0.0021"): exactMultiplier(m, k,
 * true) rescaled from 999/1000 to 1 − edge, i.e. C(25,k)·(1 − edge)/C(25−m,k). At edge 0.001 it is
 * exactMultiplier(m, k, true) itself. It goes THROUGH exactMultiplier, so a change to the paid formula
 * reaches every row of the RTP table (src/rtp-settings.ts) at every edge. Settlement was captured
 * only at 0.001 (Steps 8, 10, 23); at another edge this is the formula, not an observed payout.
 */
export function exactMultiplierAtEdge(m: number, k: number, edge: string): Rational {
  const base = exactMultiplier(m, k, true);
  const e = parseDecimal(edge);
  const E = 10n ** BigInt(e.scale);
  if (e.int < 0n || e.int >= E) throw new Error(`house edge ${edge} is not in [0, 1)`);
  return { num: base.num * (E - e.int) * EDGE_DEN, den: base.den * E * EDGE_NUM };
}

/** Parse a plain decimal string ("2.270454545454545454") exactly: value = int / 10^scale. */
export function parseDecimal(s: string): { int: bigint; scale: number } {
  if (typeof s !== 'string' || !/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a plain decimal: ${JSON.stringify(s)}`);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const [a, b = ''] = body.split('.');
  const int = BigInt(a + b) * (neg ? -1n : 1n);
  return { int, scale: b.length };
}

/**
 * |served − exact| / exact, computed exactly and returned as a double. A served value that is not
 * a plain decimal string returns Infinity, so a malformed field can never satisfy the bound.
 */
export function relativeDeviation(served: string | null | undefined, exact: Rational): number {
  if (served === null || served === undefined) return Infinity;
  let d: { int: bigint; scale: number };
  try { d = parseDecimal(served); } catch { return Infinity; }
  const pow = 10n ** BigInt(d.scale);
  // served/pow − num/den = (served·den − num·pow) / (pow·den); relative to num/den → ÷ (num·pow)
  const diff = d.int * exact.den - exact.num * pow;
  const absDiff = diff < 0n ? -diff : diff;
  const denom = exact.num * pow;
  if (absDiff === 0n) return 0;
  // Scale to keep 30 significant digits through the BigInt division, then to a double.
  const SCALE = 10n ** 30n;
  return Number((absDiff * SCALE) / denom) / 1e30;
}

/** Exact comparison of two rationals: −1, 0, 1. Denominators must be positive. */
export function compareRational(a: Rational, b: Rational): number {
  const l = a.num * b.den, r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}

/**
 * THE COUNTING ANCHOR (profile MINES-18). Enumerates every one of the 2^25 subsets of the 25 tiles
 * once, and tallies, for each size k and each mine count m, how many k-subsets avoid the m tiles
 * {0 … m−1}. That tally is the number of ways to open k tiles and survive, reached by COUNTING,
 * with no binomial formula anywhere in the path — so it is independent of every closed form this
 * package or the operator uses, and a wrong comb() cannot cancel out of it.
 *
 * Returns survive[m][k] (m = 0..25, k = 0..25) and total[k] = number of k-subsets.
 */
export function enumerateSurvivalCounts(): { survive: number[][]; total: number[] } {
  const total = new Array(GRID + 1).fill(0);
  // byLow[k][b]: k-subsets whose lowest tile index is b (b = GRID for the empty set).
  const byLow: number[][] = Array.from({ length: GRID + 1 }, () => new Array(GRID + 1).fill(0));
  const limit = 1 << GRID;
  for (let s = 0; s < limit; s++) {
    // popcount
    let x = s - ((s >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    const k = (((x + (x >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
    const low = s === 0 ? GRID : 31 - Math.clz32(s & -s);
    total[k]++;
    byLow[k][low]++;
  }
  // A subset avoids {0..m−1} iff its lowest tile is >= m.
  const survive: number[][] = Array.from({ length: GRID + 1 }, () => new Array(GRID + 1).fill(0));
  for (let k = 0; k <= GRID; k++) {
    let acc = 0;
    for (let b = GRID; b >= 0; b--) {
      acc += byLow[k][b];
      survive[b][k] = acc;         // lowest >= b  ⇔  avoids the b tiles {0..b−1}
    }
  }
  return { survive, total };
}
