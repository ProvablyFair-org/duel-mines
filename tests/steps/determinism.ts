/**
 * Steps 5–6: RNG Determinism
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { computeMinePositionsFromBuffer, computeMinePositions } from '../../src/rng';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap } = ctx;

  // ── Step 5: Mine position recomputation ─────────────────────────────────────
  let mismatches = 0;
  let skipped    = 0;
  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { skipped++; continue; }
    const key      = Buffer.from(ss, 'hex');
    const computed = computeMinePositionsFromBuffer(key, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
    const actual   = [...b.response.mines_positions].sort((a, c) => a - c);
    if (computed.length !== actual.length || !computed.every((v, i) => v === actual[i])) mismatches++;
  }
  ctx.step5Mismatches = mismatches;
  ctx.step5Skipped    = skipped;
  const s5 = step(5, 'Mine Position Recomputation',
    mismatches === 0 ? 'PASS' : 'FAIL',
    `${bets.length - skipped}/${bets.length} verified, ${mismatches} mismatches, ${skipped} skipped (unrevealed seeds)`,
  );

  // ── Step 6: Client seed influence ─────────────────────────────────────────────
  const WRONG_CLIENT = 'wrong-client-seed-test';
  let tested  = 0;
  let changed = 0;
  // Sample ~5 bets per epoch
  const byEpoch = new Map<string, typeof bets>();
  for (const b of bets) {
    const arr = byEpoch.get(b.seed.serverSeedHashed) ?? [];
    arr.push(b);
    byEpoch.set(b.seed.serverSeedHashed, arr);
  }
  for (const [hash, epochBets] of byEpoch) {
    const ss = seedMap.get(hash);
    if (!ss) continue;
    for (const b of epochBets.slice(0, 5)) {
      tested++;
      const correct = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
      const wrong   = computeMinePositions(ss, WRONG_CLIENT, b.seed.nonce, b.request.mines_count);
      if (correct.join(',') !== wrong.join(',')) changed++;
    }
  }
  const s6 = step(6, 'Client Seed Influence',
    changed === tested ? 'PASS' : changed / tested > 0.95 ? 'PASS' : 'FAIL',
    `${changed}/${tested} bets: wrong clientSeed → different mine positions`,
  );

  return [s5, s6];
}
