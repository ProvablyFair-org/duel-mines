/**
 * Steps 20–23: Phase E — Multi-Reveal Verification
 *
 * Covers the gaps identified in the k=1-only primary dataset:
 *   Step 20: Multi-reveal multiplier chain (C(25,k)/C(25-m,k) × 0.999 at each k)
 *   Step 21: Mine-set invariance (same nonce → same mines regardless of reveal sequence)
 *   Step 22: Reveal-position independence (different tiles, same formula)
 *   Step 23: Cash-out payout correctness (final payout = bet × multiplier at reached_k)
 */

import type { StepResult } from './context';
import { step } from './context';
import type { MinesGame } from '../../src/types';
import { computeMinePositions } from '../../src/rng';
import {
  EXPECTED_PHASE_E_BETS, EXPECTED_PHASE_E_BETS_BY_PHASE, EXPECTED_PHASE_E_REVEAL_STEPS,
  EXPECTED_PHASE_E_MAX_K, EXPECTED_PHASE_E_MINE_DISCLOSURES, EXPECTED_PHASE_E5_BETS,
  EXPECTED_PHASE_E_CASHOUTS_K_GT_1, EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL,
  EXPECTED_PHASE_E_NON_ASCENDING_ORDERS,
} from '../../src/loader';
import { moneyTol, MONEY_REL_TOL, newDev, track } from './payouts';
import { exactMultiplier, relativeDeviation, MULT_REL_TOL } from '../../src/exact';

/**
 * Steps 20–23 are the ONLY evidence for the k>1 multi-reveal case, and they are scored
 * against the Phase E corpus alone. Each previously passed on `checked > 0` — one surviving
 * bet was enough — and FLAGGED rather than FAILED when the corpus was empty, so deleting the
 * Phase E file downgraded four scored steps to warnings instead of failing the run. Every
 * denominator below is now bound to the population declared in src/loader.ts.
 */
export function run(
  phaseEBets: MinesGame[],
  seedMap: Map<string, string>,
): StepResult[] {
  const phaseCounts: Record<string, number> = {};
  for (const b of phaseEBets) phaseCounts[b.phase] = (phaseCounts[b.phase] ?? 0) + 1;
  const corpusIssues: string[] = [];
  if (phaseEBets.length !== EXPECTED_PHASE_E_BETS) {
    corpusIssues.push(`Phase E bets ${phaseEBets.length} != ${EXPECTED_PHASE_E_BETS}`);
  }
  for (const [p, n] of Object.entries(EXPECTED_PHASE_E_BETS_BY_PHASE)) {
    const got = phaseCounts[p] ?? 0;
    if (got !== n) corpusIssues.push(`phase ${p} ${got} != ${n}`);
  }
  const corpusNote = corpusIssues.length > 0
    ? `PHASE E POPULATION MISMATCH vs src/loader.ts: ${corpusIssues.join('; ')}`
    : '';

  // ── Step 20: Multi-reveal multiplier chain ──────────────────────────────────
  // For each reveal step k in a multi-reveal bet, verify:
  //   multiplier = C(25, k) / C(25 - m, k)  (no-edge display multiplier)
  // This is the core gap: k>1 multipliers were never verified against live data.
  //
  // EVERY RUNG, MINE STEPS INCLUDED. A mine step used to be skipped by its own flag (`if
  // (rs.is_mine) continue`), yet every one of the 378 carries a recorded multiplier — the figure
  // standing BEFORE the fatal reveal, i.e. the formula at depth k − 1 (1 at k − 1 = 0). A bogus
  // figure there was never examined. Both kinds are compared with the exact rational at
  // MULT_REL_TOL, and a rung with no multiplier at all FAILs rather than being skipped.
  let multChecked = 0;
  let multErrors  = 0;
  let multKMax    = 0;
  let mineRungsChecked = 0, missingMultipliers = 0;
  const kCoverage = new Set<number>();
  const s20Dev = newDev();

  for (const b of phaseEBets) {
    if (!b.reveal_steps || b.reveal_steps.length === 0) continue;
    const m = b.response.mines_count;

    for (const rs of b.reveal_steps) {
      const k = rs.step; // step is 1-indexed (step 1 = first reveal = k=1)
      if (!rs.multiplier) { missingMultipliers++; continue; }
      if (rs.is_mine) {
        // The multiplier standing before the fatal reveal: depth k − 1 (exactly 1 at k − 1 = 0).
        mineRungsChecked++;
        const standing = k - 1 === 0 ? { num: 1n, den: 1n } : exactMultiplier(m, k - 1, false);
        if (!track(s20Dev, relativeDeviation(rs.multiplier, standing), `round ${b.response.round_id} mine step ${k}`)) multErrors++;
        continue;
      }
      multChecked++;
      kCoverage.add(k);
      if (k > multKMax) multKMax = k;
      if (!track(s20Dev, relativeDeviation(rs.multiplier, exactMultiplier(m, k, false)), `round ${b.response.round_id} step ${k}`)) {
        multErrors++;
      }
    }
  }

  const s20Issues = [...corpusIssues];
  if (multChecked !== EXPECTED_PHASE_E_REVEAL_STEPS) {
    s20Issues.push(`reveal steps carrying a multiplier ${multChecked} != ${EXPECTED_PHASE_E_REVEAL_STEPS}`);
  }
  if (multKMax !== EXPECTED_PHASE_E_MAX_K) {
    s20Issues.push(`deepest reveal k=${multKMax} != ${EXPECTED_PHASE_E_MAX_K}`);
  }
  if (mineRungsChecked !== EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL - EXPECTED_PHASE_E_REVEAL_STEPS) {
    s20Issues.push(`mine steps carrying a multiplier ${mineRungsChecked} != ${EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL - EXPECTED_PHASE_E_REVEAL_STEPS}`);
  }
  if (missingMultipliers > 0) s20Issues.push(`${missingMultipliers} reveal step(s) carry no multiplier`);
  const s20 = step(20, 'Multi-Reveal Multiplier Chain',
    multErrors === 0 && s20Issues.length === 0 ? 'PASS' : 'FAIL',
    multErrors > 0
      ? `${multErrors} of ${multChecked + mineRungsChecked} reveal steps disagree with C(25,k)/C(25-m,k) (relative bound ${MULT_REL_TOL})`
      : s20Issues.length > 0
        ? (corpusNote || `PHASE E POPULATION MISMATCH vs src/loader.ts: ${s20Issues.join('; ')}`)
        : `All ${EXPECTED_PHASE_E_REVEAL_STEPS} non-mine reveal steps across the ${EXPECTED_PHASE_E_BETS}-bet `
          + `Phase E corpus, spanning k=1..${EXPECTED_PHASE_E_MAX_K}: the API multiplier equals the exact rational `
          + `C(25,k)/C(25-m,k) at every step (relative bound ${MULT_REL_TOL}), and on each of the `
          + `${EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL - EXPECTED_PHASE_E_REVEAL_STEPS} mine steps the multiplier standing before `
          + `the fatal reveal equals the formula at depth k-1.`,
    { revealStepsChecked: multChecked, expectedRevealSteps: EXPECTED_PHASE_E_REVEAL_STEPS,
      mineStepsChecked: mineRungsChecked, missingMultipliers,
      kValues: [...kCoverage].sort((a, b) => a - b), maxK: multKMax, mismatches: multErrors,
      multRelTol: MULT_REL_TOL, worstRelativeDeviation: s20Dev.worst, worstAt: s20Dev.where },
  );

  // ── Step 21: Mine-set invariance ────────────────────────────────────────────
  // Recompute mine positions from (serverSeed, clientSeed, nonce, mineCount)
  // for Phase E bets and verify they match the API-returned mines_positions.
  // This proves the mine layout is determined at round start and doesn't change
  // during multi-reveal sequences.
  //
  // REVEAL-ORDER INDEPENDENCE is the second half of the same claim and was never asserted:
  // comparing the FINAL mines_positions says nothing about what the game reported at each
  // intermediate step, and every earlier form of this step only looked at the end state. Here
  // every reveal step's `is_mine` is checked against the seed-derived layout at the tile it
  // opened, and each step's `revealed_positions` must be the exact prefix of the tiles opened
  // so far. The evidence only exists if some bets opened tiles OUT of ascending order — if every
  // sequence were 0,1,2,… the order could be a hidden input and nothing here would notice — so
  // the count of non-ascending orders is bound to the capture plan in src/loader.ts.
  let invChecked = 0;
  let invErrors  = 0;
  let invSkipped = 0;
  let stepsChecked = 0, stepErrors = 0, prefixErrors = 0, nonAscending = 0, betsWithSteps = 0;

  for (const b of phaseEBets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { invSkipped++; continue; }
    const computed = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
    // Only loss bets reveal mines_positions in API response
    if (b.response.mines_positions.length > 0) {
      invChecked++;
      const actual = [...b.response.mines_positions].sort((a, c) => a - c);
      if (computed.length !== actual.length || !computed.every((v, i) => v === actual[i])) {
        invErrors++;
      }
    }
    if (!b.reveal_steps || b.reveal_steps.length === 0) continue;
    betsWithSteps++;
    const mineSet = new Set(computed);
    const opened: number[] = [];
    let ascending = true;
    for (const rs of b.reveal_steps) {
      stepsChecked++;
      if (opened.length > 0 && rs.position < opened[opened.length - 1]) ascending = false;
      opened.push(rs.position);
      if (rs.is_mine !== mineSet.has(rs.position)) stepErrors++;
      const rp = rs.revealed_positions;
      if (rp.length !== opened.length || !rp.every((v, i) => v === opened[i])) prefixErrors++;
    }
    if (!ascending) nonAscending++;
  }

  const s21Issues = [...corpusIssues];
  if (invSkipped !== 0) {
    s21Issues.push(`${invSkipped} Phase E bet(s) not recomputable — their epoch seed was never revealed`);
  }
  if (invChecked !== EXPECTED_PHASE_E_MINE_DISCLOSURES) {
    s21Issues.push(`bets disclosing mines_positions ${invChecked} != ${EXPECTED_PHASE_E_MINE_DISCLOSURES}`);
  }
  if (stepsChecked !== EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL) {
    s21Issues.push(`reveal steps ${stepsChecked} != ${EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL}`);
  }
  if (nonAscending !== EXPECTED_PHASE_E_NON_ASCENDING_ORDERS) {
    s21Issues.push(`non-ascending reveal orders ${nonAscending} != ${EXPECTED_PHASE_E_NON_ASCENDING_ORDERS}`);
  }
  const s21Errors = invErrors + stepErrors + prefixErrors;
  const s21 = step(21, 'Mine-Set Invariance Across Reveals (per-step, order-independent)',
    s21Errors === 0 && s21Issues.length === 0 ? 'PASS' : 'FAIL',
    s21Errors > 0
      ? `${invErrors} of ${invChecked} final mine layouts, ${stepErrors} of ${stepsChecked} per-step is_mine flags and `
        + `${prefixErrors} step prefixes disagree with the layout recomputed from the RNG`
      : s21Issues.length > 0
        ? `PHASE E POPULATION MISMATCH vs src/loader.ts: ${s21Issues.join('; ')}`
        : `All ${EXPECTED_PHASE_E_MINE_DISCLOSURES} Phase E bets that disclose mines_positions: the layout `
          + `recomputed from (serverSeed, clientSeed, nonce, mines) matches the API response. At every one of the `
          + `${EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL} reveal steps the reported is_mine equals membership of the opened `
          + `tile in that seed-derived layout, and each step's revealed_positions is the exact prefix of the tiles `
          + `opened so far — including the ${EXPECTED_PHASE_E_NON_ASCENDING_ORDERS} bets that opened tiles out of `
          + `ascending order. The mine set is fixed at round start and independent of the reveal sequence. 0 unverifiable.`,
    { betsChecked: invChecked, expectedDisclosures: EXPECTED_PHASE_E_MINE_DISCLOSURES, mismatches: invErrors, skipped: invSkipped,
      betsWithRevealSteps: betsWithSteps, revealStepsChecked: stepsChecked, expectedRevealSteps: EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL,
      perStepIsMineErrors: stepErrors, prefixErrors, nonAscendingOrders: nonAscending,
      expectedNonAscendingOrders: EXPECTED_PHASE_E_NON_ASCENDING_ORDERS },
  );

  // ── Step 22: Reveal-position independence ───────────────────────────────────
  // Phase E5 bets reveal tiles [3,7,11,17,23] instead of always tile 0.
  // Verify: (a) mine recomputation still matches, (b) win condition is correct
  // (outcome=win iff revealed tile ∉ mines).
  const e5Bets = phaseEBets.filter(b => b.phase === 'E5');
  let posChecked = 0;
  let posErrors  = 0;
  const tilesSeen = new Set<number>();

  for (const b of e5Bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    posChecked++;

    // Track which tiles were revealed
    for (const p of b.response.revealed_positions) tilesSeen.add(p);

    // Recompute mines
    const computed = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);

    // Check win condition: outcome=win iff no revealed position is a mine
    const hitMine = b.response.revealed_positions.some(p => computed.includes(p));
    const expectedOutcome = hitMine ? 'loss' : 'win';
    if (b.response.outcome !== expectedOutcome) posErrors++;

    // If loss, check mines_positions match
    if (b.response.mines_positions.length > 0) {
      const actual = [...b.response.mines_positions].sort((a, c) => a - c);
      if (computed.length !== actual.length || !computed.every((v, i) => v === actual[i])) {
        posErrors++;
      }
    }
  }

  const s22Issues = [...corpusIssues];
  if (posChecked !== EXPECTED_PHASE_E5_BETS) {
    s22Issues.push(`Phase E5 bets recomputed ${posChecked} != ${EXPECTED_PHASE_E5_BETS}`);
  }
  const s22 = step(22, 'Reveal-Position Independence (Phase E5)',
    posErrors === 0 && s22Issues.length === 0 ? 'PASS' : 'FAIL',
    posErrors > 0
      ? `${posErrors} errors across ${posChecked} Phase E5 bets (mine recomputation or win condition)`
      : s22Issues.length > 0
        ? `PHASE E POPULATION MISMATCH vs src/loader.ts: ${s22Issues.join('; ')}`
        : `All ${EXPECTED_PHASE_E5_BETS} Phase E5 bets, which reveal tiles other than tile 0: the mine `
          + `layout recomputes correctly and outcome=win holds exactly when no revealed tile is a mine. `
          + `The revealed POSITION does not alter the layout.`,
    { betsChecked: posChecked, expectedE5Bets: EXPECTED_PHASE_E5_BETS,
      tilesRevealed: [...tilesSeen].sort((a, b) => a - b), errors: posErrors },
  );

  // ── Step 23: Cash-out payout correctness ────────────────────────────────────
  // For multi-reveal wins that cashed out: amount_won = amount × no_house_edge_multiplier
  // and multiplier matches theoreticalMultiplier(m, reached_k, 0).
  let coChecked = 0;
  let coErrors  = 0;
  const s23Dev = newDev();
  const kPayouts = new Map<number, number>(); // k → count of verified payouts

  for (const b of phaseEBets) {
    if (!b.response.cashed_out || b.response.outcome !== 'win') continue;
    // The recorded depth itself — step 9 asserts it equals the opened count on every round.
    const reachedK = b.response.reached_k ?? -1;
    if (reachedK <= 1) continue; // k=1 already covered by Step 7
    coChecked++;
    kPayouts.set(reachedK, (kPayouts.get(reachedK) ?? 0) + 1);

    const m = b.response.mines_count;

    // Final multiplier and the with-edge payout multiplier against the exact rationals at reached_k.
    if (!track(s23Dev, relativeDeviation(b.response.multiplier, exactMultiplier(m, reachedK, false)), `round ${b.response.round_id}`)) coErrors++;
    if (!track(s23Dev, relativeDeviation(b.response.no_house_edge_multiplier, exactMultiplier(m, reachedK, true)), `round ${b.response.round_id} with-edge`)) coErrors++;

    // Check payout = amount × no_house_edge_multiplier, on the same relative money bound as
    // step 7 — the absolute 1e-8 this step carried was the known gap left open by the earlier line.
    const amt = parseFloat(b.request.amount);
    const nhe = parseFloat(b.response.no_house_edge_multiplier ?? '0');
    const won = parseFloat(b.response.amount_won);
    if (!Number.isFinite(won) || Math.abs(amt * nhe - won) > moneyTol(amt * nhe)) coErrors++;
  }

  const kPayoutSummary = [...kPayouts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([k, n]) => `k=${k}:${n}`)
    .join(', ');

  const s23Issues = [...corpusIssues];
  if (coChecked !== EXPECTED_PHASE_E_CASHOUTS_K_GT_1) {
    s23Issues.push(`cash-outs at k>1 ${coChecked} != ${EXPECTED_PHASE_E_CASHOUTS_K_GT_1}`);
  }
  const s23 = step(23, 'Cash-Out Payout Correctness (k>1)',
    coErrors === 0 && s23Issues.length === 0 ? 'PASS' : 'FAIL',
    coErrors > 0
      ? `${coErrors} errors across ${coChecked} multi-reveal cash-outs`
      : s23Issues.length > 0
        ? `PHASE E POPULATION MISMATCH vs src/loader.ts: ${s23Issues.join('; ')}`
        : `All ${EXPECTED_PHASE_E_CASHOUTS_K_GT_1} multi-reveal cash-outs at k>1 (${kPayoutSummary}): the `
          + `final multiplier equals the exact rational C(25,k)/C(25-m,k) at the reached k and the with-edge `
          + `multiplier C(25,k)/C(25-m,k) × 999/1000 (relative bound ${MULT_REL_TOL}), and the payout equals `
          + `amount × with-edge multiplier (money tolerance: relative ${MONEY_REL_TOL}).`,
    { cashOutsChecked: coChecked, expectedCashOuts: EXPECTED_PHASE_E_CASHOUTS_K_GT_1,
      byK: Object.fromEntries([...kPayouts.entries()].sort(([a], [b]) => a - b)), errors: coErrors,
      moneyRelTol: MONEY_REL_TOL, multRelTol: MULT_REL_TOL, worstRelativeDeviation: s23Dev.worst },
  );

  return [s20, s21, s22, s23];
}
