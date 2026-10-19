/**
 * Steps 13–17: Dataset Integrity & Anti-Circularity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import {
  checkDatasetHash, checkPhaseEHash,
  EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_EPOCHS, EPOCH_SIZE,
  EXPECTED_PHASE_BETS, EXPECTED_PHASE_SEEDS,
  EXPECTED_PHASE_E_BETS, EXPECTED_PHASE_E_SEEDS, EXPECTED_PHASE_E_BETS_BY_PHASE, EXPECTED_PHASE_E_SEEDS_BY_PHASE,
  EXPECTED_PHASE_E_EPOCH_SIZES, PHASE_D_PREDICTABLE_EPOCHS, PHASE_D_SEED_PREFIX,
} from '../../src/loader';
import { computeMinePositions, theoreticalMultiplier, winChance } from '../../src/rng';
import { sameLayout } from '../../src/layout';
import { binomialBig, enumerateSurvivalCounts, exactMultiplierAtEdge, compareRational, parseDecimal, MULT_REL_TOL } from '../../src/exact';
import { computeRtpClaim, edgeOfTier } from '../../src/rtp-settings';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seeds, phaseD } = ctx;

  // ── Step 13: Population & Phase Labels ────────────────────────────────────────
  // Labels are not a population. Every figure the old step compared was read from inside the
  // file being scored, so a uniform shrink — drop rounds, drop the matching seeds, adjust the
  // header — kept every label valid, every ratio intact, and passed. Re-pinning the hash after
  // the shrink is exactly what a forger does, so the dataset pin cannot catch it either.
  //
  // The counts come from src/loader.ts, which the dataset does not control, and a mismatch is
  // a FAIL rather than a FLAG: a capture that is not the capture of record is not a warning.
  const phases    = new Set(bets.map(b => b.phase));
  const hasAll    = (['A', 'B', 'C', 'D'] as const).every(p => phases.has(p));
  const lastPhase = bets[bets.length - 1].phase;

  const betPhaseCounts: Record<string, number> = {};
  for (const b of bets) betPhaseCounts[b.phase] = (betPhaseCounts[b.phase] ?? 0) + 1;
  const seedPhaseCounts: Record<string, number> = {};
  for (const s of seeds) seedPhaseCounts[s.phase] = (seedPhaseCounts[s.phase] ?? 0) + 1;

  const popIssues: string[] = [];
  if (bets.length !== EXPECTED_BETS)   popIssues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (seeds.length !== EXPECTED_SEEDS) popIssues.push(`seed records ${seeds.length} != ${EXPECTED_SEEDS}`);
  for (const [p, n] of Object.entries(EXPECTED_PHASE_BETS)) {
    const got = betPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} bets ${got} != ${n}`);
  }
  for (const [p, n] of Object.entries(EXPECTED_PHASE_SEEDS)) {
    const got = seedPhaseCounts[p] ?? 0;
    if (got !== n) popIssues.push(`phase ${p} seeds ${got} != ${n}`);
  }
  for (const p of Object.keys(betPhaseCounts)) {
    if (!(p in EXPECTED_PHASE_BETS)) popIssues.push(`unexpected bet phase '${p}'`);
  }
  // The secondary dataset (Phase E) is counted THE SAME WAY: its bets, its seed records, and both
  // per sub-phase, from src/loader.ts — EXPECTED_PHASE_E_SEEDS was declared and read by nothing.
  const eBetCounts: Record<string, number> = {};
  for (const b of ctx.phaseEBets) eBetCounts[b.phase] = (eBetCounts[b.phase] ?? 0) + 1;
  const eSeedCounts: Record<string, number> = {};
  for (const sd of ctx.phaseESeeds) eSeedCounts[sd.phase] = (eSeedCounts[sd.phase] ?? 0) + 1;
  if (ctx.phaseEBets.length !== EXPECTED_PHASE_E_BETS) popIssues.push(`Phase E bets ${ctx.phaseEBets.length} != ${EXPECTED_PHASE_E_BETS}`);
  if (ctx.phaseESeeds.length !== EXPECTED_PHASE_E_SEEDS) popIssues.push(`Phase E seed records ${ctx.phaseESeeds.length} != ${EXPECTED_PHASE_E_SEEDS}`);
  for (const [p, n] of Object.entries(EXPECTED_PHASE_E_BETS_BY_PHASE)) {
    if ((eBetCounts[p] ?? 0) !== n) popIssues.push(`phase ${p} bets ${eBetCounts[p] ?? 0} != ${n}`);
  }
  for (const [p, n] of Object.entries(EXPECTED_PHASE_E_SEEDS_BY_PHASE)) {
    if ((eSeedCounts[p] ?? 0) !== n) popIssues.push(`phase ${p} seeds ${eSeedCounts[p] ?? 0} != ${n}`);
  }
  for (const p of [...Object.keys(eBetCounts), ...Object.keys(eSeedCounts)]) {
    if (!(p in EXPECTED_PHASE_E_BETS_BY_PHASE)) popIssues.push(`unexpected Phase E label '${p}'`);
  }

  const s13 = step(13, 'Population & Phase Labels',
    hasAll && lastPhase === 'D' && popIssues.length === 0 ? 'PASS' : 'FAIL',
    popIssues.length > 0
      ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${popIssues.join('; ')}`
      : `All ${EXPECTED_BETS} primary bets and ${EXPECTED_SEEDS} seed records, and all ${EXPECTED_PHASE_E_BETS} Phase E `
        + `bets and ${EXPECTED_PHASE_E_SEEDS} seed records, carry valid phase labels, and every total and per-phase count `
        + `matches the capture plan in src/loader.ts — code constants, not the datasets' own headers.`,
    { betPhases: betPhaseCounts, seedPhases: seedPhaseCounts, bets: bets.length, seeds: seeds.length,
      phaseEBetPhases: eBetCounts, phaseESeedPhases: eSeedCounts,
      phaseEBets: ctx.phaseEBets.length, phaseESeeds: ctx.phaseESeeds.length },
  );

  // ── Step 14: Dataset hash ─────────────────────────────────────────────────────
  // Both datasets of record, re-asserted as a scored step. The pre-flight in tests/verify.ts
  // aborts before any step on a mismatch; this step's own branch is FAIL, not the FLAG it was.
  const h  = checkDatasetHash();
  const he = checkPhaseEHash();
  const s14 = step(14, 'Dataset Hash',
    h.match && he.match ? 'PASS' : 'FAIL',
    `Master expected: ${h.expected || '(not set)'} | actual: ${h.actual}; Phase E expected: ${he.expected} | actual: ${he.present ? he.actual : '(absent)'}`,
  );

  // ── Step 15: Epoch Size ────────────────────────────────────────────────────────
  // `maxSize <= 50` failed only on an OVERSIZED epoch — an epoch holding MORE bets than the
  // capture's rotation interval (BETS_PER_EPOCH = 50 in the capture scripts; not a Duel limit).
  // That is the one direction a shrinking attack never goes. Every epoch could
  // be cut from 50 bets to 5, or half of them deleted outright, and the condition still held.
  //
  // The size is pinned to EPOCH_SIZE in src/loader.ts, the epoch COUNT is pinned alongside it
  // — an intact size with epochs missing is the other half of the same shrink — and the pair
  // is reconciled against the declared bet total.
  const epochSizes = new Map<string, number>();
  for (const b of bets) {
    epochSizes.set(b.seed.serverSeedHashed, (epochSizes.get(b.seed.serverSeedHashed) ?? 0) + 1);
  }
  const sizes   = [...epochSizes.values()];
  const minSize = Math.min(...sizes);
  const maxSize = Math.max(...sizes);
  const offenders = [...epochSizes.entries()]
    .filter(([, n]) => n !== EPOCH_SIZE)
    .map(([h, n]) => `${h.substring(0, 16)}: ${n}`);

  const epochIssues: string[] = [];
  // The Phase E epochs — keyed by its own capture timeline — against the per-record plan. Two are
  // not 50 by design (seeds[9]: 49 around the declared capture-retry gap; seeds[10]: 1), and the
  // plan says so record by record, so the same shrink test runs over the secondary dataset.
  let phaseEOff = 0;
  for (const e of ctx.phaseEEpochs) {
    const planned = EXPECTED_PHASE_E_EPOCH_SIZES[e.index] ?? 0;
    if (e.bets.length !== planned) {
      phaseEOff++;
      epochIssues.push(`Phase E seeds[${e.index}]: ${e.bets.length} bets != ${planned}`);
    }
  }
  const phaseEPlanTotal = Object.values(EXPECTED_PHASE_E_EPOCH_SIZES).reduce((a, n) => a + n, 0);
  if (phaseEPlanTotal !== EXPECTED_PHASE_E_BETS) {
    epochIssues.push(`Phase E plan inconsistent: epoch sizes sum to ${phaseEPlanTotal} != ${EXPECTED_PHASE_E_BETS}`);
  }
  if (ctx.phaseEEpochs.length !== EXPECTED_PHASE_E_SEEDS) {
    epochIssues.push(`Phase E rotation records ${ctx.phaseEEpochs.length} != ${EXPECTED_PHASE_E_SEEDS}`);
  }
  if (epochSizes.size !== EXPECTED_EPOCHS) {
    epochIssues.push(`${epochSizes.size} epochs != ${EXPECTED_EPOCHS}`);
  }
  if (offenders.length > 0) {
    epochIssues.push(`${offenders.length} epoch(s) != ${EPOCH_SIZE} bets (${offenders.slice(0, 5).join('; ')})`);
  }
  if (EXPECTED_EPOCHS * EPOCH_SIZE !== EXPECTED_BETS) {
    epochIssues.push(`capture plan inconsistent: ${EXPECTED_EPOCHS} x ${EPOCH_SIZE} != ${EXPECTED_BETS}`);
  }

  const s15 = step(15, 'Epoch Size',
    epochIssues.length === 0 ? 'PASS' : 'FAIL',
    epochIssues.length > 0
      ? `EPOCH POPULATION MISMATCH vs the capture plan in src/loader.ts: ${epochIssues.join('; ')}`
      : `Exactly ${EXPECTED_EPOCHS} primary epochs of exactly ${EPOCH_SIZE} bets each, as pinned in src/loader.ts, `
        + `reconciling to the declared ${EXPECTED_BETS} bets; every one of the ${EXPECTED_PHASE_E_SEEDS} Phase E rotation `
        + `records holds exactly the bets its per-record plan declares, reconciling to ${EXPECTED_PHASE_E_BETS}.`,
    { epochs: epochSizes.size, expectedEpochs: EXPECTED_EPOCHS, minSize, maxSize, expectedSize: EPOCH_SIZE, offEpochs: offenders.length,
      phaseERecords: ctx.phaseEEpochs.length, phaseEOffPlan: phaseEOff },
  );

  // ── Step 16: Anti-circularity — theoretical RTP ───────────────────────────────
  // For EVERY (mineCount m, reveals k) pair with m ∈ [1,24], k ∈ [1, 25−m]:
  //   reachProb(m, k)  = C(25−m, k) / C(25, k)     // probability of clearing k safe tiles
  //   payoutMult(m, k) = C(25, k) / C(25−m, k) × (1 − edge)
  //   RTP              = reachProb × payoutMult = 1 − edge by algebraic cancellation
  // 300 cells, the binomials computed inline, not through src/rng.ts. `edge` is the house_edge of the
  // stake tier the cell's RTP-table row is priced at (src/rtp-settings.ts: the first tier of the
  // cell's list in Duel's settings, E14): 0.001 on 294 cells, 0.0014–0.0021 on the six full-board
  // cash-outs (10–15 mines), which E14 gives no 0.1 % tier (since 19 Oct 2026, Mike's QA: each cell
  // against its own band, as Keno does).
  //
  // THAT IDENTITY ALONE IS A TAUTOLOGY: reach and multiplier share one comb(), so a wrong comb()
  // cancels out of their product and the step passes. Three things make it decide something now:
  //   (1) THE COUNTING ANCHOR. src/exact.ts enumerateSurvivalCounts visits all 2^25 subsets of the
  //       grid and COUNTS the k-subsets that avoid m given tiles — no binomial formula anywhere in
  //       the path. Every cell's survival count must equal the integer C(25−m, k), every total
  //       C(25, k), and the operator's formula times the COUNTED survival probability must equal
  //       that cell's exact row in the RTP table (src/rtp-settings.ts; 1 − the row's edge at every
  //       honest cell) EXACTLY, in rational arithmetic. Since 14 Oct 2026 (C3) the row, not the claimed 999/1000:
  //       a cell that pays less is an RTP miss, which RTP-CLAIM scores on this step as RTP FIGURE
  //       OVERSTATED (exit 5), never a FAIL here.
  //   (2) THE GAME'S OWN FUNCTIONS against the anchor: src/rng.ts theoreticalMultiplier and the
  //       product of winChance must agree with the counted values at MULT_REL_TOL — so a wrong
  //       comb() or winChance in the adapter FAILs here instead of cancelling.
  //   (3) NEGATIVE CONTROLS, run every time: the same exact identity evaluated with a CORRUPTED
  //       closed form (C(26−m, k) in place of C(25−m, k), at the row's edge) must be rejected on at
  //       least one cell, and
  //       the layout comparator every recomputation step uses must reject a corrupted layout (one
  //       mine moved to a safe tile). A control that is NOT rejected FAILs the step — it would mean
  //       the check cannot say no.
  // No operator-supplied win-chance or odds field is read anywhere in this step.
  const comb = (n: number, r: number): number => {
    let out = 1;
    for (let i = 0; i < r; i++) out = out * (n - i) / (i + 1);
    return out;
  };
  let maxDeviation = 0;
  let worstM = 0, worstK = 0;
  let cellsChecked = 0;
  const s16Issues: string[] = [];
  const { survive, total } = enumerateSurvivalCounts();
  // The RTP table's exact row per cell and the edge of the tier it is priced at (src/rtp-settings.ts,
  // the table RTP-CLAIM scores on this step).
  const tableRtp = new Map(computeRtpClaim().rows.map(r => {
    const [n, d] = r.rtpExact.split('/');
    return [r.setting, { num: BigInt(n as string), den: BigInt((d ?? '1') as string), edge: edgeOfTier(r.tier as string) }] as const;
  }));
  let anchorCells = 0, anchorErrors = 0, adapterErrors = 0, exactRtpErrors = 0, corruptedRejectedCells = 0;
  let cellsAboveBaseTier = 0;
  let worstAdapterDev = 0;
  for (let m = 1; m <= 24; m++) {
    for (let k = 1; k <= 25 - m; k++) {
      const row = tableRtp.get(`mines=${m} k=${k}`);
      const edge = row ? row.edge : '0.001';                   // no row: counted as an exactRtpError below
      if (edge !== '0.001') cellsAboveBaseTier++;
      const retain = 1 - Number(edge);
      const reach = comb(25 - m, k) / comb(25, k);             // C(25−m,k)/C(25,k)
      const mult  = comb(25, k) / comb(25 - m, k) * retain;    // C(25,k)/C(25−m,k) × (1 − edge)
      const rtp   = reach * mult;
      const dev   = Math.abs(rtp - retain);
      if (dev > maxDeviation) { maxDeviation = dev; worstM = m; worstK = k; }
      cellsChecked++;

      // (1) counting anchor — integers, exact.
      anchorCells++;
      const N = survive[m][k], T = total[k];
      if (BigInt(N) !== binomialBig(25 - m, k) || BigInt(T) !== binomialBig(25, k)) anchorErrors++;
      const opMult = exactMultiplierAtEdge(m, k, edge);         // C(25,k)·(1 − edge) / C(25−m,k)
      const rtpExact = { num: opMult.num * BigInt(N), den: opMult.den * BigInt(T) };
      if (!row || compareRational(rtpExact, row) !== 0) exactRtpErrors++;
      // (3a) the corrupted closed form must NOT satisfy the same identity.
      const e = parseDecimal(edge), E = 10n ** BigInt(e.scale);
      const bad = { num: binomialBig(25, k) * (E - e.int), den: binomialBig(26 - m, k) * E };
      if (row && compareRational({ num: bad.num * BigInt(N), den: bad.den * BigInt(T) }, row) !== 0) {
        corruptedRejectedCells++;
      }
      // (2) the adapter's functions against the counted values.
      const countedMult = (T / N) * 0.999;
      let survProduct = 1;
      for (let i = 0; i < k; i++) survProduct *= winChance(m, i);
      const d1 = Math.abs(theoreticalMultiplier(m, k, 0.001) - countedMult) / countedMult;
      const d2 = Math.abs(survProduct - N / T) / (N / T);
      worstAdapterDev = Math.max(worstAdapterDev, d1, d2);
      if (!(d1 <= MULT_REL_TOL) || !(d2 <= MULT_REL_TOL)) adapterErrors++;
    }
  }
  // (3b) layout negative control: move one mine of a real recomputed layout onto a safe tile.
  let layoutControlRejected = false;
  const probe = bets.find(b => ctx.seedMap.has(b.seed.serverSeedHashed));
  if (probe) {
    const ss = ctx.seedMap.get(probe.seed.serverSeedHashed)!;
    const computed = computeMinePositions(ss, probe.seed.clientSeed, probe.seed.nonce, probe.request.mines_count);
    const safe = [...Array(25).keys()].find(t => !computed.includes(t))!;
    const corrupted = [...computed.slice(1), safe];
    layoutControlRejected = !sameLayout(computed, corrupted) && sameLayout(computed, probe.response.mines_positions);
  }
  const RTP_DEVIATION_BOUND = 0.0001;
  const EXPECTED_CELLS = 300;
  if (cellsChecked !== EXPECTED_CELLS) s16Issues.push(`${cellsChecked} cells != ${EXPECTED_CELLS}`);
  if (!(maxDeviation < RTP_DEVIATION_BOUND)) s16Issues.push(`float identity deviates by ${maxDeviation} at m=${worstM}, k=${worstK}`);
  if (anchorErrors > 0) s16Issues.push(`${anchorErrors} cell(s) where the COUNTED survivals disagree with the integer binomial`);
  if (exactRtpErrors > 0) s16Issues.push(`${exactRtpErrors} cell(s) where formula × counted survival != the RTP table's exact row`);
  if (adapterErrors > 0) s16Issues.push(`${adapterErrors} cell(s) where src/rng.ts disagrees with the counted anchor beyond ${MULT_REL_TOL}`);
  if (corruptedRejectedCells === 0) s16Issues.push('NEGATIVE CONTROL NOT REJECTED: a corrupted closed form C(26−m,k) satisfies the identity on every cell');
  if (!layoutControlRejected) s16Issues.push('NEGATIVE CONTROL NOT REJECTED: the layout comparator accepted a corrupted layout (or no probe bet)');
  const s16 = step(16, 'Probability Independence (Anti-Circularity)',
    s16Issues.length === 0 ? 'PASS' : 'FAIL',
    s16Issues.length > 0
      ? `ANTI-CIRCULARITY FAILED: ${s16Issues.join('; ')}`
      : `${cellsChecked} (mines, reveals) cells tested (mines 1–24, k 1–(25−m)). Counting anchor: all 2^25 tile subsets `
        + `enumerated; on every cell the counted survivals equal the integer C(25−m,k) and the total C(25,k), and the `
        + `operator formula × counted survival probability equals the RTP table's exact row (each row is held to the claim `
        + `by RTP-CLAIM on this step, not here). src/rng.ts multiplier and `
        + `win-chance product agree with the counted values within ${MULT_REL_TOL} relative. Negative controls rejected: `
        + `the corrupted closed form C(26−m,k) fails the exact identity, and a layout with one mine moved is refused by `
        + `the layout comparator. The float identity lies within ${RTP_DEVIATION_BOUND} of 1 − the row's edge on every `
        + `cell (0.999 on ${cellsChecked - cellsAboveBaseTier}; on the ${cellsAboveBaseTier} full-board cash-outs whose first `
        + `stake tier in Duel's settings, E14, is above 0.1 %, that tier's edge).`,
    { cells: cellsChecked, expectedCells: EXPECTED_CELLS, mineCounts: 24, deviationBound: RTP_DEVIATION_BOUND,
      maxDeviation, worstMineCount: worstM, worstK, targetRTP: 0.999, cellsAboveBaseTier,
      countingAnchor: { cells: anchorCells, subsetsEnumerated: 2 ** 25, anchorErrors, exactRtpErrors, adapterErrors,
        worstAdapterRelativeDeviation: worstAdapterDev, adapterRelTol: MULT_REL_TOL },
      negativeControls: { corruptedFormulaRejectedOnCells: corruptedRejectedCells, layoutCorruptionRejected: layoutControlRejected } },
  );

  // ── Step 17: Phase D — client seed variation ──────────────────────────────────
  // Every Phase D bet recomputes under the client seed ACTUALLY used (a mismatch or an
  // unrecomputable bet FAILs — the check is HARD_FAIL in the profile), with at least 2 distinct
  // player-set seeds (the profile floor).
  //
  // PREDICTABLE SEEDS, DISCLOSED FROM THE DATA (profile MINES-06). The Phase D client seeds were
  // generated as 'pfaudit' + Date.now().toString(36) — the capture's wall clock. That makes them
  // predictable, so the epochs they seeded are the exposed ones. This step decodes every Phase D
  // seed back to its millisecond timestamp, requires it to fall inside the minute before its own
  // rotation record (proving the derivation, not asserting it), and requires the set of exposed
  // epochs to equal PHASE_D_PREDICTABLE_EPOCHS in src/loader.ts — so the disclosure in MANIFEST.md
  // (DL-3) cannot drift from the data. It also measures how long each epoch's server-seed hash had
  // been committed (published as the previous record's nextServerSeedHash) before the client seed
  // existed: the ordering the commit-reveal scheme relies on.
  const dClientSeeds = new Set(phaseD.map(b => b.seed.clientSeed));
  const dMineCounts  = new Set(phaseD.map(b => b.request.mines_count));
  let dMatched = 0;
  let dTested  = 0;
  for (const b of phaseD) {
    const ss = ctx.seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    dTested++;
    const computed = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
    if (sameLayout(computed, b.response.mines_positions)) dMatched++;
  }
  const exposed: Array<{ seedIndex: number; clientSeed: string; decodedAt: string; rotationAt: string;
    lagSeconds: number; commitmentLeadSeconds: number }> = [];
  const dIssues: string[] = [];
  for (const cs of [...dClientSeeds].sort()) {
    const idx = seeds.findIndex(sd => sd.seed.clientSeed === cs);
    if (!cs.startsWith(PHASE_D_SEED_PREFIX) || idx < 1) { dIssues.push(`Phase D seed ${cs} is not of the declared form or has no rotation record`); continue; }
    const ms = parseInt(cs.slice(PHASE_D_SEED_PREFIX.length), 36);
    const rotAt = Date.parse(seeds[idx].at);
    const lag = (rotAt - ms) / 1000;
    if (!(lag >= 0 && lag <= 60)) dIssues.push(`Phase D seed ${cs} decodes to ${new Date(ms).toISOString()}, not within the minute before its rotation`);
    const lead = (ms - Date.parse(seeds[idx - 1].at)) / 1000;
    if (seeds[idx - 1].seed.nextServerSeedHash !== seeds[idx].seed.serverSeedHashed) dIssues.push(`seeds[${idx}].serverSeedHashed is not seeds[${idx - 1}].nextServerSeedHash`);
    exposed.push({ seedIndex: idx, clientSeed: cs, decodedAt: new Date(ms).toISOString(), rotationAt: seeds[idx].at,
      lagSeconds: lag, commitmentLeadSeconds: lead });
  }
  const exposedIdx = exposed.map(x => x.seedIndex).sort((a, b) => a - b);
  if (JSON.stringify(exposedIdx) !== JSON.stringify([...PHASE_D_PREDICTABLE_EPOCHS])) {
    dIssues.push(`exposed epochs ${exposedIdx.join(',')} != the disclosed ${PHASE_D_PREDICTABLE_EPOCHS.join(',')}`);
  }
  if (dTested !== phaseD.length) dIssues.push(`${phaseD.length - dTested} Phase D bet(s) not recomputable`);
  if (dMatched !== dTested) dIssues.push(`${dTested - dMatched} Phase D layout(s) disagree with the recomputation`);
  if (dClientSeeds.size < 2) dIssues.push(`${dClientSeeds.size} distinct Phase D client seed(s) < the profile floor of 2`);
  const minLead = exposed.length ? Math.min(...exposed.map(x => x.commitmentLeadSeconds)) : NaN;
  const s17 = step(17, 'Phase D — Client Seed Variation',
    dIssues.length === 0 ? 'PASS' : 'FAIL',
    `${phaseD.length} bets, ${dClientSeeds.size} distinct client seeds, mine counts: ${[...dMineCounts].sort((a, b) => a - b).join(', ')}; `
    + `recomputation: ${dMatched}/${dTested} match. PREDICTABLE-SEED DISCLOSURE: all ${exposed.length} Phase D seeds decode to the `
    + `capture's millisecond clock ('${PHASE_D_SEED_PREFIX}' + Date.now() in base 36), each within the minute before its rotation; `
    + `exposed epochs = rotation records ${PHASE_D_PREDICTABLE_EPOCHS[0]}–${PHASE_D_PREDICTABLE_EPOCHS[PHASE_D_PREDICTABLE_EPOCHS.length - 1]} `
    + `(${PHASE_D_PREDICTABLE_EPOCHS.length} epochs, ${phaseD.length} bets), as disclosed in MANIFEST.md DL-3. By the capture's timestamps, `
    + `each epoch's server-seed hash had been recorded as the previous rotation's nextServerSeedHash before its client seed existed.`
    + `${dIssues.length ? ` — ${dIssues.join('; ')}` : ''}`,
    { phaseDBets: phaseD.length, recomputed: dTested, matched: dMatched, distinctClientSeeds: dClientSeeds.size,
      exposedEpochs: exposed, minCommitmentLeadSeconds: minLead },
  );

  return [s13, s14, s15, s16, s17];
}
