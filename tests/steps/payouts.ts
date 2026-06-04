/**
 * Steps 7–12: Payout Verification
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { theoreticalMultiplier } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseC } = ctx;

  // ── Step 7: Payout math ───────────────────────────────────────────────────────
  // Wins: amount_won ≈ amount × no_house_edge_multiplier (tolerance 1e-8)
  // Losses: amount_won === '0'
  let payoutErrors = 0;
  for (const b of bets) {
    if (b.response.outcome === 'win') {
      const amt  = parseFloat(b.request.amount);
      const nhe  = parseFloat(b.response.no_house_edge_multiplier ?? '0');
      const won  = parseFloat(b.response.amount_won);
      if (Math.abs(amt * nhe - won) > 1e-8) payoutErrors++;
    } else {
      if (b.response.amount_won !== '0') payoutErrors++;
    }
  }
  const s7 = step(7, 'Payout Math',
    payoutErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets checked, ${payoutErrors} errors (tolerance 1e-8)`,
  );

  // ── Step 8: Multiplier formula ────────────────────────────────────────────────
  // multiplier (no-edge) = C(25,1)/C(25-m,1) = 25/(25-m) = theoreticalMultiplier(m, 1, 0)
  // no_house_edge_multiplier (with-edge) = 25/(25-m) × 0.999 = theoreticalMultiplier(m, 1, 0.001)
  let multErrors = 0;
  for (const b of bets) {
    if (b.response.outcome !== 'win') continue;
    const m       = b.request.mines_count;
    const expNoEdge = theoreticalMultiplier(m, 1, 0);
    const actNoEdge = parseFloat(b.response.multiplier);
    if (Math.abs(expNoEdge - actNoEdge) > 1e-6) multErrors++;

    const expEdge = theoreticalMultiplier(m, 1, 0.001);
    const actEdge = parseFloat(b.response.no_house_edge_multiplier ?? '0');
    if (Math.abs(expEdge - actEdge) > 1e-6) multErrors++;
  }
  const wins = bets.filter(b => b.response.outcome === 'win').length;
  const s8 = step(8, 'Multiplier Formula (C(25,1)/C(25-m,1) × edge)',
    multErrors === 0 ? 'PASS' : 'FAIL',
    `${wins} winning bets: multiplier = 25/(25−m), payout_mult = 25/(25−m) × 0.999; ${multErrors} mismatches`,
  );

  // ── Step 9: Win condition ─────────────────────────────────────────────────────
  // outcome='win' iff revealed_positions[0] NOT in mines_positions
  let condErrors = 0;
  for (const b of bets) {
    const tile0 = b.response.revealed_positions[0];
    const hitMine = b.response.mines_positions.includes(tile0);
    const expectedOutcome = hitMine ? 'loss' : 'win';
    if (b.response.outcome !== expectedOutcome) condErrors++;
  }
  const s9 = step(9, 'Win Condition (tile not in mines)',
    condErrors === 0 ? 'PASS' : 'FAIL',
    `${bets.length} bets verified: outcome=win iff revealed_positions[0] ∉ mines_positions; ${condErrors} errors`,
  );

  // ── Step 10: Phase C bet-size invariance ──────────────────────────────────────
  // $10 bets recompute correctly with same formula
  let cErrors = 0;
  let cChecked = 0;
  for (const b of phaseC) {
    if (b.response.outcome !== 'win') continue;
    cChecked++;
    const m       = b.request.mines_count;
    const expMult = theoreticalMultiplier(m, 1, 0);
    const actMult = parseFloat(b.response.multiplier);
    if (Math.abs(expMult - actMult) > 1e-6) cErrors++;
    const amt = parseFloat(b.request.amount);
    const nhe = parseFloat(b.response.no_house_edge_multiplier ?? '0');
    const won = parseFloat(b.response.amount_won);
    if (Math.abs(amt * nhe - won) > 1e-8) cErrors++;
  }
  const s10 = step(10, 'Phase C Bet-Size Invariance ($10 bets)',
    cErrors === 0 && cChecked > 0 ? 'PASS' : cChecked === 0 ? 'FLAG' : 'FAIL',
    `${phaseC.length} Phase C bets ($10), ${cChecked} wins: multiplier formula identical, payout math correct; ${cErrors} errors`,
  );

  // ── Step 11: Config completeness ──────────────────────────────────────────────
  // All 24 mine counts (1–24) present in dataset
  const mineCounts = new Set(bets.map(b => b.request.mines_count));
  const expected = Array.from({ length: 24 }, (_, i) => i + 1);
  const missing  = expected.filter(m => !mineCounts.has(m));
  const s11 = step(11, 'Config Completeness (24 mine counts)',
    missing.length === 0 ? 'PASS' : 'FLAG',
    `${mineCounts.size}/24 mine counts present${missing.length > 0 ? `; missing: ${missing.join(', ')}` : ''}`,
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
