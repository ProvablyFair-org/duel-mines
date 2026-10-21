/**
 * Two-pass Monte Carlo simulation for Duel.com Mines audit.
 *
 * Pass 1 — Fresh random seeds (1 per config x 1,000,000 rounds x 24 configs = 24M rounds total).
 *   Grid: 25 tiles, mine counts 1-24.
 *   Strategy: reveal tile (nonce % 25). Win if tile is NOT a mine.
 *   Payout: theoreticalMultiplier(mineCount, 1, 0.001) on win, 0 on loss.
 *   Theoretical RTP per config: winChance(m, 0) x mult(m, 1) = 0.999 for all m.
 *   Chi-squared on 25-bin mine position frequencies, serial independence per config.
 *
 * Pass 2 — Casino seeds (10,000 nonces per revealed seed).
 *   Test A: chi-squared on full nonce range vs binomial win/loss at representative mine count.
 *   Test B: early epoch (0-49) vs late (50-9999) — cherry-pick detection.
 *
 * Output: outputs/simulation-results.json, outputs/rtp-convergence.html
 *
 * OUTPUT DIRECTORY. PF_EMIT=1 rewrites the committed artifacts in outputs/ (author, on a
 * deliberate regeneration); otherwise the run lands in outputs/run/ so `npm run test:full` can
 * re-simulate without touching the artifact of record or the tracked chart. Until this guard
 * existed `npm test` chained a simulation that overwrote both on every run, so a fresh clone
 * could never reproduce the committed figures — it replaced them.
 *
 * IF YOU REGENERATE with PF_EMIT=1: re-pin outputs/rtp-convergence.html in src/artifact-pins.ts
 * in the same commit, and sweep every simulation figure quoted in the .md chapters.
 */

import * as fs   from 'fs';
import * as path from 'path';

import { computeMinePositionsFromBuffer, theoreticalMultiplier, winChance } from './rng';
import { chiSquaredTest, lag1Autocorrelation, runsTest }                    from './stats';
import { positionChi2WithoutReplacement, PASS1_CHECKPOINT_ROUNDS, windowReturnZ, encodeWinBits, runsFromCensus } from './sim-census';
import { loadDataset, buildSeedMap }                                         from './loader';
import {
  SIM_SEEDS, SIM_CONFIGS, SIM_ROUNDS_PER_CONFIG, SIM_NONCES_PER_SEED, SIM_EPOCH_LENGTH, SIM_PASS2_MINE_COUNT,
} from './sim-plan';

// ── Constants ────────────────────────────────────────────────────────────────

const GRID_SIZE           = 25;
// The plan lives in src/sim-plan.ts so the verifier binds the artifact to the SAME constants.
const CONFIGS             = SIM_CONFIGS;                                  // mine counts 1-24
const ROUNDS_PER_CONFIG   = SIM_ROUNDS_PER_CONFIG;
const NONCES_PER_SEED     = SIM_NONCES_PER_SEED;
const EPOCH_LENGTH        = SIM_EPOCH_LENGTH;
const THEORETICAL_RTP     = 0.999; // 99.9% — uniform 0.1% house edge
const CONVERGENCE_SAMPLES = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

// Representative mine count for Pass 2 — 3 mines gives ~88% win chance,
// yielding ~8,800 wins in 10K nonces (well above chi-squared minimum).
const PASS2_MINE_COUNT = SIM_PASS2_MINE_COUNT;

// ── Pinned simulation seeds — src/sim-plan.ts (shared with the verifier's replay) ──

// ── Progress bar ─────────────────────────────────────────────────────────────

const SPINNER = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];
let spinIdx = 0;
let lastProgressLine = '';
let spinnerTimer: ReturnType<typeof setInterval> | null = null;

function startSpinner(): void {
  if (spinnerTimer) return;
  spinnerTimer = setInterval(() => {
    if (!lastProgressLine) return;
    spinIdx++;
    const spin = SPINNER[spinIdx % SPINNER.length];
    // Replace the spinner char (first non-space after \r  )
    const updated = lastProgressLine.replace(/^(\r  )./, `$1${spin}`);
    process.stdout.write(updated);
  }, 120);
}

function stopSpinner(): void {
  if (spinnerTimer) { clearInterval(spinnerTimer); spinnerTimer = null; }
}

function progressBar(current: number, total: number, label: string, startMs: number, width = 30): void {
  const ratio   = Math.min(total > 0 ? current / total : 0, 1);
  const filled  = Math.round(ratio * width);
  const bar     = '\u2501'.repeat(filled) + '\u254C'.repeat(width - filled);
  const pct     = (ratio * 100).toFixed(0).padStart(3);
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  const eta     = current > 0 ? (((Date.now() - startMs) / current) * (total - current) / 1000).toFixed(0) : '?';
  const spin    = SPINNER[spinIdx % SPINNER.length];
  lastProgressLine = `\r  ${spin} ${bar} ${pct}% | ${current}/${total} | ${label} | ${elapsed}s elapsed ~ ${eta}s left`;
  process.stdout.write(lastProgressLine);
}

function clearLine(): void {
  process.stdout.write('\r\x1b[K');
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Binomial survival function: P(X >= k | n, p).
 * Log-space to avoid overflow.
 */
function binomSurvival(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  let cdf = 0;
  for (let i = 0; i < k; i++) {
    cdf += binomPMF(i, n, p);
  }
  return Math.max(0, 1 - cdf);
}

function binomPMF(k: number, n: number, p: number): number {
  let logP = 0;
  for (let i = 0; i < k; i++) {
    logP += Math.log(n - i) - Math.log(i + 1);
  }
  logP += k * Math.log(p) + (n - k) * Math.log(1 - p);
  return Math.exp(logP);
}

// ══════════════════════════════════════════════════════════════════════════════
//  PASS 1 — Fresh Seeds
// ══════════════════════════════════════════════════════════════════════════════

console.log('\u2550'.repeat(60));
console.log('  PASS 1 \u2014 Fresh random seeds');
console.log(`  ${CONFIGS.length} configs (mines 1\u201324) \u00d7 ${ROUNDS_PER_CONFIG.toLocaleString()} rounds`);
console.log('\u2550'.repeat(60) + '\n');

interface Pass1Result {
  mineCount:        number;
  theoreticalRTP:   number;
  simulatedRTP:     number;
  winRate:          number;
  theoreticalWin:   number;
  positionChi2:     number;
  positionDf:       number;
  positionPValue:   number;
  r1:               number;
  r1Z:              number;
  runsZ:            number;
  runsPValue:       number;
  rtpSnapshots:     Map<number, number>;
  census:           Pass1Census;
}

/**
 * THE CENSUS — integer counts from which every Pass-1 statistic is RE-DERIVED by the verifier
 * (tests/steps/simulation.ts), and which `npm run replay` reproduces byte for byte from SIM_SEEDS.
 * Until these existed the rows carried only the finished statistics (positionPValue, r1Z,
 * runsPValue), so the verifier could count flags but had to TRUST each p-value: a forged row was
 * indistinguishable from a real one.
 */
interface Pass1Census {
  rounds:            number;
  /** Mine-position frequency per tile 0..24 over all rounds (m per round, without replacement). */
  positionCounts:    number[];
  wins:              number;
  /** Adjacent (win, win) pairs in the win/loss sequence — the lag-1 cross product for a 0/1 series. */
  adjacentWinPairs:  number;
  /** Outcome changes between consecutive rounds; runs = transitions + 1. */
  transitions:       number;
  firstOutcome:      number;
  lastOutcome:       number;
  /** The same position counts and win count after the first PASS1_CHECKPOINT_ROUNDS rounds —
   *  what the verifier replays on every run (the full replay is `npm run replay`). */
  checkpoint:        { rounds: number; positionCounts: number[]; wins: number };
}

const pass1Results: Pass1Result[] = [];
const pass1Start = Date.now();
progressBar(0, CONFIGS.length, 'starting...', pass1Start);
startSpinner();

for (let ci = 0; ci < CONFIGS.length; ci++) {
  const mineCount = CONFIGS[ci];
  const theoWin   = winChance(mineCount, 0);       // P(safe) = (25 - m) / 25
  const mult      = theoreticalMultiplier(mineCount, 1, 0.001);
  const theoRTP   = theoWin * mult;                 // should be 0.999

  const seedPair  = SIM_SEEDS[ci];
  const keyBuffer = Buffer.from(seedPair.server, 'hex');

  // 25-bin position frequency counter (how often each tile appears in mine set)
  const positionFreq = new Array(GRID_SIZE).fill(0);
  const winSequence: number[] = new Array(ROUNDS_PER_CONFIG);
  let totalPayout = 0;
  let totalWins   = 0;

  const sampleSet    = new Set(CONVERGENCE_SAMPLES.filter(s => s <= ROUNDS_PER_CONFIG));
  const rtpSnapshots = new Map<number, number>();
  let adjacentWinPairs = 0, transitions = 0, prevWon = -1;
  let checkpoint: { rounds: number; positionCounts: number[]; wins: number } | null = null;

  for (let nonce = 0; nonce < ROUNDS_PER_CONFIG; nonce++) {
    const mines = computeMinePositionsFromBuffer(keyBuffer, seedPair.client, nonce, mineCount);

    // Count mine position frequencies for chi-squared
    for (const pos of mines) {
      positionFreq[pos]++;
    }

    // Reveal tile = nonce % 25 (rotating tile strategy)
    const revealTile = nonce % GRID_SIZE;
    const mineSet    = new Set(mines);
    const won        = !mineSet.has(revealTile);

    if (won) {
      totalWins++;
      totalPayout += mult;
    }
    winSequence[nonce] = won ? 1 : 0;
    const w = won ? 1 : 0;
    if (prevWon >= 0) {
      if (w !== prevWon) transitions++;
      if (w === 1 && prevWon === 1) adjacentWinPairs++;
    }
    prevWon = w;

    const roundNum = nonce + 1;
    if (roundNum === PASS1_CHECKPOINT_ROUNDS) {
      checkpoint = { rounds: roundNum, positionCounts: [...positionFreq], wins: totalWins };
    }
    if (sampleSet.has(roundNum)) {
      rtpSnapshots.set(roundNum, totalPayout / roundNum);
    }
  }

  const simRTP   = totalPayout / ROUNDS_PER_CONFIG;
  const winRate  = totalWins / ROUNDS_PER_CONFIG;

  // Chi-squared on mine position frequencies (25 bins).
  // Expected: each tile should appear mineCount/25 * ROUNDS_PER_CONFIG times.
  const expectedPerBin = (mineCount / GRID_SIZE) * ROUNDS_PER_CONFIG;
  const expectedCounts = new Array(GRID_SIZE).fill(expectedPerBin);
  const { chi2: posChi2, df: posDf, pValue: posPValue } = chiSquaredTest([...positionFreq], expectedCounts);

  // Serial independence on win/loss sequence
  const r1                        = lag1Autocorrelation(winSequence);
  const r1Z                       = r1 * Math.sqrt(ROUNDS_PER_CONFIG);
  const { z: runsZ, pValue: runsP } = runsTest(winSequence);
  if (!checkpoint) throw new Error(`checkpoint at ${PASS1_CHECKPOINT_ROUNDS} rounds never reached`);

  pass1Results.push({
    mineCount,
    theoreticalRTP:   theoRTP,
    simulatedRTP:     simRTP,
    winRate,
    theoreticalWin:   theoWin,
    positionChi2:     posChi2,
    positionDf:       posDf,
    positionPValue:   posPValue,
    r1,
    r1Z,
    runsZ,
    runsPValue:       runsP,
    rtpSnapshots,
    census: {
      rounds: ROUNDS_PER_CONFIG,
      positionCounts: [...positionFreq],
      wins: totalWins,
      adjacentWinPairs,
      transitions,
      firstOutcome: winSequence[0],
      lastOutcome: winSequence[ROUNDS_PER_CONFIG - 1],
      checkpoint,
    },
  });

  progressBar(ci + 1, CONFIGS.length, `mines=${mineCount}`, pass1Start);
}

stopSpinner();
clearLine();
progressBar(CONFIGS.length, CONFIGS.length, 'done', pass1Start);
process.stdout.write('\n');

// ── Convergence data (mean RTP across configs at increasing sample sizes) ────

interface ConvergencePoint {
  roundsPerConfig: number;
  label:           string;
  meanRTP:         number;
  stdDev:          number;
}

const convergenceData: ConvergencePoint[] = [];

for (const sampleN of CONVERGENCE_SAMPLES) {
  const rtpValues: number[] = [];
  for (const r of pass1Results) {
    const rtp = r.rtpSnapshots.get(sampleN);
    if (rtp !== undefined) rtpValues.push(rtp);
  }
  if (rtpValues.length === 0) continue;

  const mean = rtpValues.reduce((a, b) => a + b, 0) / rtpValues.length;
  const variance = rtpValues.length > 1
    ? rtpValues.reduce((a, b) => a + (b - mean) ** 2, 0) / (rtpValues.length - 1)
    : 0;

  const label = sampleN >= 1_000_000
    ? `${(sampleN / 1e6).toFixed(0)}M`
    : sampleN >= 1_000
      ? `${(sampleN / 1e3).toFixed(0)}K`
      : `${sampleN}`;

  const stdErr = rtpValues.length > 1 ? Math.sqrt(variance) / Math.sqrt(rtpValues.length) : 0;
  convergenceData.push({
    roundsPerConfig: sampleN,
    label,
    meanRTP: mean,
    stdDev: stdErr,
  });
}

// ── Pass 1 summary ───────────────────────────────────────────────────────────

const pass1ElapsedMs      = Date.now() - pass1Start;
const pass1Chi2Fails      = pass1Results.filter(r => r.positionPValue < 0.01).length;
const bonAlpha            = 0.01 / CONFIGS.length;
const pass1Chi2FailsBon   = pass1Results.filter(r => r.positionPValue < bonAlpha).length;
const pass1SerialFails    = pass1Results.filter(r => Math.abs(r.r1Z) > 3 || r.runsPValue < 0.01).length;
const pass1AvgRTP         = pass1Results.reduce((a, r) => a + r.simulatedRTP, 0) / pass1Results.length;
const pass1AvgTheoRTP     = pass1Results.reduce((a, r) => a + r.theoreticalRTP, 0) / pass1Results.length;

console.log(`\n  Avg simulated RTP:   ${(pass1AvgRTP * 100).toFixed(4)}%`);
console.log(`  Avg theoretical RTP: ${(pass1AvgTheoRTP * 100).toFixed(4)}%`);
console.log(`  FWER: Bonferroni \u03b1/N = ${bonAlpha.toFixed(6)} (N=${CONFIGS.length})`);
console.log(`  Position chi-squared fails: ${pass1Chi2Fails}/${CONFIGS.length} at \u03b1=0.01 \u00b7 ${pass1Chi2FailsBon}/${CONFIGS.length} at Bonferroni \u03b1/${CONFIGS.length}`);
console.log(`  Serial independence fails: ${pass1SerialFails}/${CONFIGS.length} (|r\u2081z|>3 or runs p<0.01)`);
console.log(`  Time: ${(pass1ElapsedMs / 1000).toFixed(1)}s\n`);

// ══════════════════════════════════════════════════════════════════════════════
//  PASS 2 — Casino Seeds (cherry-pick detection)
// ══════════════════════════════════════════════════════════════════════════════

console.log('\u2550'.repeat(60));
console.log('  PASS 2 \u2014 Casino seeds');

const dataset  = loadDataset();
const seedMap  = buildSeedMap(dataset.seeds);

// Build map: serverSeedHashed -> clientSeed used in actual bets
const clientSeedForHash = new Map<string, string>();
for (const [hash] of seedMap) {
  const counts = new Map<string, number>();
  for (const bet of dataset.bets) {
    if (bet.seed.serverSeedHashed === hash) {
      const cs = bet.seed.clientSeed;
      counts.set(cs, (counts.get(cs) || 0) + 1);
    }
  }
  if (counts.size > 0) {
    let bestCS = '';
    let bestCount = 0;
    for (const [cs, count] of counts) {
      if (count > bestCount) { bestCS = cs; bestCount = count; }
    }
    clientSeedForHash.set(hash, bestCS);
  }
}

// Test C needs the configurations the casino ACTUALLY SERVED in each epoch: the mine count of the
// captured bet at every nonce 0..EPOCH_LENGTH-1, from the dataset, never a representative board.
const servedConfigsForHash = new Map<string, number[]>();
for (const [hash] of seedMap) {
  const epochBets = dataset.bets.filter(b => b.seed.serverSeedHashed === hash)
    .sort((a, b) => a.seed.nonce - b.seed.nonce);
  if (epochBets.length !== EPOCH_LENGTH || epochBets.some((b, i) => b.seed.nonce !== i)) {
    throw new Error(`epoch ${hash.slice(0, 16)}: served configs need nonces 0..${EPOCH_LENGTH - 1}, found ${epochBets.length} bets`);
  }
  servedConfigsForHash.set(hash, epochBets.map(b => b.request.mines_count));
}

const theoWinPass2 = winChance(PASS2_MINE_COUNT, 0);
const multPass2    = theoreticalMultiplier(PASS2_MINE_COUNT, 1, 0.001);
const seedEntries  = Array.from(seedMap.entries());

console.log(`  ${seedEntries.length} revealed seeds \u00d7 mines=${PASS2_MINE_COUNT} (${(theoWinPass2 * 100).toFixed(1)}% win rate)`);
console.log(`  ${NONCES_PER_SEED.toLocaleString()} nonces per seed (early: 0\u2013${EPOCH_LENGTH - 1}, late: ${EPOCH_LENGTH}\u2013${NONCES_PER_SEED - 1})`);
console.log('\u2550'.repeat(60) + '\n');

interface Pass2Result {
  serverSeedHashed: string;
  clientSeed:       string;
  mineCount:        number;
  earlyWins:        number;
  earlyTotal:       number;
  earlyP:           number;
  lateWins:         number;
  lateTotal:        number;
  lateP:            number;
  testA_chi2_fail:  boolean;
  cherry_pick_flag: boolean;
  /**
   * TEST C — the served-configuration return. The configs are the mine counts the casino served
   * at nonces 0..49 of this epoch (servedConfigs); nonce n is played at config servedConfigs[n mod
   * 50], opening tile 0 as every primary bet did. Window w covers nonces 50w..50w+49, so all 200
   * windows carry the SAME config sequence and differ only in the seed's draws. `windowWinBits[w]`
   * is the 50 win/loss outcomes of window w as a hex bitmask (bit i = nonce 50w+i won), from which
   * the verifier re-derives every window's return z against the exact per-config mean and variance.
   */
  servedConfigs:    number[];
  windowWinBits:    string[];
  testC_earlyZ:     number;
  testC_nullRank:   number;
  testC_pValue:     number;
  testC_flag:       boolean;
}

const pass2Results: Pass2Result[] = [];
let testAFails      = 0;
let cherryPickFlags = 0;

const pass2Start = Date.now();
progressBar(0, seedEntries.length, 'starting...', pass2Start);
startSpinner();

for (let si = 0; si < seedEntries.length; si++) {
  const [hash, serverSeed] = seedEntries[si];
  const clientSeed = clientSeedForHash.get(hash) || 'auditSeed';
  const keyBuf     = Buffer.from(serverSeed, 'hex');

  let earlyWins = 0;
  let lateWins  = 0;
  const served  = servedConfigsForHash.get(hash)!;
  const windowOutcomes: number[][] = Array.from({ length: NONCES_PER_SEED / EPOCH_LENGTH }, () => []);

  for (let nonce = 0; nonce < NONCES_PER_SEED; nonce++) {
    const mines     = computeMinePositionsFromBuffer(keyBuf, clientSeed, nonce, PASS2_MINE_COUNT);
    const mineSet   = new Set(mines);
    const revealTile = nonce % GRID_SIZE;
    const won       = !mineSet.has(revealTile);

    if (won) {
      if (nonce < EPOCH_LENGTH) earlyWins++;
      else lateWins++;
    }

    // Test C: the served config at this position of the epoch, tile 0 opened.
    const servedM = served[nonce % EPOCH_LENGTH];
    const servedMines = computeMinePositionsFromBuffer(keyBuf, clientSeed, nonce, servedM);
    windowOutcomes[Math.floor(nonce / EPOCH_LENGTH)].push(servedMines.includes(0) ? 0 : 1);
  }
  const windowZ = windowOutcomes.map(o => windowReturnZ(served, o));
  const earlyZ  = windowZ[0];
  // Lower tail: cherry-picking in the house's favour makes the served window's return LOW.
  const nullRank = windowZ.slice(1).filter(z => z <= earlyZ).length;
  const testC_pValue = (1 + nullRank) / windowZ.length;

  // Test A: chi-squared on full range
  const totalWins = earlyWins + lateWins;
  const { pValue: pA } = chiSquaredTest(
    [totalWins, NONCES_PER_SEED - totalWins],
    [theoWinPass2 * NONCES_PER_SEED, (1 - theoWinPass2) * NONCES_PER_SEED],
  );
  const testA_fail = pA < 0.01;
  if (testA_fail) testAFails++;

  // Test B: early vs late — cherry-picking detection
  const lateCount = NONCES_PER_SEED - EPOCH_LENGTH;
  const { pValue: pEarly } = chiSquaredTest(
    [earlyWins, EPOCH_LENGTH - earlyWins],
    [theoWinPass2 * EPOCH_LENGTH, (1 - theoWinPass2) * EPOCH_LENGTH],
  );
  const { pValue: pLate } = chiSquaredTest(
    [lateWins, lateCount - lateWins],
    [theoWinPass2 * lateCount, (1 - theoWinPass2) * lateCount],
  );
  const cherry_pick_flag = pEarly < 0.05 && pLate >= 0.05;
  if (cherry_pick_flag) cherryPickFlags++;

  pass2Results.push({
    serverSeedHashed: hash,
    clientSeed,
    mineCount: PASS2_MINE_COUNT,
    earlyWins, earlyTotal: EPOCH_LENGTH, earlyP: pEarly,
    lateWins,  lateTotal:  lateCount,    lateP:  pLate,
    testA_chi2_fail: testA_fail,
    cherry_pick_flag,
    servedConfigs: served,
    windowWinBits: windowOutcomes.map(encodeWinBits),
    testC_earlyZ: earlyZ,
    testC_nullRank: nullRank,
    testC_pValue,
    testC_flag: testC_pValue < 0.05,
  });

  progressBar(si + 1, seedEntries.length, `seed ${si + 1}/${seedEntries.length}`, pass2Start);
}

stopSpinner();
clearLine();
progressBar(seedEntries.length, seedEntries.length, 'done', pass2Start);
process.stdout.write('\n');

const pass2ElapsedMs = Date.now() - pass2Start;
const N = pass2Results.length;

// Binomial p-values for verdict
const testAPValue    = binomSurvival(testAFails, N, 0.01);
const testAVerdict   = testAPValue >= 0.01 ? 'PASS' : 'FAIL';
const testARange     = testAPValue >= 0.01
  ? `within expected range (binomial p=${testAPValue.toFixed(4)})`
  : `EXCEEDS expected range (binomial p=${testAPValue.toFixed(4)})`;

const cherryPValue   = binomSurvival(cherryPickFlags, N, 0.05);
const cherryVerdict  = cherryPValue >= 0.01 ? 'PASS' : 'FAIL';
const cherryRange    = cherryPValue >= 0.01
  ? `within expected range (binomial p=${cherryPValue.toFixed(4)})`
  : `EXCEEDS expected range \u2014 cherry-picking signal (binomial p=${cherryPValue.toFixed(4)})`;

console.log(`\n  Seeds tested: ${seedEntries.length}`);
console.log(`  Test A fails (p<0.01): ${testAFails} / ${N} \u2014 ${testARange} [${testAVerdict}]`);
console.log(`  Cherry-pick flags: ${cherryPickFlags} / ${N} \u2014 ${cherryRange} [${cherryVerdict}]`);
console.log(`  Time: ${(pass2ElapsedMs / 1000).toFixed(1)}s\n`);

// ══════════════════════════════════════════════════════════════════════════════
//  Write output
// ══════════════════════════════════════════════════════════════════════════════

// PF_EMIT=1 rewrites the committed artifacts; otherwise this run lands in outputs/run/ (gitignored).
const PF_EMIT     = process.env.PF_EMIT === '1';
const OUTPUTS_BASE = path.join(__dirname, '..', 'outputs');
const OUTPUTS_DIR  = PF_EMIT ? OUTPUTS_BASE : path.join(OUTPUTS_BASE, 'run');
const WROTE_TO     = PF_EMIT ? 'outputs' : 'outputs/run';
fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// Serialize pass1Results without Map (JSON-safe)
const pass1Serializable = pass1Results.map(r => ({
  mineCount:        r.mineCount,
  theoreticalRTP:   r.theoreticalRTP,
  simulatedRTP:     r.simulatedRTP,
  winRate:          r.winRate,
  theoreticalWin:   r.theoreticalWin,
  positionChi2:     r.positionChi2,
  positionDf:       r.positionDf,
  positionPValue:   r.positionPValue,
  r1:               r.r1,
  r1Z:              r.r1Z,
  runsZ:            r.runsZ,
  runsPValue:       r.runsPValue,
  ...positionChi2WithoutReplacement(r.census.positionCounts, r.mineCount, r.census.rounds),
  // The runs test on the win/loss dichotomy. runsZ/runsPValue above are the legacy median split,
  // which is vacuous (z = 0, p = 1) whenever losses are the majority — every m >= 13.
  runsZWinLoss:     runsFromCensus(r.census).z,
  runsPValueWinLoss: runsFromCensus(r.census).pValue,
  census:           r.census,
}));

// RUN METADATA IS ABSENT, NOT EXCLUDED. `generatedAt` and `executionTimeMs` used to live in this
// artifact, so no regeneration could ever reproduce its bytes and it could not be pinned. The
// wall-clock figures are printed to the console above; the artifact carries only the experiment.
const output = {
  pass1_fresh_seeds: {
    description: 'Auditor-generated random seeds through src/rng.ts, which is rebuilt from a written specification (docs/ALGORITHM.md) by an implementer who never opened Duel\'s code; Duel\'s published Verify-tab code is run as a second check (Step 5), not used as the source. Tests mine position uniformity and serial independence.',
    configs:                CONFIGS.length,
    roundsPerConfig:        ROUNDS_PER_CONFIG,
    totalRounds:            CONFIGS.length * ROUNDS_PER_CONFIG,
    avgTheoreticalRTP:      pass1AvgTheoRTP,
    avgSimulatedRTP:        pass1AvgRTP,
    chi2FailsAtAlpha01:     pass1Chi2Fails,
    chi2FailsBonferroni:    pass1Chi2FailsBon,
    bonferroniAlpha:        bonAlpha,
    serialIndependenceFails: pass1SerialFails,
    convergence:            convergenceData,
    results:                pass1Serializable,
  },
  pass2_casino_seeds: {
    description: 'Revealed casino server seeds from capture dataset. Tests whether casino seed selection produces biased distributions over the epoch window (cherry-picking detection).',
    seeds_tested:                seedEntries.length,
    mine_count:                  PASS2_MINE_COUNT,
    theoretical_win_chance:      theoWinPass2,
    nonces_per_seed:             NONCES_PER_SEED,
    epoch_length:                EPOCH_LENGTH,
    test_a_chi2_fails_at_alpha01: testAFails,
    test_a_binomial_pValue:       testAPValue,
    test_a_verdict:               testAVerdict,
    test_b_cherry_pick_flags:     cherryPickFlags,
    test_b_binomial_pValue:       cherryPValue,
    test_b_verdict:               cherryVerdict,
    test_c_flags:                 pass2Results.filter(r => r.testC_flag).length,
    results:                      pass2Results,
  },
};

fs.writeFileSync(path.join(OUTPUTS_DIR, 'simulation-results.json'), JSON.stringify(output, null, 2));

// ══════════════════════════════════════════════════════════════════════════════
//  RTP Convergence Chart (self-contained HTML)
// ══════════════════════════════════════════════════════════════════════════════

const finalPoint = convergenceData[convergenceData.length - 1];
const finalRTP   = finalPoint.meanRTP;

// Chart.js is inlined verbatim from the npm package pinned in package-lock.json (devDependency
// chart.js 4.4.7), not loaded from a CDN: the chart is pinned evidence, and a page that fetches its
// library from a third party renders only while that third party serves the same bytes (Mike's
// review 2026-09-28, F16).
const CHARTJS_VERSION = '4.4.7';
const CHARTJS_SOURCE = fs.readFileSync(path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js'), 'utf8');

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL.COM MINES RTP CONVERGENCE \u2014 ${CONFIGS.length} CONFIGS x 1M ROUNDS EACH</title>
<!-- Chart.js ${CHARTJS_VERSION} dist/chart.umd.js inlined verbatim from the npm package pinned in package-lock.json -->
<script>${CHARTJS_SOURCE}<\/script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fafafa; padding: 24px; }
  .container { max-width: 1100px; margin: 0 auto; background: #fff; border-radius: 12px; border: 1px solid #e0e0e0; padding: 32px; }
  h1 { text-align: center; font-size: 16px; font-weight: 600; color: #333; letter-spacing: 1.5px; text-transform: uppercase; margin-bottom: 24px; }
  .chart-wrap { position: relative; height: 420px; }
  .final-box { display: inline-block; border: 2px solid #4caf50; border-radius: 8px; padding: 10px 20px; margin-top: 20px; }
  .final-box .label { font-size: 13px; color: #666; }
  .final-box .value { font-size: 22px; font-weight: 700; color: #2e7d32; }
  .final-box .check { color: #4caf50; font-size: 18px; }
  .legend { text-align: center; margin-top: 12px; font-size: 13px; color: #666; }
  .legend span { margin: 0 12px; }
  .legend .dot { display: inline-block; width: 12px; height: 3px; vertical-align: middle; margin-right: 4px; }
</style>
</head>
<body>
<div class="container">
  <h1>DUEL.COM MINES RTP CONVERGENCE \u2014 ${CONFIGS.length} CONFIGS x 1M ROUNDS EACH</h1>
  <div class="chart-wrap"><canvas id="chart"></canvas></div>
  <div class="legend">
    <span><span class="dot" style="background:#1565c0;height:3px"></span> Mean RTP (${CONFIGS.length} configs)</span>
    <span><span class="dot" style="background:rgba(229,115,115,0.5);height:3px"></span> ±2 SE</span>
    <span><span class="dot" style="background:#e57373;border-top:2px dashed #e57373;height:0"></span> Theoretical (${(THEORETICAL_RTP * 100).toFixed(1)}%)</span>
    <span style="background:rgba(229,115,115,0.08);padding:2px 8px;border-radius:3px">±2 SE band (standard error of mean)</span>
  </div>
  <div style="text-align:right; margin-top:8px;">
    <div class="final-box">
      <span class="label">Final Mean RTP:</span>
      <span class="value">${(finalRTP * 100).toFixed(3)}%</span>
      <span class="check">&#10003;</span>
    </div>
  </div>
</div>
<script>
const data = ${JSON.stringify(convergenceData.map(d => ({
  x: d.roundsPerConfig,
  y: d.meanRTP * 100,
  sd: d.stdDev * 100,
  label: d.label,
})))};

const theoretical = ${(THEORETICAL_RTP * 100).toFixed(6)};
const labels = data.map(d => d.label);

const ctx = document.getElementById('chart').getContext('2d');
new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      {
        label: 'Upper band',
        data: data.map(d => d.y + d.sd * 2),
        borderColor: 'transparent',
        backgroundColor: 'rgba(229,115,115,0.08)',
        fill: '+1',
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: 'Lower band',
        data: data.map(d => d.y - d.sd * 2),
        borderColor: 'transparent',
        backgroundColor: 'rgba(229,115,115,0.08)',
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: '±2 SE (upper)',
        data: data.map(d => d.y + d.sd),
        borderColor: 'rgba(229,115,115,0.4)',
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: '±2 SE (lower)',
        data: data.map(d => d.y - d.sd),
        borderColor: 'rgba(229,115,115,0.4)',
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: 'Theoretical (' + theoretical.toFixed(1) + '%)',
        data: data.map(() => theoretical),
        borderColor: '#e57373',
        borderWidth: 2,
        borderDash: [8, 4],
        fill: false,
        pointRadius: 0,
      },
      {
        label: 'Mean RTP',
        data: data.map(d => d.y),
        borderColor: '#1565c0',
        borderWidth: 2.5,
        fill: false,
        pointRadius: 0,
        pointHoverRadius: 6,
        pointHoverBackgroundColor: '#1565c0',
        tension: 0.3,
      },
      {
        label: 'Final',
        data: data.map((d, i) => i === data.length - 1 ? d.y : null),
        borderColor: '#1565c0',
        backgroundColor: '#1565c0',
        pointRadius: 6,
        pointHoverRadius: 8,
        showLine: false,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items) => data[items[0].dataIndex].label + ' rounds/config',
          label: (item) => {
            if (item.datasetIndex === 5) return 'Mean RTP: ' + item.parsed.y.toFixed(4) + '%';
            if (item.datasetIndex === 4) return 'Theoretical: ' + theoretical.toFixed(4) + '%';
            return null;
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: 'Rounds per Config', font: { size: 12 } },
        ticks: { maxTicksLimit: 10 },
      },
      y: {
        title: { display: false },
        ticks: { callback: v => v.toFixed(1) + '%' },
      },
    },
  },
});
<\/script>
</body>
</html>`;

fs.writeFileSync(path.join(OUTPUTS_DIR, 'rtp-convergence.html'), chartHTML);

console.log('\u2550'.repeat(60));
console.log(`  Written: ${WROTE_TO}/simulation-results.json`);
console.log(`  Written: ${WROTE_TO}/rtp-convergence.html`);
if (!PF_EMIT) console.log('  Committed artifacts NOT modified (set PF_EMIT=1 to regenerate them).');
console.log('\u2550'.repeat(60) + '\n');
