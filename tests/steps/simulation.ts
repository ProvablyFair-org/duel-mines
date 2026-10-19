/**
 * Steps 18–19: Simulation Results
 */

import * as fs   from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import type { MinesGame } from '../../src/types';
import { step, VerifyContext } from './context';
import { chiSquaredTest, chiSquaredPValue } from '../../src/stats';
import { winChance, theoreticalMultiplier, computeMinePositionsFromBuffer, GRID_SIZE } from '../../src/rng';
import { EXPECTED_REVEALED_EPOCHS } from '../../src/loader';
import {
  positionChi2WithoutReplacement, positionChi2Pearson, lag1FromCensus, runsFromCensus, legacyMedianRunsFromCensus,
  PASS1_CHECKPOINT_ROUNDS, windowReturnZ, decodeWinBits, binomialUpperTail,
  binomialTailAtLeast, countRuleThreshold, windowRejectProbability,
} from '../../src/sim-census';
import {
  SIM_SEEDS, SIM_CONFIGS, SIM_ROUNDS_PER_CONFIG, SIM_NONCES_PER_SEED, SIM_EPOCH_LENGTH, SIM_PASS2_MINE_COUNT,
} from '../../src/sim-plan';

/**
 * RE-DERIVATION TOLERANCE — for comparing a statistic the artifact carries with the same statistic
 * re-derived here from its census. Integer census fields are compared exactly. A re-derived
 * statistic can differ from the artifact's only by floating-point summation order (the simulator
 * sums a 1,000,000-term series; the census form is closed), so the bound is the reproduction
 * rule's 1e-14 absolute + a relative 1e-9 — measured worst gap printed in `data` every run.
 */
const REDERIVE_ATOL = 1e-14;
const REDERIVE_RTOL = 1e-9;
/** Lag-1 serial bound, |r1·√n| above this is a flag (≈ the two-sided Bonferroni z for 0.01/24). */
const SERIAL_Z_BOUND = 3.5;
/** Test C: flag a seed whose served-window return sits in the lowest 5% of its own null. */
const TEST_C_ALPHA = 0.05;

/** A seed is "broad" when its early AND its late window are both off at p below this. */
const BROAD_WINDOW_ALPHA = 0.05;
/** Per-seed chance of "broad" on a fair game, at the nominal per-window level: 0.05 × 0.05. */
const BROAD_PER_SEED_NULL = 0.0025;
/** A seed off in both windows at p below this is a FAIL on its own (kept: its false-alarm rate meets the 1% cap). */
const BROAD_SEVERE_P = 0.001;
/** Per-seed chance of the severe pattern on a fair game, at the nominal per-window level: 0.001 × 0.001. */
const BROAD_SEVERE_PER_SEED_NULL = 1e-6;
/** Per-seed chance of a Test B cherry-pick flag on a fair game (early off, late not): 0.05 × 0.95. */
const TEST_B_PER_SEED_NULL = 0.0475;
/**
 * THE FALSE-ALARM STANDARD (2026-10-06): a statistical rule may move the verdict only
 * if its false-alarm rate on a fair game is written down, and is at most 5% for a FLAG and 1% for a
 * FAIL. Every verdict-moving rule of this step prints its rate against these caps.
 */
const FLAG_FALSE_ALARM_CAP = 0.05;
const FAIL_FALSE_ALARM_CAP = 0.01;

/** Test A's per-seed significance level: a seed "fails" when its full-range chi-squared p < this. */
const TEST_A_ALPHA = 0.01;

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir } = ctx;
  const simPath = path.join(outputsDir, 'simulation-results.json');

  if (!fs.existsSync(simPath)) {
    // The artifact of record is pinned (step 24); its absence is a failure, not a missing extra.
    const s18 = step(18, 'Simulation Results — Pass 1 Integrity', 'FAIL',
      'outputs/simulation-results.json not found — the pinned artifact of record is absent',
    );
    const s19 = step(19, 'Simulation Results — Pass 2 Cherry-Pick Test', 'FAIL',
      'outputs/simulation-results.json not found',
    );
    return [s18, s19];
  }

  const sim = JSON.parse(fs.readFileSync(simPath, 'utf-8'));

  // ── Step 18: Pass 1 ────────────────────────────────────────────────────────
  // STATISTICS RE-DERIVED, NOT READ (profile MINES-20). The rows used to carry positionPValue, r1Z
  // and runsPValue and this step only counted how many fell below alpha — a forged p-value was
  // trusted. Every scored statistic is now DERIVED HERE from the integer census the simulator
  // writes beside it (src/simulate.ts Pass1Census), by the functions in src/sim-census.ts:
  //   - mine-position uniformity from the 25 tile counts, WITH the without-replacement correction
  //     (a round's m mines are distinct; Pearson alone is under-dispersed by 24/(25−m));
  //   - lag-1 autocorrelation and the runs test from the win/loss census — the runs test on the
  //     win/loss dichotomy, because the legacy median split is vacuous (z = 0, p = 1) for every
  //     m ≥ 13, where losses are the majority;
  //   - the simulated RTP from the win count.
  // The artifact's own figures are CROSS-CHECKED against the re-derivation (a disagreement beyond
  // REDERIVE_RTOL FAILs) and are never the source of the verdict. The plan — 24 configs x
  // 1,000,000 rounds — comes from src/sim-plan.ts, never from the artifact. And the experiment is
  // REPLAYED: the first PASS1_CHECKPOINT_ROUNDS rounds of every config are re-run from the pinned
  // seeds on every verify and must reproduce the checkpoint census exactly; the whole 24,000,000
  // is `npm run replay`.
  const pass1 = sim.pass1_fresh_seeds ?? {};
  const rows1: any[] = Array.isArray(pass1.results) ? pass1.results : [];
  const configs = SIM_CONFIGS.length;
  const bonAlpha = 0.01 / configs;
  const s18Issues: string[] = [];
  if (pass1.configs !== configs || rows1.length !== configs) s18Issues.push(`artifact carries ${rows1.length} rows / configs ${pass1.configs}, plan ${configs}`);
  if (pass1.roundsPerConfig !== SIM_ROUNDS_PER_CONFIG) s18Issues.push(`roundsPerConfig ${pass1.roundsPerConfig} != plan ${SIM_ROUNDS_PER_CONFIG}`);
  if (pass1.totalRounds !== configs * SIM_ROUNDS_PER_CONFIG) s18Issues.push(`totalRounds ${pass1.totalRounds} != ${configs * SIM_ROUNDS_PER_CONFIG}`);
  let chi2Fails = 0, chi2FailsPearson = 0, serialFails = 0, legacyVacuous = 0, crossCheckFails = 0, replayMismatches = 0;
  let worstCross = 0, worstCrossAt = '';
  let rtpSum = 0;
  const cross = (label: string, stored: unknown, derived: number) => {
    const a = typeof stored === 'number' ? stored : NaN;
    const gap = Math.abs(a - derived);
    const rel = gap / Math.max(Math.abs(a), Math.abs(derived), 1e-300);
    const ok = Number.isFinite(a) && (gap <= REDERIVE_ATOL || rel <= REDERIVE_RTOL);
    const scaled = Number.isFinite(rel) ? Math.min(rel, gap) : Infinity;
    if (scaled > worstCross) { worstCross = scaled; worstCrossAt = label; }
    if (!ok) { crossCheckFails++; s18Issues.push(`${label}: artifact ${String(stored)} vs re-derived ${derived}`); }
  };
  const perConfig: Array<Record<string, number>> = [];
  rows1.forEach((r: any, i: number) => {
    const m = SIM_CONFIGS[i];
    const c = r?.census;
    if (r?.mineCount !== m || !c) { s18Issues.push(`row ${i}: mineCount ${r?.mineCount} / census ${c ? 'present' : 'ABSENT'} (plan m=${m})`); return; }
    const counts: number[] = c.positionCounts;
    const intOk = (x: unknown, max: number) => Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max;
    if (c.rounds !== SIM_ROUNDS_PER_CONFIG || !Array.isArray(counts) || counts.length !== GRID_SIZE
      || !counts.every(x => intOk(x, SIM_ROUNDS_PER_CONFIG)) || counts.reduce((a, b) => a + b, 0) !== SIM_ROUNDS_PER_CONFIG * m
      || !intOk(c.wins, SIM_ROUNDS_PER_CONFIG) || !intOk(c.adjacentWinPairs, SIM_ROUNDS_PER_CONFIG) || !intOk(c.transitions, SIM_ROUNDS_PER_CONFIG)
      || !(c.firstOutcome === 0 || c.firstOutcome === 1) || !(c.lastOutcome === 0 || c.lastOutcome === 1)) {
      s18Issues.push(`m=${m}: census malformed (counts must be ${GRID_SIZE} integers summing to rounds x m = ${SIM_ROUNDS_PER_CONFIG * m})`);
      return;
    }
    const wr   = positionChi2WithoutReplacement(counts, m, c.rounds);
    const pear = positionChi2Pearson(counts, m, c.rounds);
    const lag  = lag1FromCensus(c);
    const runs = runsFromCensus(c);
    const legacy = legacyMedianRunsFromCensus(c);
    const rtp  = c.wins * theoreticalMultiplier(m, 1, 0.001) / c.rounds;
    rtpSum += rtp;
    if (legacy.vacuous) legacyVacuous++;
    // cross-checks: the artifact must agree with what its own census implies
    cross(`m=${m} positionChi2 (Pearson)`, r.positionChi2, pear);
    cross(`m=${m} positionChi2WR`, r.positionChi2WR, wr.positionChi2WR);
    cross(`m=${m} positionPValueWR`, r.positionPValueWR, wr.positionPValueWR);
    cross(`m=${m} r1`, r.r1, lag.r1);
    cross(`m=${m} r1Z`, r.r1Z, lag.r1Z);
    cross(`m=${m} runsZ (legacy median split)`, r.runsZ, legacy.z);
    cross(`m=${m} runsPValue (legacy median split)`, r.runsPValue, legacy.pValue);
    cross(`m=${m} runsZWinLoss`, r.runsZWinLoss, runs.z);
    cross(`m=${m} simulatedRTP`, r.simulatedRTP, rtp);
    if (r.winRate !== c.wins / c.rounds) cross(`m=${m} winRate`, r.winRate, c.wins / c.rounds);
    // scoring: on the RE-DERIVED statistics only
    if (wr.positionPValueWR < bonAlpha) chi2Fails++;
    if (chiSquaredPValue(pear, 24) < bonAlpha) chi2FailsPearson++;
    if (Math.abs(lag.r1Z) > SERIAL_Z_BOUND || runs.pValue < bonAlpha) serialFails++;
    perConfig.push({ mineCount: m, positionChi2WR: wr.positionChi2WR, positionPValueWR: wr.positionPValueWR,
      r1Z: lag.r1Z, runsZWinLoss: runs.z, runsPValueWinLoss: runs.pValue, simulatedRTP: rtp });
    // checkpoint replay from the pinned seed pair
    const cp = c.checkpoint;
    const key = Buffer.from(SIM_SEEDS[i].server, 'hex');
    const freq = new Array(GRID_SIZE).fill(0);
    let wins = 0;
    for (let nonce = 0; nonce < PASS1_CHECKPOINT_ROUNDS; nonce++) {
      const mines = computeMinePositionsFromBuffer(key, SIM_SEEDS[i].client, nonce, m);
      for (const t of mines) freq[t]++;
      if (!mines.includes(nonce % GRID_SIZE)) wins++;
    }
    if (!cp || cp.rounds !== PASS1_CHECKPOINT_ROUNDS || cp.wins !== wins
      || !Array.isArray(cp.positionCounts) || cp.positionCounts.length !== GRID_SIZE || cp.positionCounts.some((x: number, t: number) => x !== freq[t])) {
      replayMismatches++;
      s18Issues.push(`m=${m}: replay of the first ${PASS1_CHECKPOINT_ROUNDS} rounds from the pinned seed does not reproduce the checkpoint census`);
    }
  });
  const meanRTP = rtpSum / configs;
  if (rows1.length === configs) cross('avgSimulatedRTP', pass1.avgSimulatedRTP, meanRTP);
  const pass1Ok = chi2Fails === 0 && serialFails === 0 && s18Issues.length === 0;
  // The sentence carries the BOUNDS (α and the Bonferroni divisor) and the counts, which are
  // integers and compare exactly. The measured figures go in `data`, where the reproduction gate
  // compares them under tolerance.
  const s18 = step(18, 'Simulation Results — Pass 1 Integrity',
    pass1Ok ? 'PASS' : 'FAIL',
    `${(configs * SIM_ROUNDS_PER_CONFIG).toLocaleString()} rounds × ${configs} configs (plan from src/sim-plan.ts), every statistic `
    + `re-derived from the artifact's integer census: mine-position uniformity with the without-replacement correction `
    + `${chi2Fails}/${configs} below the Bonferroni-corrected α/${configs}; serial independence (lag-1 |z| > ${SERIAL_Z_BOUND} or `
    + `win/loss runs p < α/${configs}) ${serialFails}/${configs}; the artifact's own figures agree with the re-derivation `
    + `(${crossCheckFails} disagreements); the first ${PASS1_CHECKPOINT_ROUNDS.toLocaleString()} rounds of all ${configs} configs `
    + `replayed from the pinned seeds reproduce the checkpoint census (${replayMismatches} mismatches). The legacy median-split `
    + `runs statistic the artifact also carries is vacuous (z = 0, p = 1) on ${legacyVacuous}/${configs} configs and is not scored`
    + `${s18Issues.length ? ` — ${s18Issues.slice(0, 4).join('; ')}` : ''}`,
    {
      totalRounds: configs * SIM_ROUNDS_PER_CONFIG,
      configs,
      avgSimulatedRTP: meanRTP,
      theoreticalRTP: 0.999,
      alpha: 0.01,
      bonferroniAlpha: bonAlpha,
      chi2FailsWithoutReplacement: chi2Fails,
      chi2FailsPearsonUncorrected: chi2FailsPearson,
      serialFailsBonferroni: serialFails,
      legacyRunsVacuousConfigs: legacyVacuous,
      crossCheckDisagreements: crossCheckFails,
      worstCrossCheckGap: worstCross, worstCrossCheckAt: worstCrossAt,
      rederiveTolerance: { atol: REDERIVE_ATOL, rtol: REDERIVE_RTOL },
      checkpointReplay: { roundsPerConfig: PASS1_CHECKPOINT_ROUNDS, configs, mismatches: replayMismatches },
      perConfig,
    },
  );

  // ── Step 19: Pass 2 ────────────────────────────────────────────────────────
  const pass2      = sim.pass2_casino_seeds;
  const N          = pass2.seeds_tested;
  const flags      = pass2.test_b_cherry_pick_flags;
  const testA      = pass2.test_a_chi2_fails_at_alpha01;
  const expCP      = Math.ceil(N * 0.05);
  const threshold  = expCP * 2;
  const rows: any[] = Array.isArray(pass2.results) ? pass2.results : [];

  // TEST A WAS PRINTED, NEVER SCORED. The per-seed full-range chi-squared count sat in the detail
  // beside an "expected ≤" figure and no branch read it, so every seed failing Test A still
  // PASSed. It is now RECOMPUTED from the per-seed rows the artifact ships (earlyWins + lateWins
  // over earlyTotal + lateTotal, against the win chance src/rng.ts winChance derives for the
  // artifact's mine count — not the artifact's own theoretical_win_chance, which is only
  // cross-checked), and scored against the framework's 5σ + 1 bound on a Binomial(N, α) count:
  //   bound = N·α + 5·√(N·α·(1−α)) + 1, FAIL above it.
  // The row count is bound to the revealed-epoch population, and the simulator's own scalar
  // and per-row booleans are cross-checked — a disagreement is a FAIL, never a silent preference.
  const testAIssues: string[] = [];
  const mineCount = pass2.mine_count;
  const pWin = typeof mineCount === 'number' ? winChance(mineCount, 0) : NaN;
  if (!Number.isFinite(pWin)) testAIssues.push(`pass2.mine_count ${JSON.stringify(mineCount)} is not a number`);
  if (pass2.theoretical_win_chance !== pWin) {
    testAIssues.push(`artifact theoretical_win_chance ${pass2.theoretical_win_chance} != winChance(${mineCount}, 0) = ${pWin}`);
  }
  if (rows.length !== EXPECTED_REVEALED_EPOCHS || N !== EXPECTED_REVEALED_EPOCHS) {
    testAIssues.push(`Pass 2 rows ${rows.length} / seeds_tested ${N} != ${EXPECTED_REVEALED_EPOCHS} revealed epochs`);
  }
  let testARecomputed = 0;
  let testARowFlagDisagreements = 0;
  let testARowsMalformed = 0;
  for (const r of rows) {
    const n = r.earlyTotal + r.lateTotal;
    const w = r.earlyWins + r.lateWins;
    if (!Number.isInteger(n) || !Number.isInteger(w) || n !== pass2.nonces_per_seed || w < 0 || w > n) {
      testARowsMalformed++;
      continue;
    }
    const { pValue } = chiSquaredTest([w, n - w], [pWin * n, (1 - pWin) * n]);
    const fail = pValue < TEST_A_ALPHA;
    if (fail) testARecomputed++;
    if (fail !== r.testA_chi2_fail) testARowFlagDisagreements++;
  }
  if (testARowsMalformed > 0) {
    testAIssues.push(`${testARowsMalformed} row(s) malformed (totals must sum to nonces_per_seed ${pass2.nonces_per_seed})`);
  }
  if (testARecomputed !== testA) {
    testAIssues.push(`recomputed Test A fails ${testARecomputed} != simulator scalar ${JSON.stringify(testA)}`);
  }
  if (testARowFlagDisagreements > 0) {
    testAIssues.push(`${testARowFlagDisagreements} row(s) whose testA_chi2_fail disagrees with the recomputation`);
  }
  const testAExpected = rows.length * TEST_A_ALPHA;
  const testABound    = testAExpected + 5 * Math.sqrt(rows.length * TEST_A_ALPHA * (1 - TEST_A_ALPHA)) + 1;
  const testAOk       = testAIssues.length === 0 && testARecomputed <= testABound;

  // TEST B, RE-DERIVED. earlyP, lateP and cherry_pick_flag were READ from each row and only the
  // classification was recomputed, so a forged Test B row was trusted. Both p-values are now
  // recomputed from the row's integer win counts (the same chiSquaredTest the simulator calls),
  // the flag re-derived, and the artifact's figures and its scalar count cross-checked.
  const testBIssues: string[] = [];
  let testBRecomputed = 0, testBDisagreements = 0;
  const pW = winChance(SIM_PASS2_MINE_COUNT, 0);
  for (const r of rows) {
    if (r.earlyTotal !== SIM_EPOCH_LENGTH || r.lateTotal !== SIM_NONCES_PER_SEED - SIM_EPOCH_LENGTH) { testBDisagreements++; continue; }
    const eP = chiSquaredTest([r.earlyWins, r.earlyTotal - r.earlyWins], [pW * r.earlyTotal, (1 - pW) * r.earlyTotal]).pValue;
    const lP = chiSquaredTest([r.lateWins, r.lateTotal - r.lateWins], [pW * r.lateTotal, (1 - pW) * r.lateTotal]).pValue;
    const flag = eP < 0.05 && lP >= 0.05;
    if (flag) testBRecomputed++;
    if (flag !== r.cherry_pick_flag || Math.abs(eP - r.earlyP) > REDERIVE_ATOL + REDERIVE_RTOL * Math.abs(eP)
      || Math.abs(lP - r.lateP) > REDERIVE_ATOL + REDERIVE_RTOL * Math.abs(lP)) testBDisagreements++;
    r.__earlyP = eP; r.__lateP = lP; r.__flag = flag;
  }
  if (testBDisagreements > 0) testBIssues.push(`${testBDisagreements} Test B row(s) disagree with the re-derivation`);
  if (testBRecomputed !== flags) testBIssues.push(`recomputed Test B flags ${testBRecomputed} != artifact scalar ${flags}`);

  // TEST C — THE SERVED-CONFIGURATION RETURN (profile MINES-21). Tests A and B play a fixed 3-mine
  // board; the profile asks for "the return of the configs the casino actually served in that
  // epoch against the exact per-config mean and variance". For each revealed epoch the configs are
  // the mine counts of its 50 captured bets, by nonce — taken HERE from the dataset and required to
  // equal the row's servedConfigs (G-BIND: the artifact may not choose them). Nonce n is played at
  // servedConfigs[n mod 50] opening tile 0, as every primary bet did, so the seed's 200 windows of 50
  // nonces all carry the same config sequence. The statistic of a window is its standardised return
  // z = (ΣR − Σμ)/√Σσ² with μ, σ² the exact per-round moments of each served config. The NULL is
  // the seed's own 199 later windows — the empirical (block-resampling) distribution of the same
  // statistic under the same seed and configs — so p = (1 + #{later windows with z ≤ early z}) / 200,
  // lower tail (a house-favouring pick makes the served window's return low). Every window is
  // RE-DERIVED here from the row's win bitmasks; the early window is additionally REPLAYED from the
  // revealed seed and must equal the win/loss outcomes the casino actually served in the capture.
  // Pre-registered rule: a seed flags at p < 0.05, whose exact null probability under exchangeable
  // windows is 9/200 (rank ≤ 8); the flag count FAILs above N·α + 5σ + 1. Detection power is
  // printed: P(count > bound) if a fraction f of seeds had been picked so that their served window
  // always flags.
  const testCIssues: string[] = [];
  const WINDOWS = SIM_NONCES_PER_SEED / SIM_EPOCH_LENGTH;
  const alphaC = Math.ceil(TEST_C_ALPHA * WINDOWS - 1) / WINDOWS;   // p < 0.05 ⇔ 1 + rank < 10 ⇔ rank ≤ 8 → 9/200
  let testCFlags = 0, testCRowDisagreements = 0, testCBindFailures = 0, testCReplayFailures = 0;
  const epochBets = new Map<string, MinesGame[]>();
  for (const b of ctx.bets) {
    const arr = epochBets.get(b.seed.serverSeedHashed) ?? [];
    arr.push(b);
    epochBets.set(b.seed.serverSeedHashed, arr);
  }
  const earlyZs: number[] = [];
  for (const r of rows) {
    const served = (epochBets.get(r.serverSeedHashed) ?? []).slice().sort((a, b) => a.seed.nonce - b.seed.nonce);
    const configs = served.map(b => b.request.mines_count);
    if (configs.length !== SIM_EPOCH_LENGTH || JSON.stringify(configs) !== JSON.stringify(r.servedConfigs)) {
      testCBindFailures++;
      continue;
    }
    if (!Array.isArray(r.windowWinBits) || r.windowWinBits.length !== WINDOWS) { testCRowDisagreements++; continue; }
    let zs: number[];
    try { zs = r.windowWinBits.map((h: string) => windowReturnZ(configs, decodeWinBits(h, SIM_EPOCH_LENGTH))); }
    catch { testCRowDisagreements++; continue; }
    const early = zs[0];
    const rank = zs.slice(1).filter(z => z <= early).length;
    const pC = (1 + rank) / WINDOWS;
    const flag = pC < TEST_C_ALPHA;
    if (flag) testCFlags++;
    earlyZs.push(early);
    if (rank !== r.testC_nullRank || flag !== r.testC_flag || Math.abs(early - r.testC_earlyZ) > REDERIVE_ATOL + REDERIVE_RTOL * Math.abs(early)) {
      testCRowDisagreements++;
    }
    // the early window IS the capture: its bits must be the served outcomes, and a replay from the
    // revealed seed must reproduce them.
    const earlyBits = decodeWinBits(r.windowWinBits[0], SIM_EPOCH_LENGTH);
    const servedBits = served.map(b => (b.response.outcome === 'win' ? 1 : 0));
    const ss = ctx.seedMap.get(r.serverSeedHashed);
    let replayOk = !!ss && JSON.stringify(earlyBits) === JSON.stringify(servedBits);
    if (ss && replayOk) {
      const key = Buffer.from(ss, 'hex');
      for (let n = 0; n < SIM_EPOCH_LENGTH && replayOk; n++) {
        const won = computeMinePositionsFromBuffer(key, r.clientSeed, n, configs[n]).includes(0) ? 0 : 1;
        if (won !== earlyBits[n]) replayOk = false;
      }
    }
    if (!replayOk) testCReplayFailures++;
  }
  if (testCBindFailures > 0) testCIssues.push(`${testCBindFailures} row(s) whose servedConfigs are not the dataset's served mine counts`);
  if (testCRowDisagreements > 0) testCIssues.push(`${testCRowDisagreements} row(s) whose Test C figures disagree with the re-derivation`);
  if (testCReplayFailures > 0) testCIssues.push(`${testCReplayFailures} early window(s) not equal to the captured outcomes / the replay`);
  if (pass2.test_c_flags !== testCFlags) testCIssues.push(`artifact test_c_flags ${pass2.test_c_flags} != re-derived ${testCFlags}`);
  const testCExpected = rows.length * alphaC;
  const testCBound = testCExpected + 5 * Math.sqrt(rows.length * alphaC * (1 - alphaC)) + 1;
  const power = [0.1, 0.25, 0.5].map(f => ({ fractionPicked: f,
    detectionPower: binomialUpperTail(rows.length, alphaC + f * (1 - alphaC), testCBound) }));
  const testCOk = testCIssues.length === 0 && testCFlags <= testCBound;

  // "BROAD" WAS UNREACHABLE until 2026-09-23. It was counted only inside `if (r.cherry_pick_flag)`,
  // and the flag requires lateP >= 0.05, so a seed off in BOTH windows was classified nowhere by
  // Test B. It is counted on its own terms from the re-derived p-values.
  //
  // "BROAD" IS SCORED AS A COUNT. A per-seed rule applied to N seeds is N tests: each window is off
  // at p < 0.05 with probability 0.05 on a fair game, so both is 1 in 400 per seed, and at least one
  // of N seeds shows it with probability 1 − 0.9975^N (0.28 at N = 130). The rule therefore scores K,
  // the number of broad seeds, against Binomial(N, 0.05 × 0.05), as Tests A–C score their counts:
  // FLAG when P(K ≥ k) < 0.05, FAIL when P(K ≥ k) < 0.01 (countRuleThreshold gives the k for this N).
  // Every broad seed stays in the record as a disclosed observation (`broadSeeds`), whatever K is.
  // The 0.1% rule — a seed off in both windows at p < 0.001 is a FAIL on its own — meets the 1% cap
  // (its false-alarm rate is printed below, at the larger of the nominal 0.001 × 0.001 and the exact
  // per-seed null).
  const broadSeeds: Array<Record<string, unknown>> = [];
  let broadFlags = 0;
  let earlyOnly  = 0;
  let broadSevere = 0;
  for (const r of rows) {
    const eP = r.__earlyP ?? NaN, lP = r.__lateP ?? NaN;
    if (r.__flag) earlyOnly++;
    if (eP < BROAD_WINDOW_ALPHA && lP < BROAD_WINDOW_ALPHA) {
      broadFlags++;
      if (eP < BROAD_SEVERE_P && lP < BROAD_SEVERE_P) broadSevere++;
      broadSeeds.push({
        serverSeedHashed: r.serverSeedHashed,
        earlyWins: r.earlyWins, earlyTotal: r.earlyTotal, earlyExpected: pW * r.earlyTotal, earlyP: eP,
        lateWins: r.lateWins, lateTotal: r.lateTotal, lateExpected: pW * r.lateTotal, lateP: lP,
      });
    }
  }
  const nSeeds      = rows.length;
  const broadFlagAt = countRuleThreshold(nSeeds, BROAD_PER_SEED_NULL, FLAG_FALSE_ALARM_CAP);
  const broadFailAt = countRuleThreshold(nSeeds, BROAD_PER_SEED_NULL, FAIL_FALSE_ALARM_CAP);
  const broadTail   = binomialTailAtLeast(nSeeds, BROAD_PER_SEED_NULL, broadFlags);
  const broadFail   = broadTail < FAIL_FALSE_ALARM_CAP;
  const broadFlag   = broadTail < FLAG_FALSE_ALARM_CAP;

  // THE NOMINAL PER-SEED NULLS ARE CHECKED AGAINST THE RULES AS IMPLEMENTED. The windows are
  // discrete (50, 9,950 and 10,000 rounds), so a chi-squared test's real rejection probability at the
  // win chance is not exactly its nominal α, and it can sit on either side. It is computed exactly
  // here, with the same chiSquaredTest the re-derivation calls, summed over every possible win
  // count. Every false-alarm rate below uses the LARGER of the nominal and the exact per-seed null,
  // so a rate is never understated by the discreteness of a window.
  const lateN = SIM_NONCES_PER_SEED - SIM_EPOCH_LENGTH;
  const chiP = (n: number) => (w: number) => chiSquaredTest([w, n - w], [pW * n, (1 - pW) * n]).pValue;
  const earlyWindow       = windowRejectProbability(SIM_EPOCH_LENGTH, pW, BROAD_WINDOW_ALPHA, chiP(SIM_EPOCH_LENGTH));
  const lateWindow        = windowRejectProbability(lateN, pW, BROAD_WINDOW_ALPHA, chiP(lateN));
  const earlyWindowSevere = windowRejectProbability(SIM_EPOCH_LENGTH, pW, BROAD_SEVERE_P, chiP(SIM_EPOCH_LENGTH));
  const lateWindowSevere  = windowRejectProbability(lateN, pW, BROAD_SEVERE_P, chiP(lateN));
  const fullWindowTestA   = windowRejectProbability(SIM_NONCES_PER_SEED, pWin, TEST_A_ALPHA, w =>
    chiSquaredTest([w, SIM_NONCES_PER_SEED - w], [pWin * SIM_NONCES_PER_SEED, (1 - pWin) * SIM_NONCES_PER_SEED]).pValue);
  const exactNull = {
    earlyWindow, lateWindow, earlyWindowSevere, lateWindowSevere, fullWindowTestA,
    perSeedTestA: fullWindowTestA,
    perSeedTestB: earlyWindow * (1 - lateWindow),
    perSeed: earlyWindow * lateWindow,
    perSeedSevere: earlyWindowSevere * lateWindowSevere,
  };
  const perSeedNull = {
    nullTestA:  Math.max(TEST_A_ALPHA, exactNull.perSeedTestA),
    nullTestB:  Math.max(TEST_B_PER_SEED_NULL, exactNull.perSeedTestB),
    nullTestC:  alphaC,
    nullBroad:  Math.max(BROAD_PER_SEED_NULL, exactNull.perSeed),
    nullSevere: Math.max(BROAD_SEVERE_PER_SEED_NULL, exactNull.perSeedSevere),
  };

  // THE VERDICT USED TO STOP AT FLAG. `flags <= threshold && broadFlags === 0 ? 'PASS' : 'FLAG'`
  // had no FAIL branch, so the most damning Pass-2 result imaginable could only ever downgrade the
  // audit to a Conditional Pass. A FAIL is reachable on four statistical grounds: the cherry-pick
  // flag count exceeds TWICE the flag threshold (more than 4x the count chance predicts); the broad
  // count reaches its FAIL k; any seed is broad at p < BROAD_SEVERE_P in both windows; Test A or
  // Test C exceeds its 5σ + 1 bound. Between the FLAG line and the FAIL line the verdict is FLAG, and
  // tests/verify.ts exits 2 on it so nothing automated reads it as clean.
  const failThreshold = threshold * 2;
  const testBOk = testBIssues.length === 0;

  // THE FALSE-ALARM RATE OF EVERY VERDICT-MOVING RULE, on a fair game:
  // the probability that the rule fires when every seed is fair, from each rule's per-seed null
  // (above: the larger of nominal and exact; Test C's 9/200 is exact under exchangeable windows).
  // The step-level figures are union bounds over the rules that can produce that status.
  const falseAlarm = {
    testAFail:       binomialUpperTail(nSeeds, perSeedNull.nullTestA, testABound),
    testBFlag:       binomialUpperTail(nSeeds, perSeedNull.nullTestB, threshold),
    testBFail:       binomialUpperTail(nSeeds, perSeedNull.nullTestB, failThreshold),
    testCFail:       binomialUpperTail(nSeeds, perSeedNull.nullTestC, testCBound),
    broadFlag:       binomialTailAtLeast(nSeeds, perSeedNull.nullBroad, broadFlagAt),
    broadFail:       binomialTailAtLeast(nSeeds, perSeedNull.nullBroad, broadFailAt),
    broadSevereFail: binomialTailAtLeast(nSeeds, perSeedNull.nullSevere, 1),
    unionBoundFail: 0,
    unionBoundFlagOrFail: 0,
  };
  falseAlarm.unionBoundFail = falseAlarm.testAFail + falseAlarm.testBFail + falseAlarm.testCFail
    + falseAlarm.broadFail + falseAlarm.broadSevereFail;
  falseAlarm.unionBoundFlagOrFail = falseAlarm.testAFail + falseAlarm.testBFlag + falseAlarm.testCFail
    + falseAlarm.broadFlag + falseAlarm.broadSevereFail;
  const rulesOverCap = [
    ...(['testAFail', 'testBFail', 'testCFail', 'broadFail', 'broadSevereFail'] as const)
      .filter(k => !(falseAlarm[k] <= FAIL_FALSE_ALARM_CAP)),
    ...(['testBFlag', 'broadFlag'] as const).filter(k => !(falseAlarm[k] <= FLAG_FALSE_ALARM_CAP)),
  ];

  const fmtP = (p: number) => (p >= 0.001 ? p.toFixed(4) : p.toExponential(1));
  const verdict = flags > failThreshold || broadFail || broadSevere > 0 || !testAOk || !testBOk || !testCOk ? 'FAIL'
    : flags > threshold || broadFlag ? 'FLAG'
    : 'PASS';
  const s19 = step(19, 'Simulation Results — Pass 2 Cherry-Pick Test', verdict,
    `${N} seeds × mines=${pass2.mine_count ?? 'varied'}; Test A: ${testARecomputed}/${rows.length} seeds fail `
    + `chi-squared at α=${TEST_A_ALPHA} (recomputed from the per-seed rows; FAIL above the 5σ+1 bound `
    + `${testABound.toFixed(2)} = ${testAExpected.toFixed(2)} expected + 5σ + 1)`
    + `${testAIssues.length ? ` — TEST A INVALID: ${testAIssues.join('; ')}` : ''}; `
    + `Test B: ${flags}/${N} flags (FLAG above ${threshold} = 2×${expCP}, FAIL above ${failThreshold}); `
    + `${earlyOnly} isolated-early; broad (early AND late window both off at p<${BROAD_WINDOW_ALPHA}): `
    + `${broadFlags}/${nSeeds} seeds, scored as a count against Binomial(${nSeeds}, ${BROAD_WINDOW_ALPHA} × ${BROAD_WINDOW_ALPHA} = ${BROAD_PER_SEED_NULL}): `
    + `P(K ≥ ${broadFlags}) = ${fmtP(broadTail)}, FLAG at K ≥ ${broadFlagAt}, FAIL at K ≥ ${broadFailAt}`
    + `${broadSeeds.length ? ` (disclosed: ${broadSeeds.slice(0, 5).map(b => `${String(b.serverSeedHashed).slice(0, 8)}… early `
      + `${b.earlyWins}/${b.earlyTotal} (${(b.earlyExpected as number).toFixed(1)} expected, p=${fmtP(b.earlyP as number)}), late `
      + `${b.lateWins}/${b.lateTotal} (${(b.lateExpected as number).toFixed(1)} expected, p=${fmtP(b.lateP as number)})`).join('; ')}`
      + `${broadSeeds.length > 5 ? `; ${broadSeeds.length - 5} more in data` : ''})` : ''}; `
    + `${broadSevere} broad at p<${BROAD_SEVERE_P} in both windows (FAIL if any), `
    + `every early/late p-value re-derived from the win counts${testBIssues.length ? ` — TEST B INVALID: ${testBIssues.join('; ')}` : ''}; `
    + `Test C (served-config return vs its own 199-window null, early window = the captured epoch and replayed): `
    + `${testCFlags}/${rows.length} seeds flag at p<${TEST_C_ALPHA} (FAIL above ${testCBound.toFixed(2)} = N·${alphaC} + 5σ + 1; `
    + `detection power ${power.map(x => `${x.detectionPower.toFixed(3)} at f=${x.fractionPicked}`).join(', ')})`
    + `${testCIssues.length ? ` — TEST C INVALID: ${testCIssues.join('; ')}` : ''}; `
    + `false-alarm rate on a fair game of each verdict-moving rule, at the per-seed nulls below (cap ${FLAG_FALSE_ALARM_CAP} for a FLAG, ${FAIL_FALSE_ALARM_CAP} for a FAIL): `
    + `Test A FAIL ${fmtP(falseAlarm.testAFail)}, Test B FLAG ${fmtP(falseAlarm.testBFlag)} / FAIL ${fmtP(falseAlarm.testBFail)}, `
    + `Test C FAIL ${fmtP(falseAlarm.testCFail)}, broad FLAG ${fmtP(falseAlarm.broadFlag)} / FAIL ${fmtP(falseAlarm.broadFail)}, `
    + `broad at p<${BROAD_SEVERE_P} FAIL ${fmtP(falseAlarm.broadSevereFail)}; union over the step ≤ ${fmtP(falseAlarm.unionBoundFlagOrFail)} `
    + `for FLAG or worse, ≤ ${fmtP(falseAlarm.unionBoundFail)} for FAIL; `
    + `${rulesOverCap.length ? `RULE OVER CAP: ${rulesOverCap.join(', ')}` : 'every rule within its cap'}; `
    + `per-seed null of each rule, the larger of nominal and exact (exact: the rule's own chi-squared test summed over `
    + `every win count at win chance ${pW}): Test A ${fmtP(perSeedNull.nullTestA)} (nominal ${TEST_A_ALPHA}, exact `
    + `${fmtP(exactNull.perSeedTestA)} on ${SIM_NONCES_PER_SEED.toLocaleString('en-US')} rounds), Test B ${fmtP(perSeedNull.nullTestB)} `
    + `(nominal ${TEST_B_PER_SEED_NULL}, exact ${fmtP(exactNull.perSeedTestB)}), Test C ${alphaC} (exact), broad `
    + `${fmtP(perSeedNull.nullBroad)} (nominal ${BROAD_PER_SEED_NULL}, exact ${fmtP(earlyWindow)} on ${SIM_EPOCH_LENGTH} rounds × `
    + `${fmtP(lateWindow)} on ${lateN.toLocaleString('en-US')} = ${fmtP(exactNull.perSeed)}), broad at p<${BROAD_SEVERE_P} `
    + `${fmtP(perSeedNull.nullSevere)} (nominal ${fmtP(BROAD_SEVERE_PER_SEED_NULL)}, exact ${fmtP(earlyWindowSevere)} × `
    + `${fmtP(lateWindowSevere)} = ${fmtP(exactNull.perSeedSevere)}) — `
    + `${verdict === 'PASS' ? 'no cherry-picking detected'
      : verdict === 'FLAG' ? (broadFlag ? `INVESTIGATE ${broadFlags} seeds off in both windows` : 'INVESTIGATE cherry-pick flag count')
      : flags > failThreshold || broadFail || broadSevere > 0 ? 'BIASED SEED SELECTION'
      : !testCOk ? 'TEST C FAILED'
      : !testBOk ? 'TEST B FAILED'
      : 'TEST A FAILED'}`,
    { seedsTested: N, testAFails: testARecomputed, testAFailsSimulatorScalar: testA, testAAlpha: TEST_A_ALPHA,
      testAExpected, testABound, testAIssues, testAWinChance: pWin,
      cherryPickFlags: flags, flagThreshold: threshold, failThreshold,
      isolatedEarly: earlyOnly,
      broadFlags, broadWindowAlpha: BROAD_WINDOW_ALPHA, broadPerSeedNull: BROAD_PER_SEED_NULL,
      broadTailProbability: broadTail, broadFlagAt, broadFailAt, broadSeeds,
      broadSevere, broadSevereP: BROAD_SEVERE_P, broadSeverePerSeedNull: BROAD_SEVERE_PER_SEED_NULL,
      exactNull, perSeedNull,
      falseAlarmCaps: { flagCap: FLAG_FALSE_ALARM_CAP, failCap: FAIL_FALSE_ALARM_CAP }, falseAlarm, rulesOverCap,
      testBRecomputedFlags: testBRecomputed, testBRowDisagreements: testBDisagreements,
      testC: { flags: testCFlags, alpha: TEST_C_ALPHA, nullFlagProbability: alphaC, windowsPerSeed: WINDOWS,
        expected: testCExpected, bound: testCBound, bindFailures: testCBindFailures, rowDisagreements: testCRowDisagreements,
        earlyWindowReplayFailures: testCReplayFailures, power,
        minEarlyZ: earlyZs.length ? Math.min(...earlyZs) : null, maxEarlyZ: earlyZs.length ? Math.max(...earlyZs) : null } },
  );

  return [s18, s19];
}
