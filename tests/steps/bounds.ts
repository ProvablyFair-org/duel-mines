/**
 * Steps 25–26: Multiplier Monotonicity & Bounds, and the Live-Sample Fit.
 *
 * Both are FLAG-policy checks in the framework's Mines profile (MINES-14, MINES-22): a violation is
 * disclosed with its magnitude and downgrades the verdict to Conditional Pass; it is never a hard
 * fail. They were appended after step 24 so no existing step number moved.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { exactMultiplier, compareRational, relativeDeviation, GRID } from '../../src/exact';
import { chiSquaredTest } from '../../src/stats';
import { positionChi2WithoutReplacement } from '../../src/sim-census';
import { shuffleTilesFromBuffer } from '../../src/rng';
import { MINE_COUNTS, DECLARED_MAX_ODDS, CAP_FIELD_PATTERN, loadDataset, loadPhaseE } from '../../src/loader';

/** Family-wise alpha for the live-sample fit, Bonferroni-divided over the groups tested. */
const LIVE_FIT_ALPHA = 0.01;

export function run(ctx: VerifyContext): StepResult[] {
  // ── Step 25: Multiplier monotonicity & bounds (MINES-14) ─────────────────────
  // Over every (m, k) cell of the exact ladder C(25,k)/C(25−m,k) × 999/1000: strictly increasing
  // in depth k for fixed m, and in mine count m for fixed k. Exact rational comparisons, so a tie
  // is a violation, not a rounding artefact. The bounds half: every multiplier the operator served
  // (primary k = 1 and every Phase E rung and settlement) must lie inside the ladder's own range
  // [min, max] — the multiplier cannot be anything the game does not define.
  //
  // THE CAP HALF is below (proposed rule R2): Duel declares no cap, so it is n/a with the evidence
  // cited in src/loader.ts DECLARED_MAX_ODDS, and that n/a is re-checked against the data each run.
  const violations: string[] = [];
  let pairsK = 0, pairsM = 0;
  for (let m = 1; m <= MINE_COUNTS; m++) {
    for (let k = 1; k < GRID - m; k++) {
      pairsK++;
      if (compareRational(exactMultiplier(m, k + 1, true), exactMultiplier(m, k, true)) <= 0) {
        violations.push(`m=${m}: k=${k + 1} not above k=${k}`);
      }
    }
  }
  for (let k = 1; k <= GRID - 2; k++) {
    for (let m = 1; m < GRID - k; m++) {
      pairsM++;
      if (compareRational(exactMultiplier(m + 1, k, true), exactMultiplier(m, k, true)) <= 0) {
        violations.push(`k=${k}: m=${m + 1} not above m=${m}`);
      }
    }
  }
  let ladderMin = exactMultiplier(1, 1, true), ladderMax = ladderMin, maxAt = 'm=1,k=1';
  for (let m = 1; m <= MINE_COUNTS; m++) {
    for (let k = 1; k <= GRID - m; k++) {
      const x = exactMultiplier(m, k, true);
      if (compareRational(x, ladderMin) < 0) ladderMin = x;
      if (compareRational(x, ladderMax) > 0) { ladderMax = x; maxAt = `m=${m},k=${k}`; }
    }
  }
  // Served figures inside the ladder's range (the no-edge figure's range is the with-edge one ÷ 0.999).
  const noEdgeMin = { num: ladderMin.num * 1000n, den: ladderMin.den * 999n };
  const noEdgeMax = { num: ladderMax.num * 1000n, den: ladderMax.den * 999n };
  let servedChecked = 0, servedOutside = 0;
  const inRange = (served: string | null | undefined, lo: { num: bigint; den: bigint }, hi: { num: bigint; den: bigint }): boolean => {
    if (!served) return false;
    const dLo = relativeDeviation(served, lo), dHi = relativeDeviation(served, hi);
    const v = Number(served);
    return Number.isFinite(dLo) && Number.isFinite(dHi)
      && v >= Number(lo.num) / Number(lo.den) * (1 - 1e-12) && v <= Number(hi.num) / Number(hi.den) * (1 + 1e-12);
  };
  const one = { num: 1n, den: 1n };
  for (const b of [...ctx.bets, ...ctx.phaseEBets]) {
    if (b.response.outcome !== 'win') continue;
    servedChecked++;
    if (!inRange(b.response.multiplier, noEdgeMin, noEdgeMax)) servedOutside++;
    servedChecked++;
    if (!inRange(b.response.no_house_edge_multiplier, ladderMin, ladderMax)) servedOutside++;
  }
  for (const b of ctx.phaseEBets) {
    for (const rs of b.reveal_steps ?? []) {
      servedChecked++;
      // A mine step shows the multiplier standing before it, which is 1 at depth 0.
      if (!inRange(rs.multiplier, rs.is_mine && rs.step === 1 ? one : noEdgeMin, noEdgeMax)) servedOutside++;
    }
  }
  // THE CAP HALF (proposed rule R2, pending profile owner). "Every quoted multiplier lies within the
  // declared max-odds cap" is scored on what the operator SERVED or SETTLED: every paid figure
  // (no_house_edge_multiplier, which Duel's API uses for the with-edge value — Step 8) on every win
  // settlement and every reveal step. A served figure above a declared cap FLAGs; ladder cells above
  // it are counted and disclosed, not failed. With NO declared cap the half is n/a, and that n/a is
  // itself checked: the capture is walked key by key for anything cap-like (CAP_FIELD_PATTERN), and
  // a cap-like field in the data while none is declared FLAGs — the declaration would be false.
  const capFieldKeys = new Set<string>();
  let capKeysScanned = 0;
  const walkKeys = (o: unknown, p: string): void => {
    if (Array.isArray(o)) { for (const x of o) walkKeys(x, `${p}[]`); return; }
    if (o && typeof o === 'object') {
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        capKeysScanned++;
        if (CAP_FIELD_PATTERN.test(k)) capFieldKeys.add(`${p}.${k}`);
        walkKeys(v, `${p}.${k}`);
      }
    }
  };
  walkKeys(loadDataset(), 'master');
  walkKeys(loadPhaseE(), 'phaseE');
  const capIssues: string[] = [];
  let servedAboveCap = 0, capServedChecked = 0, cellsAboveCap = 0;
  if (DECLARED_MAX_ODDS === null) {
    if (capFieldKeys.size > 0) {
      capIssues.push(`no max-odds cap is declared, but the capture carries cap-like field(s) `
        + `${[...capFieldKeys].slice(0, 4).join(', ')} — declare the cap and assert it`);
    }
  } else {
    const cap = DECLARED_MAX_ODDS;
    const paid: Array<string | null | undefined> = [];
    for (const b of [...ctx.bets, ...ctx.phaseEBets]) if (b.response.outcome === 'win') paid.push(b.response.no_house_edge_multiplier);
    for (const b of ctx.phaseEBets) for (const rs of b.reveal_steps ?? []) paid.push(rs.no_house_edge_multiplier);
    for (const v of paid) { capServedChecked++; if (!(Number(v) <= cap)) servedAboveCap++; }
    for (let m = 1; m <= MINE_COUNTS; m++) {
      for (let k = 1; k <= GRID - m; k++) {
        const x = exactMultiplier(m, k, true);
        if (Number(x.num) / Number(x.den) > cap) cellsAboveCap++;
      }
    }
    if (servedAboveCap > 0) capIssues.push(`${servedAboveCap} of ${capServedChecked} served paid multipliers exceed the declared cap ${cap}`);
  }
  const capSentence = DECLARED_MAX_ODDS === null
    ? `Cap half n/a under the proposed rule R2 (pending profile owner): Duel declares no max-odds cap for Mines `
      + `(src/loader.ts DECLARED_MAX_ODDS, evidence enumerated there), and a walk of all ${capKeysScanned.toLocaleString()} `
      + `keys of both datasets finds no cap-like field.`
    : `Cap ${DECLARED_MAX_ODDS}x: ${capServedChecked} served paid multipliers checked, ${servedAboveCap} above it; `
      + `${cellsAboveCap} formula cells above it (disclosed, not failed).`;

  const s25Status = violations.length === 0 && servedOutside === 0 && capIssues.length === 0 ? 'PASS' : 'FLAG';
  const s25 = step(25, 'Multiplier Monotonicity & Bounds',
    s25Status,
    s25Status === 'FLAG'
      ? `${violations.length} monotonicity violation(s) (${violations.slice(0, 4).join('; ')}); ${servedOutside} served multiplier(s) outside the ladder's range`
        + (capIssues.length ? `; CAP: ${capIssues.join('; ')}` : '')
      : `The exact ladder C(25,k)/C(25−m,k) × 999/1000 is strictly increasing in k for every m (${pairsK} adjacent pairs) `
        + `and in m for every k (${pairsM} pairs); all ${servedChecked} served multipliers lie inside the ladder's range. `
        + `The ladder maximum is at ${maxAt}. ${capSentence}`,
    { pairsInK: pairsK, pairsInM: pairsM, violations: violations.length, servedChecked, servedOutside,
      ladderMax: Number(ladderMax.num) / Number(ladderMax.den), ladderMaxAt: maxAt,
      ladderMin: Number(ladderMin.num) / Number(ladderMin.den), declaredMaxOdds: DECLARED_MAX_ODDS,
      capHalf: DECLARED_MAX_ODDS === null ? 'n/a (no cap declared; proposed rule R2, pending profile owner)' : 'asserted',
      capKeysScanned, capFieldKeys: [...capFieldKeys], capServedChecked, servedAboveCap, cellsAboveCap },
  );

  // ── Step 26: Live-sample fit (MINES-22) ──────────────────────────────────────
  // Three fits over the 6,500 primary bets — (a) and (b) grouped by mine count, each at a Bonferroni-corrected
  // alpha across the groups it tests:
  //   (a) the WIN RATE of the one tile each bet opened against the binomial (25 − m)/25;
  //   (b) the MINE POSITIONS the casino served — the layout, recomputed and equal to the served one
  //       (step 5) — against the uniform lattice: 25 tile counts per mine count, scored with the
  //       without-replacement correction (src/sim-census.ts), because a round's m mines are
  //       distinct and Pearson's statistic is under-dispersed by 24/(25 − m) without it.
  //   (c) the FIRST-DRAWN mine of every bet against the uniform lattice. The capture records the
  //       layout as a set, so the draw order is recovered by recomputing the shuffle from the
  //       revealed seed (src/rng.ts shuffleTilesFromBuffer — the layout it yields is the served one,
  //       step 5): positions[m − 1] is the first mine the shuffle places, uniform on 0..24 for every
  //       m, so all 6,500 bets pool into one 25-bin chi-squared, tested at alpha 0.01 on its own.
  // (The capture opens tile 0 first on every primary bet, so the PLAYER's first pick is not a
  // variable here; Phase E's first picks span all 25 tiles — step 11.) A group failing a fit is
  // reported as INFO with its p-value — informational (profile policy INFORMATIONAL, Mike 2026-09-29):
  // never a FLAG, never counted, verdict unchanged; the live sample is small beside the simulation.
  // A bet that cannot be recomputed at all is still a FAIL (that is not a fit statistic).
  const groups = new Map<number, { n: number; wins: number; counts: number[] }>();
  const firstDraw = new Array(GRID).fill(0);
  let unrecomputable = 0;
  for (const b of ctx.bets) {
    const m = b.request.mines_count;
    const g = groups.get(m) ?? { n: 0, wins: 0, counts: new Array(GRID).fill(0) };
    const ss = ctx.seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { unrecomputable++; continue; }
    g.n++;
    if (b.response.outcome === 'win') g.wins++;
    const perm = shuffleTilesFromBuffer(Buffer.from(ss, 'hex'), b.seed.clientSeed, b.seed.nonce);
    for (const t of perm.slice(0, m)) g.counts[t]++;
    firstDraw[perm[m - 1]]++;
    groups.set(m, g);
  }
  const bonAlpha = LIVE_FIT_ALPHA / groups.size;
  const rows: Array<Record<string, number>> = [];
  const failing: string[] = [];
  let minWinP = 1, minPosP = 1;
  for (const [m, g] of [...groups.entries()].sort(([a], [b]) => a - b)) {
    const p = (GRID - m) / GRID;
    const win = chiSquaredTest([g.wins, g.n - g.wins], [g.n * p, g.n * (1 - p)]);
    const pos = positionChi2WithoutReplacement(g.counts, m, g.n);
    minWinP = Math.min(minWinP, win.pValue);
    minPosP = Math.min(minPosP, pos.positionPValueWR);
    if (win.pValue < bonAlpha) failing.push(`m=${m} win rate p=${win.pValue.toExponential(2)}`);
    if (pos.positionPValueWR < bonAlpha) failing.push(`m=${m} mine positions p=${pos.positionPValueWR.toExponential(2)}`);
    rows.push({ mineCount: m, bets: g.n, wins: g.wins, winRateChi2: win.chi2, winRatePValue: win.pValue,
      positionChi2WR: pos.positionChi2WR, positionPValueWR: pos.positionPValueWR });
  }
  const fdN = firstDraw.reduce((a, c) => a + c, 0);
  const fd = chiSquaredTest(firstDraw, new Array(GRID).fill(fdN / GRID));
  if (fd.pValue < LIVE_FIT_ALPHA) failing.push(`first-drawn mine positions p=${fd.pValue.toExponential(2)}`);
  const s26Issues: string[] = [];
  if (unrecomputable > 0) s26Issues.push(`${unrecomputable} bet(s) not recomputable`);
  if (groups.size !== MINE_COUNTS) s26Issues.push(`${groups.size} mine-count groups != ${MINE_COUNTS}`);
  const s26Status = unrecomputable > 0 ? 'FAIL' : failing.length > 0 || s26Issues.length > 0 ? 'INFO' : 'PASS';
  const s26 = step(26, 'Live-Sample Fit (win rate & mine positions)',
    s26Status,
    `${groups.size} mine-count groups over the ${ctx.bets.length} primary bets; win rate vs the binomial and mine `
    + `positions vs the uniform lattice (without-replacement corrected), each at Bonferroni alpha ${LIVE_FIT_ALPHA}/${groups.size}; `
    + `the first-drawn mine of all ${fdN} bets (draw order recomputed) vs the uniform lattice at alpha ${LIVE_FIT_ALPHA}; `
    + `${failing.length} group fit(s) below it${failing.length ? `: ${failing.join('; ')}` : ''}`
    + `${s26Issues.length ? ` — ${s26Issues.join('; ')}` : ''}`,
    { groups: groups.size, alpha: LIVE_FIT_ALPHA, bonferroniAlpha: bonAlpha, failing: failing.length,
      minWinRatePValue: minWinP, minPositionPValue: minPosP,
      firstDrawBets: fdN, firstDrawChi2: fd.chi2, firstDrawPValue: fd.pValue, perMineCount: rows },
  );

  return [s25, s26];
}
