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
 */

import * as fs   from 'fs';
import * as path from 'path';

import { computeMinePositionsFromBuffer, theoreticalMultiplier, winChance } from './rng';
import { chiSquaredTest, lag1Autocorrelation, runsTest }                    from './stats';
import { loadDataset, buildSeedMap }                                         from './loader';

// ── Constants ────────────────────────────────────────────────────────────────

const GRID_SIZE           = 25;
const CONFIGS             = Array.from({ length: 24 }, (_, i) => i + 1); // mine counts 1-24
const ROUNDS_PER_CONFIG   = 1_000_000;
const NONCES_PER_SEED     = 10_000;
const EPOCH_LENGTH        = 50;
const THEORETICAL_RTP     = 0.999; // 99.9% — uniform 0.1% house edge
const CONVERGENCE_SAMPLES = [1_000, 5_000, 10_000, 50_000, 100_000, 500_000, 1_000_000];

// Representative mine count for Pass 2 — 3 mines gives ~88% win chance,
// yielding ~8,800 wins in 10K nonces (well above chi-squared minimum).
const PASS2_MINE_COUNT = 3;

// ── Pinned simulation seeds — one unique pair per config (24 total) ─────────
// Generated once via crypto.randomBytes(32) / crypto.randomBytes(16).
// Each config gets its own HMAC stream to avoid cross-config correlation.
const SIM_SEEDS: Array<{ server: string; client: string }> = [
  { server: 'e33ac56577654adb77e9ed4cad54142bb99f12a85b93ac4b473ec687631d584a', client: '857902ce8e141aff4bd073ede94cc708' },
  { server: 'e2a6b8999929cb7a99313e7e8030c77913f656bdcd8b13e4138a7d83732f1018', client: '788fd3d35a196357da74e1f89a82bbaf' },
  { server: 'e7fd02dd9662ad142310ab99a02ba70692d2a38b1024ccbbe9001d6633f01f45', client: '29cbc576e54475c5b5f835103da9bda4' },
  { server: '3dda4af8d5357e02c72cd519b926edda4dfc778d6bdca163da3041b0b3889bf9', client: '0c013271e4ef52b6b1a2b438b92a1bb2' },
  { server: 'ba25a980d1864a79fa48e6e0cca024b98c2fb7ae65b3121f5ee9711d256e0604', client: '0ddab1966a7665cc748b5549ed64f25b' },
  { server: '209c5e731a54a9a965878470734413c125565fc3c293ebb044817a2b54693169', client: '1d4e7e5c727a7cf3c5d6f8953acf84fd' },
  { server: '83942545c1955c65e006a5de832a91ee03b836f8a5abb2f288a008fe28861286', client: 'bf9683faf3a5402d7892bf54fa580eb1' },
  { server: '7841a0bb58560a06041bedf515a583ea2f0bdc727355cadf8c9a1a3c4c91209d', client: '72e614128ed88ec96bf4962cb5dd85f9' },
  { server: '4e5cd18cdab2de5651cf149e5412e9feede36d78ec5039b74906ef1fd0f1e7b8', client: '9e2137ebbef65ed9908c34810dd74670' },
  { server: '7211a77594b9c72c8d0af70ff1373aa67fe1ecb1126b99ba8c09681c9b857703', client: 'd7d5bafe6725fa4b253eee4b0252d40d' },
  { server: '0aff11f1565fd3afded9c92885581349afa3642c7c1dde5f5d916d66e0f7a626', client: '611cf27c8b063d4fa733470ff5d772b4' },
  { server: 'ec9fcbdfe5acd5ef5cfd0bebc9752d655511df8a9b65e1b0a41f42ab973e9c4a', client: '3601e88684f35fb47af89b4fae3b2d52' },
  { server: '24fc9d3cace2b46399bd38b5e7d68c13f8b154be30375e78674a15021b8337eb', client: 'f91e3ee8298ec3b38b031e351661e740' },
  { server: '354773c619131a80bb7512240549ff136baa5156c683effb03e969bc1eca2848', client: 'c5285b4b1d4a29f9affedd61bb432f02' },
  { server: '5483493f63480fd8044f6e5966e72b65b52c1465dfb8f00ace1346c3da1ccf0a', client: '509894e56ad0deab437f42b1cae16d8e' },
  { server: '66088acbe9911b6ff1b47673747ef659ee013e9b8eaad998e6e021c95f10f9d1', client: '464082f7d4fffd0d75afe26d5972c97c' },
  { server: '2803c817a798190e267d6cc48c6bce3e950f9c4bec672e61e895f9b143d2795a', client: '59cfbc0567db630502855832a6b9acfd' },
  { server: '5da951294acab67c7ef0b721a044033e9211b5a23228c8f60862317f3a4362ee', client: 'b1537dbd5aa53e01468f6a7c608c62fd' },
  { server: '94c15866f997286b86aa19af4b7596c77dc33c5e2da362e183f60c38d1963fee', client: 'd377bdeb83e51d33203c2077e1983ebf' },
  { server: '53baf9f6110a4a414ba5412460a75a908773aaa655ac7728307840d8c505d8de', client: '312e44f0ee59d094700a566a63dc121a' },
  { server: '6ca2113b0edb45518f94b56ff662231c032f05bc6ed1b50f51c98cd82468aa2e', client: 'e71f9fafc749aa5c212ef454ec014f8c' },
  { server: '0b04a819aba2d96240f43d5e8e939a428472e9b1edaf7fdce7c37f251734e8e0', client: '68e84344537d466a9252cdf9d08bb9de' },
  { server: '37c937299a80cce0282fc3bb6b67155d3e2cca2844395606509c93cb57004bee', client: '0e4a3fd4d2351361ca27c5a007ac99a7' },
  { server: '6c29a22b66fdf269afaca5f439412c97b28bc5577dd42fdcee896b917e8f7fa4', client: 'd4a1e18a7b78022b97ece31e87b79228' },
];

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

    const roundNum = nonce + 1;
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

  for (let nonce = 0; nonce < NONCES_PER_SEED; nonce++) {
    const mines     = computeMinePositionsFromBuffer(keyBuf, clientSeed, nonce, PASS2_MINE_COUNT);
    const mineSet   = new Set(mines);
    const revealTile = nonce % GRID_SIZE;
    const won       = !mineSet.has(revealTile);

    if (won) {
      if (nonce < EPOCH_LENGTH) earlyWins++;
      else lateWins++;
    }
  }

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

const OUTPUTS_DIR = path.join(__dirname, '..', 'outputs');
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
}));

const output = {
  generatedAt: new Date().toISOString(),
  pass1_fresh_seeds: {
    description: 'Auditor-generated random seeds. Validates independent implementation, mine position uniformity, and serial independence.',
    configs:                CONFIGS.length,
    roundsPerConfig:        ROUNDS_PER_CONFIG,
    totalRounds:            CONFIGS.length * ROUNDS_PER_CONFIG,
    executionTimeMs:        pass1ElapsedMs,
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
    executionTimeMs:              pass2ElapsedMs,
    results:                      pass2Results,
  },
};

fs.writeFileSync(path.join(OUTPUTS_DIR, 'simulation-results.json'), JSON.stringify(output, null, 2));

// ══════════════════════════════════════════════════════════════════════════════
//  RTP Convergence Chart (self-contained HTML)
// ══════════════════════════════════════════════════════════════════════════════

const finalPoint = convergenceData[convergenceData.length - 1];
const finalRTP   = finalPoint.meanRTP;

const chartHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>DUEL.COM MINES RTP CONVERGENCE \u2014 ${CONFIGS.length} CONFIGS x 1M ROUNDS EACH</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"><\/script>
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
console.log('  Written: outputs/simulation-results.json');
console.log('  Written: outputs/rtp-convergence.html');
console.log('\u2550'.repeat(60) + '\n');
