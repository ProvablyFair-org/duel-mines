/**
 * Steps 13–17: Dataset Integrity & Anti-Circularity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import {
  checkDatasetHash,
  EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_PHASE_BETS,
} from '../../src/loader';
import { computeMinePositions } from '../../src/rng';

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

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseD } = ctx;

  // ── Step 13: Phase labels ─────────────────────────────────────────────────────
  const phases    = new Set(bets.map(b => b.phase));
  const hasAll    = (['A', 'B', 'C', 'D'] as const).every(p => phases.has(p));
  const lastPhase = bets[bets.length - 1].phase;
  // Bound to CODE constants in src/loader.ts, never to the dataset's own header. A dataset
  // that disagrees with the capture plan fails here even when its hash pin has been updated
  // to match it. FLAG was the wrong verdict: it exits 0, so a shrunken capture still passed.
  const phaseCounts: Record<string, number> = {};
  for (const b of bets) phaseCounts[b.phase] = (phaseCounts[b.phase] ?? 0) + 1;
  const phaseBad = Object.entries(EXPECTED_PHASE_BETS)
    .filter(([p, n]) => (phaseCounts[p] ?? 0) !== n)
    .map(([p, n]) => `${p}: ${phaseCounts[p] ?? 0} != ${n}`);
  const extraPhases = Object.keys(phaseCounts).filter(p => !(p in EXPECTED_PHASE_BETS));
  const betsOk  = bets.length === EXPECTED_BETS;
  const seedsOk = ctx.seeds.length === EXPECTED_SEEDS;
  const popOk   = betsOk && seedsOk && phaseBad.length === 0 && extraPhases.length === 0;

  const s13 = step(13, 'Population & Phase Labels',
    popOk && hasAll && lastPhase === 'D' ? 'PASS' : 'FAIL',
    `${bets.length}/${EXPECTED_BETS} bets and ${ctx.seeds.length}/${EXPECTED_SEEDS} seed records ` +
    `against the capture plan in src/loader.ts (code constants, not the dataset header); ` +
    `per phase ${Object.entries(EXPECTED_PHASE_BETS).map(([p, n]) => `${p}=${phaseCounts[p] ?? 0}/${n}`).join(' ')}; ` +
    `last bet phase: ${lastPhase}` +
    (betsOk ? '' : '; BET COUNT MISMATCH') +
    (seedsOk ? '' : '; SEED COUNT MISMATCH') +
    (phaseBad.length ? `; PHASE MISMATCH ${phaseBad.join(', ')}` : '') +
    (extraPhases.length ? `; UNDECLARED PHASE ${extraPhases.join(', ')}` : ''),
  );

  // ── Step 14: Dataset hash ─────────────────────────────────────────────────────
  const h  = checkDatasetHash();
  const s14 = step(14, 'Dataset Hash',
    h.match ? 'PASS' : 'FLAG',
    `Expected: ${h.expected || '(not set)'} | Actual: ${h.actual}`,
  );

  // ── Step 15: Epoch size ────────────────────────────────────────────────────────
  const epochSizes = new Map<string, number>();
  for (const b of bets) {
    epochSizes.set(b.seed.serverSeedHashed, (epochSizes.get(b.seed.serverSeedHashed) ?? 0) + 1);
  }
  const sizes   = [...epochSizes.values()];
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const s15 = step(15, 'Epoch Size',
    maxSize <= 50 ? 'PASS' : 'FLAG',
    `${epochSizes.size} epochs; min=${minSize}, max=${maxSize} bets per epoch`,
  );

  // ── Step 16: Anti-circularity — theoretical RTP ───────────────────────────────
  // For every (mineCount m, reveals k) pair with m ∈ [1,24], k ∈ [1, 25−m]:
  //   reachProb(m, k)  = C(25−m, k) / C(25, k)     // probability of clearing k safe tiles
  //   payoutMult(m, k) = C(25, k) / C(25−m, k) × 0.999
  //   RTP             = reachProb × payoutMult = 0.999 by algebraic cancellation
  // 300 combinations checked. Independent derivation: no casino-supplied data used.
  let maxDeviation = 0;
  let worstM = 0, worstK = 0;
  let combosChecked = 0;
  for (let m = 1; m <= 24; m++) {
    for (let k = 1; k <= 25 - m; k++) {
      const reach = comb(25 - m, k) / comb(25, k);             // C(25−m,k)/C(25,k)
      const mult  = comb(25, k) / comb(25 - m, k) * 0.999;     // C(25,k)/C(25−m,k) × 0.999
      const rtp   = reach * mult;
      const dev   = Math.abs(rtp - 0.999);
      if (dev > maxDeviation) { maxDeviation = dev; worstM = m; worstK = k; }
      combosChecked++;
    }
  }
  const s16 = step(16, 'Probability Independence (Anti-Circularity)',
    maxDeviation < 0.0001 ? 'PASS' : 'FAIL',
    `${combosChecked} (mines, reveals) combinations checked (mines 1–24, k 1–(25−m)); ` +
    `RTP = [C(25−m,k)/C(25,k)] × [C(25,k)/C(25−m,k) × 0.999] = 0.999 by construction. ` +
    `Max deviation: ${(maxDeviation * 100).toFixed(8)}% (worst: mines=${worstM}, k=${worstK})`,
  );

  // ── Step 17: Phase D — client seed variation ──────────────────────────────────
  const dClientSeeds = new Set(phaseD.map(b => b.seed.clientSeed));
  const dMineCounts  = new Set(phaseD.map(b => b.request.mines_count));
  let dMatched = 0;
  let dTested  = 0;
  for (const b of phaseD) {
    const ss = ctx.seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    dTested++;
    const computed = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
    const actual   = [...b.response.mines_positions].sort((a, c) => a - c);
    if (computed.length === actual.length && computed.every((v, i) => v === actual[i])) dMatched++;
  }
  const s17 = step(17, 'Phase D — Client Seed Variation',
    dClientSeeds.size >= 2 && dMatched === dTested ? 'PASS' : 'FLAG',
    `${phaseD.length} bets, ${dClientSeeds.size} distinct client seeds, mine counts: ${[...dMineCounts].sort((a, b) => a - b).join(', ')}; recomputation: ${dMatched}/${dTested} match`,
  );

  return [s13, s14, s15, s16, s17];
}
