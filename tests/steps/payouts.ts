/**
 * Steps 7–12: Payout Verification
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { theoreticalMultiplier, winChance, computeMinePositions } from '../../src/rng';
import { exactMultiplier, relativeDeviation, MULT_REL_TOL } from '../../src/exact';
import type { MinesGame } from '../../src/types';
import {
  MINE_COUNTS, MIN_BETS_PER_MINE_COUNT, EXPECTED_BETS, EXPECTED_PHASE_E_BETS, EXPECTED_PHASE_BETS,
  EXPECTED_PRIMARY_WINS, EXPECTED_PRIMARY_LOSSES, EXPECTED_PHASE_E_WINS_K1, EXPECTED_PHASE_E_LOSSES,
  EXPECTED_PHASE_E_CASHOUTS_K_GT_1, PHASE_C_MIN_WINS, PHASE_C_MINE_COUNT, PHASE_C_STAKE, BASE_STAKE,
  PHASE_A_BETS_PER_MINE_COUNT, PHASE_A_FLOOR_PER_CONFIG, PHASE_E_PLAN, FIRST_PICK_TILES_REQUIRED,
} from '../../src/loader';

/** The primary capture opens exactly one tile per bet (tile 0); that is its recorded depth. */
const PRIMARY_REVEALS_PER_BET = 1;

/**
 * MONEY TOLERANCE, SIZED TO THE ARITHMETIC. Credited money is a full-precision product, not a
 * lattice value, so there is no grid to snap it to and the bound is the only thing between a
 * served figure and its recomputation. `> 1e-8` ABSOLUTE was five orders looser than double
 * arithmetic needs, and an off-grid forgery that nudges a served payout by 1e-9 passed it. The
 * bound is RELATIVE so it scales with the figure (a $10 Phase C payout and a $0.01 Phase A
 * payout are held to the same precision), floored at 1 so a sub-unit payout is not held to an
 * impossible absolute bound, and still orders of magnitude above the worst real deviation in
 * the captures it guards. Shared by steps 7, 10 and 23 — every place credited money is compared.
 */
export const MONEY_REL_TOL = 1e-12;
export const moneyTol = (x: number): number => MONEY_REL_TOL * Math.max(Math.abs(x), 1);

/**
 * MULTIPLIER BOUND — exact rational, relative. The comparisons in steps 8, 10, 20 and 23 used to be
 * `|parseFloat(served) − theoreticalMultiplier| ≤ 1e-6` ABSOLUTE, on a figure the API publishes to 18
 * decimals: a served multiplier off the formula by 1e-7 passed. They now parse the served string
 * exactly and compare it with the exact rational C(25,k)/C(25−m,k) (× 999/1000 for the with-edge
 * field) at src/exact.ts MULT_REL_TOL — the header there carries the measured worst deviations
 * (k = 1: 6.4e-19; k > 1: 9.2e-15, the operator's double-precision product) that justify it.
 */
export { MULT_REL_TOL };

/** Worst relative deviation seen, and where — emitted so the headroom under the bound is visible. */
export interface DevTracker { worst: number; where: string }
export const newDev = (): DevTracker => ({ worst: 0, where: '' });
export function track(t: DevTracker, dev: number, where: string): boolean {
  if (dev > t.worst || !Number.isFinite(dev)) { t.worst = Number.isFinite(dev) ? dev : Infinity; t.where = where; }
  return dev <= MULT_REL_TOL;
}

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseC, phaseEBets, seedMap } = ctx;

  // ── Step 7: Payout math ───────────────────────────────────────────────────────
  // Wins: amount_won == amount × no_house_edge_multiplier within moneyTol (relative 1e-12)
  // Losses: amount_won === '0'
  //
  // EVERY settled round, both datasets. This step used to iterate the primary bets only, and
  // step 23 takes Phase E cash-outs at k > 1 only, so the 39 Phase E wins settled at depth 1 and
  // the 378 Phase E losses had no payout assertion anywhere. They are scored here now, and the
  // win and loss populations of each dataset are bound to src/loader.ts.
  let payoutErrors = 0;
  let primaryWins = 0, primaryLosses = 0, eWinsK1 = 0, eLosses = 0, eWinsKGt1 = 0;
  const payoutFailures: string[] = [];
  const checkWin = (b: MinesGame, tag: string) => {
    const amt  = parseFloat(b.request.amount);
    const nhe  = parseFloat(b.response.no_house_edge_multiplier ?? 'NaN');
    const won  = parseFloat(b.response.amount_won);
    if (!Number.isFinite(won) || !Number.isFinite(nhe) || Math.abs(amt * nhe - won) > moneyTol(amt * nhe)) {
      payoutErrors++;
      payoutFailures.push(`${tag} round ${b.response.round_id}: amount_won ${b.response.amount_won} != ${b.request.amount} × ${b.response.no_house_edge_multiplier}`);
    }
  };
  const checkLoss = (b: MinesGame, tag: string) => {
    if (b.response.amount_won !== '0') {
      payoutErrors++;
      payoutFailures.push(`${tag} round ${b.response.round_id}: a loss credited ${b.response.amount_won}`);
    }
  };
  for (const b of bets) {
    if (b.response.outcome === 'win') { primaryWins++; checkWin(b, 'primary'); }
    else { primaryLosses++; checkLoss(b, 'primary'); }
  }
  for (const b of phaseEBets) {
    if (b.response.outcome === 'win') {
      const k = b.response.reached_k ?? b.response.revealed_positions.length;
      if (k <= 1) { eWinsK1++; checkWin(b, 'Phase E'); } else eWinsKGt1++;   // k > 1: step 23
    } else { eLosses++; checkLoss(b, 'Phase E'); }
  }
  const s7Pop: string[] = [];
  if (primaryWins !== EXPECTED_PRIMARY_WINS) s7Pop.push(`primary wins ${primaryWins} != ${EXPECTED_PRIMARY_WINS}`);
  if (primaryLosses !== EXPECTED_PRIMARY_LOSSES) s7Pop.push(`primary losses ${primaryLosses} != ${EXPECTED_PRIMARY_LOSSES}`);
  if (eWinsK1 !== EXPECTED_PHASE_E_WINS_K1) s7Pop.push(`Phase E depth-1 wins ${eWinsK1} != ${EXPECTED_PHASE_E_WINS_K1}`);
  if (eLosses !== EXPECTED_PHASE_E_LOSSES) s7Pop.push(`Phase E losses ${eLosses} != ${EXPECTED_PHASE_E_LOSSES}`);
  if (eWinsKGt1 !== EXPECTED_PHASE_E_CASHOUTS_K_GT_1) s7Pop.push(`Phase E wins at k>1 ${eWinsKGt1} != ${EXPECTED_PHASE_E_CASHOUTS_K_GT_1} (step 23's population)`);
  const s7 = step(7, 'Payout Math',
    payoutErrors === 0 && s7Pop.length === 0 ? 'PASS' : 'FAIL',
    payoutErrors > 0
      ? `${payoutErrors} payout error(s): ${payoutFailures.slice(0, 3).join('; ')}`
      : s7Pop.length > 0
        ? `POPULATION MISMATCH vs src/loader.ts: ${s7Pop.join('; ')}`
        : `${bets.length} primary bets (${EXPECTED_PRIMARY_WINS} wins, ${EXPECTED_PRIMARY_LOSSES} losses) and the `
          + `${EXPECTED_PHASE_E_WINS_K1 + EXPECTED_PHASE_E_LOSSES} Phase E rounds step 23 does not take (${EXPECTED_PHASE_E_WINS_K1} `
          + `depth-1 wins, ${EXPECTED_PHASE_E_LOSSES} losses): every win credits amount × no_house_edge_multiplier `
          + `(money tolerance: relative ${MONEY_REL_TOL}), every loss credits exactly "0"; 0 errors`,
    { betsChecked: bets.length, errors: payoutErrors, moneyRelTol: MONEY_REL_TOL,
      primaryWins, primaryLosses, phaseEWinsDepth1: eWinsK1, phaseELosses: eLosses },
  );

  // ── Step 8: Multiplier formula ────────────────────────────────────────────────
  // multiplier (no-edge)              = C(25,1)/C(25-m,1)          — exact rational
  // no_house_edge_multiplier (w/ edge) = C(25,1)/C(25-m,1) × 999/1000 — exact rational
  // Both served strings are parsed exactly and compared at MULT_REL_TOL relative (src/exact.ts).
  // The derivation reads (m, k) only: no operator odds field enters it.
  //
  // THE PHASE E WINS SETTLED AT DEPTH 1 ARE SCORED HERE TOO (since 19 Oct 2026, Mike's QA: "The 39
  // one-tile multipliers are only range-checked, but DL-5 claims more"). Step 23 takes Phase E
  // cash-outs at k > 1 only and Step 20 the per-reveal rungs, so the two settled multiplier strings of
  // the 39 depth-1 Phase E wins were held only to the ladder's range (Step 25). They are k = 1
  // settlements, so they take the same exact comparison as the primary wins, and their count is bound
  // to src/loader.ts so the coverage cannot silently vanish.
  let multErrors = 0;
  const s8Dev = newDev();
  const checkK1 = (b: MinesGame) => {
    const m = b.request.mines_count;
    if (!track(s8Dev, relativeDeviation(b.response.multiplier, exactMultiplier(m, 1, false)), `round ${b.response.round_id} multiplier`)) multErrors++;
    if (!track(s8Dev, relativeDeviation(b.response.no_house_edge_multiplier, exactMultiplier(m, 1, true)), `round ${b.response.round_id} no_house_edge_multiplier`)) multErrors++;
  };
  let wins = 0, eK1 = 0;
  for (const b of bets) {
    if (b.response.outcome !== 'win') continue;
    wins++; checkK1(b);
  }
  for (const b of phaseEBets) {
    if (b.response.outcome !== 'win') continue;
    if ((b.response.reached_k ?? b.response.revealed_positions.length) > 1) continue;   // k > 1: step 23
    eK1++; checkK1(b);
  }
  const s8Pop = eK1 !== EXPECTED_PHASE_E_WINS_K1 ? `Phase E depth-1 wins ${eK1} != ${EXPECTED_PHASE_E_WINS_K1}` : null;
  const s8 = step(8, 'Multiplier Formula (C(25,1)/C(25-m,1) × edge)',
    multErrors === 0 && s8Pop === null ? 'PASS' : 'FAIL',
    s8Pop !== null
      ? `POPULATION MISMATCH vs src/loader.ts: ${s8Pop}`
      : `${wins} winning primary bets and the ${eK1} Phase E wins settled at depth 1: multiplier = 25/(25−m) and `
        + `payout_mult = 25/(25−m) × 999/1000 as exact rationals, served strings parsed exactly, relative bound `
        + `${MULT_REL_TOL}; ${multErrors} mismatches`,
    { winningBets: wins, phaseEWinsDepth1: eK1, mismatches: multErrors, multRelTol: MULT_REL_TOL,
      worstRelativeDeviation: s8Dev.worst, worstAt: s8Dev.where },
  );

  // ── Step 9: Win condition & reveal-sequence consistency (MINES-10) ────────────
  // THE OUTCOME IS DERIVED FROM THE RECOMPUTED LAYOUT, never from the operator's. The old form
  // tested revealed_positions[0] against the operator's own mines_positions, which bound the label
  // to the layout only transitively. Now, for every bet in both datasets:
  //   - the layout is recomputed from the revealed seed (an unrecomputable bet FAILs);
  //   - win ⇔ no opened tile is a recomputed mine, compared with the served outcome;
  //   - a bust ends on EXACTLY the opened mine: the last opened tile is a recomputed mine and no
  //     earlier one is;
  //   - the opened count equals the recorded depth: 1 for every primary bet (the capture opens one
  //     tile), and for Phase E revealed_positions.length === reveal_steps.length === reached_k.
  let condErrors = 0, condChecked = 0, condSkipped = 0, bustChecked = 0, depthChecked = 0;
  const condFailures: string[] = [];
  const checkRound = (b: MinesGame, tag: string, recordedDepth: number | undefined, steps?: number) => {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { condSkipped++; return; }
    condChecked++;
    const layout = new Set(computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count));
    const opened = b.response.revealed_positions;
    const hits = opened.map(t => layout.has(t));
    const derived = hits.some(h => h) ? 'loss' : 'win';
    const errs: string[] = [];
    if (derived !== b.response.outcome) errs.push(`outcome ${b.response.outcome}, recomputed layout says ${derived}`);
    if (derived === 'loss') {
      bustChecked++;
      if (!hits[hits.length - 1] || hits.slice(0, -1).some(h => h)) errs.push('the bust is not exactly the last opened tile');
    }
    depthChecked++;
    if (recordedDepth === undefined || opened.length !== recordedDepth) errs.push(`opened ${opened.length} tiles, recorded depth ${recordedDepth}`);
    if (steps !== undefined && steps !== opened.length) errs.push(`${steps} reveal steps for ${opened.length} opened tiles`);
    // A multi-reveal round settles one of two ways: cashed out on a win, or busted without a cash-out.
    if (b.response.cashed_out !== undefined && b.response.cashed_out !== (b.response.outcome === 'win')) {
      errs.push(`cashed_out ${b.response.cashed_out} on a ${b.response.outcome}`);
    }
    if (new Set(opened).size !== opened.length || opened.some(t => !Number.isInteger(t) || t < 0 || t > 24)) errs.push('an opened tile is repeated or off the 0..24 grid');
    if (errs.length) { condErrors++; condFailures.push(`${tag} round ${b.response.round_id}: ${errs.join(', ')}`); }
  };
  for (const b of bets) checkRound(b, 'primary', PRIMARY_REVEALS_PER_BET);
  for (const b of phaseEBets) checkRound(b, 'Phase E', b.response.reached_k, b.reveal_steps?.length);
  const s9Pop: string[] = [];
  if (condSkipped !== 0) s9Pop.push(`${condSkipped} bet(s) not recomputable — their epoch seed was never revealed`);
  if (condChecked !== EXPECTED_BETS + EXPECTED_PHASE_E_BETS) s9Pop.push(`${condChecked} rounds checked != ${EXPECTED_BETS + EXPECTED_PHASE_E_BETS}`);
  if (bustChecked !== EXPECTED_PRIMARY_LOSSES + EXPECTED_PHASE_E_LOSSES) s9Pop.push(`${bustChecked} busts checked != ${EXPECTED_PRIMARY_LOSSES + EXPECTED_PHASE_E_LOSSES}`);
  const s9 = step(9, 'Win Condition (tile not in mines)',
    condErrors === 0 && s9Pop.length === 0 ? 'PASS' : 'FAIL',
    condErrors > 0
      ? `${condErrors} round(s) inconsistent with the recomputed layout: ${condFailures.slice(0, 3).join('; ')}`
      : s9Pop.length > 0
        ? `POPULATION MISMATCH vs src/loader.ts: ${s9Pop.join('; ')}`
        : `${EXPECTED_BETS} primary + ${EXPECTED_PHASE_E_BETS} Phase E rounds, outcome derived from the layout RECOMPUTED `
          + `from the revealed seed (not the served mines_positions): win iff no opened tile is a mine; each of the `
          + `${EXPECTED_PRIMARY_LOSSES + EXPECTED_PHASE_E_LOSSES} busts ends on exactly the last opened tile with no earlier `
          + `mine; the opened count equals the recorded depth on every round; every Phase E cash-out is a win and no `
          + `bust is cashed out; 0 errors`,
    { roundsChecked: condChecked, skipped: condSkipped, errors: condErrors, bustsChecked: bustChecked, depthChecked },
  );

  // ── Step 10: Phase C bet-size invariance ──────────────────────────────────────
  // Every $10 bet recomputes its layout HERE (not only in step 5's population sweep), every $10 win
  // is scored on the exact multiplier and the money, the served multiplier strings at $10 must be
  // IDENTICAL to those served at the $0.01 base stake for the same mine count (Phase A, m = 12), and
  // the profile's floor — at least PHASE_C_MIN_WINS elevated-stake wins exercising the payout path
  // — is asserted rather than merely measured.
  let cErrors = 0, cChecked = 0, cLayouts = 0, cLayoutErrors = 0, cStakeErrors = 0;
  const s10Dev = newDev();
  const baseServed = new Set(bets
    .filter(b => b.phase === 'A' && b.request.mines_count === PHASE_C_MINE_COUNT && b.response.outcome === 'win')
    .map(b => `${b.response.multiplier}|${b.response.no_house_edge_multiplier}`));
  for (const b of phaseC) {
    if (b.request.amount !== PHASE_C_STAKE || b.request.mines_count !== PHASE_C_MINE_COUNT) cStakeErrors++;
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (ss) {
      cLayouts++;
      const computed = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
      const actual   = [...b.response.mines_positions].sort((x, y) => x - y);
      if (computed.length !== actual.length || !computed.every((v, i) => v === actual[i])) cLayoutErrors++;
    }
    if (b.response.outcome !== 'win') continue;
    cChecked++;
    const m = b.request.mines_count;
    if (!track(s10Dev, relativeDeviation(b.response.multiplier, exactMultiplier(m, 1, false)), `round ${b.response.round_id}`)) cErrors++;
    if (!track(s10Dev, relativeDeviation(b.response.no_house_edge_multiplier, exactMultiplier(m, 1, true)), `round ${b.response.round_id}`)) cErrors++;
    if (!baseServed.has(`${b.response.multiplier}|${b.response.no_house_edge_multiplier}`)) cErrors++;
    const amt = parseFloat(b.request.amount);
    const nhe = parseFloat(b.response.no_house_edge_multiplier ?? 'NaN');
    const won = parseFloat(b.response.amount_won);
    // Money on the same relative bound as step 7. This is the step where the absolute 1e-8 was
    // most wrong: at a $10 stake the payout is three orders larger than in Phase A, so the same
    // absolute bound was three orders LOOSER in relative terms exactly where the stake is highest.
    if (!Number.isFinite(won) || !Number.isFinite(nhe) || Math.abs(amt * nhe - won) > moneyTol(amt * nhe)) cErrors++;
  }
  const s10Issues: string[] = [];
  if (phaseC.length !== EXPECTED_PHASE_BETS.C) s10Issues.push(`Phase C bets ${phaseC.length} != ${EXPECTED_PHASE_BETS.C}`);
  if (cLayouts !== phaseC.length) s10Issues.push(`${phaseC.length - cLayouts} Phase C layout(s) not recomputable`);
  if (cLayoutErrors > 0) s10Issues.push(`${cLayoutErrors} Phase C layout(s) disagree with the recomputation`);
  if (cStakeErrors > 0) s10Issues.push(`${cStakeErrors} Phase C bet(s) not at $${PHASE_C_STAKE} / m=${PHASE_C_MINE_COUNT}`);
  if (baseServed.size === 0) s10Issues.push(`no base-stake m=${PHASE_C_MINE_COUNT} win to compare the $${PHASE_C_STAKE} multipliers with`);
  if (cChecked < PHASE_C_MIN_WINS) s10Issues.push(`${cChecked} elevated-stake wins < the profile floor ${PHASE_C_MIN_WINS}`);
  const s10 = step(10, 'Phase C Bet-Size Invariance ($10 bets)',
    cErrors === 0 && s10Issues.length === 0 ? 'PASS' : 'FAIL',
    `${phaseC.length} Phase C bets ($${PHASE_C_STAKE}, m=${PHASE_C_MINE_COUNT}): every layout recomputed here; ${cChecked} wins `
    + `(floor ${PHASE_C_MIN_WINS}) scored on the exact multiplier (relative ${MULT_REL_TOL}), on money (relative `
    + `${MONEY_REL_TOL}), and served the IDENTICAL multiplier strings as the $${BASE_STAKE} m=${PHASE_C_MINE_COUNT} wins; `
    + `${cErrors} errors${s10Issues.length ? ` — ${s10Issues.join('; ')}` : ''}`,
    { phaseCBets: phaseC.length, wins: cChecked, minWins: PHASE_C_MIN_WINS, errors: cErrors,
      layoutsRecomputed: cLayouts, layoutErrors: cLayoutErrors, moneyRelTol: MONEY_REL_TOL, multRelTol: MULT_REL_TOL,
      worstRelativeDeviation: s10Dev.worst },
  );

  // ── Step 11: Config Completeness & Payout-Cell Coverage ──────────────────────
  // "Every mine count appears at least once" is a weak claim: a single bet on mines=17 is
  // enough to satisfy it while proving nothing about that configuration's behaviour. The
  // floor is MIN_BETS_PER_MINE_COUNT in src/loader.ts, and it is scored.
  //
  // Coverage is reported at the level that actually matters — the PAYOUT CELL. A Mines
  // multiplier is selected by (mines_count, reveals k), and this primary dataset is k=1 only,
  // so the whole k>1 surface rests on the Phase E corpus behind steps 20–23. The cells neither
  // corpus reaches are named in outputs/payout-coverage.json, together with the share of
  // theoretical RTP resting on them, so the size of what live play did NOT confirm is stated
  // rather than left implicit.
  const betsPerMineCount: Record<number, number> = {};
  const seenCells = new Set<string>();
  for (const b of bets) {
    const m = b.request.mines_count;
    betsPerMineCount[m] = (betsPerMineCount[m] ?? 0) + 1;
    if (b.response.outcome === 'win') seenCells.add(`${m}|1`);
  }
  for (const b of ctx.phaseEBets) {
    const m = b.response.mines_count;
    if (!b.reveal_steps) continue;
    for (const rs of b.reveal_steps) {
      if (!rs.is_mine && rs.multiplier) seenCells.add(`${m}|${rs.step}`);
    }
  }

  const expected = Array.from({ length: MINE_COUNTS }, (_, i) => i + 1);
  const missing  = expected.filter(m => (betsPerMineCount[m] ?? 0) === 0);
  const belowFloor = expected
    .filter(m => {
      const n = betsPerMineCount[m] ?? 0;
      return n > 0 && n < MIN_BETS_PER_MINE_COUNT;
    })
    .map(m => `mines=${m}: ${betsPerMineCount[m]}`);

  // Every (m, k) the game can reach: k may run from 1 to the number of safe tiles, 25 - m.
  //
  // The weight here is PROBABILITY MASS, not a share of RTP. For this game those are not the
  // same quantity and quoting RTP share would say nothing: P(survive k) x multiplier(m, k) is
  // identically 0.999 for every cell — that identity is precisely what step 16 proves — so
  // every cell carries equal RTP and an "RTP share" would only restate the count of cells.
  // What does differ, by orders of magnitude, is how often a cell is reached: surviving 20
  // reveals against 4 mines is astronomically rarer than surviving one. The honest measure of
  // what live play left unconfirmed is therefore the share of reachable outcome probability
  // sitting on cells no captured bet touched.
  const probSurvive = (m: number, k: number): number => {
    let p = 1;
    for (let i = 0; i < k; i++) p *= winChance(m, i);
    return p;
  };

  let totalCells = 0, observedCells = 0, uncoveredProbMass = 0, totalProbMass = 0;
  const uncoveredCells: Array<Record<string, unknown>> = [];
  for (const m of expected) {
    for (let k = 1; k <= 25 - m; k++) {
      totalCells++;
      const p    = probSurvive(m, k);
      const mult = theoreticalMultiplier(m, k, 0.001);
      totalProbMass += p;
      if (seenCells.has(`${m}|${k}`)) observedCells++;
      else {
        uncoveredProbMass += p;
        uncoveredCells.push({ minesCount: m, reveals: k, probabilityOfReaching: p, multiplier: mult });
      }
    }
  }
  uncoveredCells.sort((a, b) => (b.probabilityOfReaching as number) - (a.probabilityOfReaching as number));
  const uncoveredProbShare = totalProbMass > 0 ? uncoveredProbMass / totalProbMass : 0;

  ctx.payoutCoverage = {
    mineCounts: MINE_COUNTS,
    minBetsPerMineCount: MIN_BETS_PER_MINE_COUNT,
    betsPerMineCount,
    totalPayoutCells: totalCells,
    cellsExercisedByLivePlay: observedCells,
    cellsNeverExercised: uncoveredCells.length,
    uncoveredProbabilityShare: uncoveredProbShare,
    note: 'A payout cell is one (mines_count, reveals k) multiplier the game can produce, k running '
      + 'from 1 to the 25 - m safe tiles. The primary dataset is k=1 only; all k>1 coverage comes from '
      + 'the Phase E corpus scored by steps 20-23. `cellsNeverExercised` are the combinations no '
      + 'captured bet reached, so neither corpus confirms their multipliers directly. The weight is '
      + 'probability, NOT RTP share: P(survive k) x multiplier(m, k) equals 0.999 for every cell by the '
      + 'identity step 16 proves, so RTP share would merely restate the cell count, while the chance of '
      + 'ever reaching a cell varies enormously. Step 16 covers the formula analytically, from '
      + 'probabilities derived independently of the operator config.',
    uncoveredCells,
  };

  const configIssues: string[] = [];

  // THE PLAN IN CODE (profile MINES-15). The floor above is counted over the whole primary dataset;
  // the profile asks for PHASE A to cover every mine count against the plan, and for the
  // multi-reveal phase's mine counts, depths and first picks to be asserted, not measured.
  const phaseACounts: Record<number, number> = {};
  for (const b of ctx.phaseA) phaseACounts[b.request.mines_count] = (phaseACounts[b.request.mines_count] ?? 0) + 1;
  const phaseAOffPlan = expected.filter(m => (phaseACounts[m] ?? 0) !== PHASE_A_BETS_PER_MINE_COUNT)
    .map(m => `mines=${m}: ${phaseACounts[m] ?? 0}`);
  const phaseABelowFloor = expected.filter(m => (phaseACounts[m] ?? 0) < PHASE_A_FLOOR_PER_CONFIG);
  if (phaseAOffPlan.length > 0) {
    configIssues.push(`Phase A off its plan of ${PHASE_A_BETS_PER_MINE_COUNT} per mine count on ${phaseAOffPlan.length}: ${phaseAOffPlan.slice(0, 5).join(', ')}`);
  }
  if (phaseABelowFloor.length > 0) {
    configIssues.push(`Phase A below the profile floor of ${PHASE_A_FLOOR_PER_CONFIG} on mine count(s) ${phaseABelowFloor.join(', ')}`);
  }
  const phaseEOffPlan: string[] = [];
  const phaseEDepths = new Set<number>(), phaseEMines = new Set<number>();
  for (const [sub, plan] of Object.entries(PHASE_E_PLAN)) {
    const rows = ctx.phaseEBets.filter(b => b.phase === sub);
    if (rows.length !== plan.bets) phaseEOffPlan.push(`${sub}: ${rows.length} bets != ${plan.bets}`);
    const badMines = rows.filter(b => !plan.mines.includes(b.request.mines_count) || b.response.mines_count !== b.request.mines_count).length;
    const badDepth = rows.filter(b => b.request.target_k !== plan.targetK).length;
    if (badMines) phaseEOffPlan.push(`${sub}: ${badMines} bet(s) off the planned mine counts ${plan.mines.join('/')}`);
    if (badDepth) phaseEOffPlan.push(`${sub}: ${badDepth} bet(s) off the planned target depth ${plan.targetK}`);
    const minesSeen = new Set(rows.map(b => b.request.mines_count));
    if (minesSeen.size !== plan.mines.length) phaseEOffPlan.push(`${sub}: ${minesSeen.size} mine count(s) served, plan has ${plan.mines.length}`);
    if (plan.firstPicks) {
      const fp = new Set(rows.map(b => b.reveal_steps?.[0]?.position));
      if (fp.size !== plan.firstPicks.length || plan.firstPicks.some(t => !fp.has(t))) {
        phaseEOffPlan.push(`${sub}: first picks ${[...fp].join(',')} != plan ${plan.firstPicks.join(',')}`);
      }
    }
    phaseEDepths.add(plan.targetK);
    for (const m of plan.mines) phaseEMines.add(m);
  }
  if (phaseEOffPlan.length > 0) configIssues.push(`multi-reveal phase off its plan: ${phaseEOffPlan.slice(0, 4).join('; ')}`);
  const firstPicks = new Set(ctx.phaseEBets.map(b => b.reveal_steps?.[0]?.position));
  const firstPickSpan = [...firstPicks].filter(t => Number.isInteger(t) && (t as number) >= 0 && (t as number) <= 24).length;
  if (firstPickSpan < FIRST_PICK_TILES_REQUIRED) {
    configIssues.push(`first picks span ${firstPickSpan} of ${FIRST_PICK_TILES_REQUIRED} tiles`);
  }

  if (missing.length > 0) {
    configIssues.push(`${missing.length} mine count(s) never played: ${missing.join(', ')}`);
  }
  if (belowFloor.length > 0) {
    configIssues.push(`${belowFloor.length} mine count(s) below the ${MIN_BETS_PER_MINE_COUNT}-bet floor: ${belowFloor.join(', ')}`);
  }

  const s11 = step(11, 'Config Completeness & Payout-Cell Coverage',
    configIssues.length === 0 ? 'PASS' : 'FLAG',
    configIssues.length > 0
      ? configIssues.join('; ')
      : `All ${MINE_COUNTS} mine counts carry at least ${MIN_BETS_PER_MINE_COUNT} live bets, and Phase A matches its `
        + `plan of ${PHASE_A_BETS_PER_MINE_COUNT} per mine count (profile floor ${PHASE_A_FLOOR_PER_CONFIG}). The multi-reveal `
        + `phase matches its plan in code (${Object.keys(PHASE_E_PLAN).length} sub-phases, bets, mine counts and target depths), `
        + `covering ${phaseEDepths.size} depths and ${phaseEMines.size} mine counts, and its first picks span all `
        + `${FIRST_PICK_TILES_REQUIRED} tiles. Payout-cell coverage across (mines, reveals), and the share of `
        + `reachable probability on cells live play never reached, are itemised in outputs/payout-coverage.json; `
        + `the formula itself is covered analytically by step 16.`,
    {
      mineCountsCovered: Object.keys(betsPerMineCount).length,
      mineCountsExpected: MINE_COUNTS,
      minBetsPerMineCount: MIN_BETS_PER_MINE_COUNT,
      leanestMineCountBets: Math.min(...expected.map(m => betsPerMineCount[m] ?? 0)),
      totalPayoutCells: totalCells,
      cellsExercisedByLivePlay: observedCells,
      cellsNeverExercised: uncoveredCells.length,
      uncoveredProbabilityShare: uncoveredProbShare,
      phaseAPerMineCount: PHASE_A_BETS_PER_MINE_COUNT, phaseAOffPlan: phaseAOffPlan.length,
      phaseESubPhasesOffPlan: phaseEOffPlan.length, phaseEDepths: [...phaseEDepths].sort((a, b) => a - b),
      phaseEMineCounts: [...phaseEMines].sort((a, b) => a - b), firstPickTilesSpanned: firstPickSpan,
    },
  );

  // ── Step 12: House edge audit ─────────────────────────────────────────────────
  // effective_edge === 0.1 for all bets
  let edgeErrors = 0;
  for (const b of bets) {
    if (b.response.effective_edge !== 0.1) edgeErrors++;
  }
  const s12 = step(12, 'House Edge Audit (effective_edge = 0.1%)',
    edgeErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets: effective_edge = 0.1 (0.1%) for all; ${edgeErrors} deviations`,
  );

  return [s7, s8, s9, s10, s11, s12];
}
