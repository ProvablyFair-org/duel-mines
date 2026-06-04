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
import { computeMinePositions, theoreticalMultiplier } from '../../src/rng';

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

export function run(
  phaseEBets: MinesGame[],
  seedMap: Map<string, string>,
): StepResult[] {

  // ── Step 20: Multi-reveal multiplier chain ──────────────────────────────────
  // For each reveal step k in a multi-reveal bet, verify:
  //   multiplier = C(25, k) / C(25 - m, k)  (no-edge display multiplier)
  // This is the core gap: k>1 multipliers were never verified against live data.
  let multChecked = 0;
  let multErrors  = 0;
  let multKMax    = 0;
  const kCoverage = new Set<number>();

  for (const b of phaseEBets) {
    if (!b.reveal_steps || b.reveal_steps.length === 0) continue;
    const m = b.response.mines_count;

    for (const rs of b.reveal_steps) {
      if (rs.is_mine) continue; // mine hit — no multiplier to verify
      if (!rs.multiplier) continue;
      multChecked++;
      const k = rs.step; // step is 1-indexed (step 1 = first reveal = k=1)
      kCoverage.add(k);
      if (k > multKMax) multKMax = k;

      const expected = theoreticalMultiplier(m, k, 0); // no-edge multiplier
      const actual   = parseFloat(rs.multiplier);
      if (Math.abs(expected - actual) > 1e-6) {
        multErrors++;
      }
    }
  }

  const s20 = step(20, 'Multi-Reveal Multiplier Chain',
    multErrors === 0 && multChecked > 0 ? 'PASS' : multChecked === 0 ? 'FLAG' : 'FAIL',
    `${multChecked} reveal steps verified across k={${[...kCoverage].sort((a, b) => a - b).join(',')}} (max k=${multKMax}); ` +
    `formula C(25,k)/C(25-m,k) matches API multiplier at each step; ${multErrors} mismatches`,
  );

  // ── Step 21: Mine-set invariance ────────────────────────────────────────────
  // Recompute mine positions from (serverSeed, clientSeed, nonce, mineCount)
  // for Phase E bets and verify they match the API-returned mines_positions.
  // This proves the mine layout is determined at round start and doesn't change
  // during multi-reveal sequences.
  let invChecked = 0;
  let invErrors  = 0;
  let invSkipped = 0;

  for (const b of phaseEBets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { invSkipped++; continue; }
    // Only bets with API-returned mine positions can be checked here
    if (b.response.mines_positions.length === 0) continue;
    invChecked++;
    const computed = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
    const actual   = [...b.response.mines_positions].sort((a, c) => a - c);
    if (computed.length !== actual.length || !computed.every((v, i) => v === actual[i])) {
      invErrors++;
    }
  }

  const s21 = step(21, 'Mine-Set Invariance Across Reveals',
    invErrors === 0 && invChecked > 0 ? 'PASS' : invChecked === 0 ? 'FLAG' : 'FAIL',
    `${invChecked} Phase E bets with API-returned mine sets checked: mine layout recomputed from RNG matches API response ` +
    `(mine set fixed at round start, unchanged by reveal sequence); ${invErrors} mismatches, ${invSkipped} skipped (unrevealed seeds)`,
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

  const s22 = step(22, 'Reveal-Position Independence (Phase E5)',
    posErrors === 0 && posChecked > 0 ? 'PASS' : posChecked === 0 ? 'FLAG' : 'FAIL',
    `${posChecked} bets with varied reveal positions (tiles: {${[...tilesSeen].sort((a, b) => a - b).join(',')}}); ` +
    `mine recomputation + win condition correct for all non-zero tile reveals; ${posErrors} errors`,
  );

  // ── Step 23: Cash-out payout correctness ────────────────────────────────────
  // For multi-reveal wins that cashed out, independently derive all three values
  // and compare to the API response (no echoing of API fields into the check):
  //   expectedNoEdge = C(25,k) / C(25−m,k)            → response.multiplier
  //   expectedEdge   = expectedNoEdge × 0.999         → response.no_house_edge_multiplier
  //   expectedPayout = amount × expectedEdge          → response.amount_won
  let coChecked = 0;
  let coErrors  = 0;
  const kPayouts = new Map<number, number>(); // k → count of verified payouts

  for (const b of phaseEBets) {
    if (!b.response.cashed_out || b.response.outcome !== 'win') continue;
    const reachedK = b.response.reached_k ?? b.response.revealed_positions.length;
    if (reachedK <= 1) continue; // k=1 already covered by Step 8
    coChecked++;
    kPayouts.set(reachedK, (kPayouts.get(reachedK) ?? 0) + 1);

    const m = b.response.mines_count;

    // Independently derived expectations
    const expectedNoEdge = comb(25, reachedK) / comb(25 - m, reachedK);
    const expectedEdge   = expectedNoEdge * 0.999;
    const amt            = parseFloat(b.request.amount);
    const expectedPayout = amt * expectedEdge;

    // API-reported values
    const actNoEdge = parseFloat(b.response.multiplier);
    const actEdge   = parseFloat(b.response.no_house_edge_multiplier ?? '0');
    const actWon    = parseFloat(b.response.amount_won);

    if (Math.abs(expectedNoEdge - actNoEdge) > 1e-6) coErrors++;
    if (Math.abs(expectedEdge   - actEdge)   > 1e-6) coErrors++;
    if (Math.abs(expectedPayout - actWon)    > 1e-8) coErrors++;
  }

  const kPayoutSummary = [...kPayouts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([k, n]) => `k=${k}:${n}`)
    .join(', ');

  const s23 = step(23, 'Cash-Out Payout Correctness (k>1)',
    coErrors === 0 && coChecked > 0 ? 'PASS' : coChecked === 0 ? 'FLAG' : 'FAIL',
    `${coChecked} multi-reveal cash-outs verified (${kPayoutSummary}); ` +
    `noEdge = C(25,k)/C(25−m,k), edge = noEdge × 0.999, payout = amount × edge — all derived independently and matched against API response; ${coErrors} errors`,
  );

  return [s20, s21, s22, s23];
}
