/**
 * VALUE DOMAINS for every numeric leaf of every JSON artifact of record (profile MINES-27).
 *
 * WHY THIS MODULE EXISTS. A SHA-256 pin proves an artifact has not changed since it was pinned;
 * it says nothing about whether the value was ever POSSIBLE. Re-pin a forged artifact — which is
 * exactly what a forger does next — and the pin agrees with it. So every numeric leaf is also held
 * to the domain it physically admits, with every bound taken from CODE (src/loader.ts,
 * src/sim-plan.ts, the grid), never from the artifact being checked: a bound the artifact supplies
 * is a bound a forger sets.
 *
 * REJECT ONLY THE IMPOSSIBLE. A domain encodes
 * physical possibility, not plausibility: nothing here rejects a value for being surprising,
 * extreme, round, or equal to its own expectation. An RTP window can exceed 1, a z-score is any
 * finite real, an expected count is a real.
 *
 * NO SILENT FALLBACK. Every numeric leaf's collapsed path (array indices → []) must match a rule;
 * an UNDECLARED numeric leaf is reported exactly like an impossible one, so adding a numeric field
 * to an artifact without declaring its domain fails step 24 and the unit suite.
 */

import { EXPECTED_BETS, EXPECTED_SEEDS, EXPECTED_PHASE_E_BETS, EXPECTED_PHASE_E_SEEDS, MINE_COUNTS } from './loader';
import { SIM_ROUNDS_PER_CONFIG, SIM_CONFIGS, SIM_NONCES_PER_SEED, SIM_EPOCH_LENGTH } from './sim-plan';

export interface Domain { label: string; ok: (v: number) => boolean }
const D = (label: string, ok: (v: number) => boolean): Domain => ({ label, ok });

const FINITE      = D('a finite number', v => Number.isFinite(v));
const NONNEG      = D('a non-negative real', v => Number.isFinite(v) && v >= 0);
const PROB        = D('a probability in [0,1]', v => Number.isFinite(v) && v >= 0 && v <= 1);
const CORR        = D('a correlation in [-1,1]', v => Number.isFinite(v) && v >= -1 && v <= 1);
const intIn = (lo: number, hi: number, what: string) =>
  D(`an integer in [${lo}, ${hi}] (${what})`, v => Number.isInteger(v) && v >= lo && v <= hi);
const realIn = (lo: number, hi: number, what: string) =>
  D(`a real in [${lo}, ${hi}] (${what})`, v => Number.isFinite(v) && v >= lo && v <= hi);

const ALL_BETS   = EXPECTED_BETS + EXPECTED_PHASE_E_BETS;
const ALL_SEEDS  = EXPECTED_SEEDS + EXPECTED_PHASE_E_SEEDS;
const COUNT_BETS = intIn(0, ALL_BETS, 'bets in both datasets');
const MINE       = intIn(1, MINE_COUNTS, 'mine counts 1..24');
const TILE       = intIn(0, 24, 'tile index 0..24');
/** A with- or without-edge multiplier: 1 (nothing opened) up to C(25,12) = 5,200,300. */
const MULT       = realIn(1, 5_200_300, 'multiplier ladder range');
/** A simulated or window RTP is a mean of multipliers: [0, the largest k = 1 multiplier 25]. */
const RTP        = realIn(0, 25, 'mean of k = 1 multipliers');
const ROUNDS     = intIn(0, SIM_ROUNDS_PER_CONFIG, 'rounds per Pass-1 config');

interface Rule { path: RegExp; domain: Domain }

/** First match wins; narrower patterns first. Paths are collapsed: `a.b[3].c` → `.a.b[].c`. */
export const DOMAIN_RULES: Record<string, Rule[]> = {
  'simulation-results.json': [
    { path: /^\.pass1_fresh_seeds\.(configs)$/, domain: intIn(0, SIM_CONFIGS.length, 'Pass-1 configs') },
    { path: /^\.pass1_fresh_seeds\.roundsPerConfig$/, domain: ROUNDS },
    { path: /^\.pass1_fresh_seeds\.totalRounds$/, domain: intIn(0, SIM_ROUNDS_PER_CONFIG * SIM_CONFIGS.length, 'Pass-1 total rounds') },
    { path: /^\.pass1_fresh_seeds\.(avgTheoreticalRTP|avgSimulatedRTP)$/, domain: RTP },
    { path: /^\.pass1_fresh_seeds\.(chi2FailsAtAlpha01|chi2FailsBonferroni|serialIndependenceFails)$/, domain: intIn(0, SIM_CONFIGS.length, 'Pass-1 configs') },
    { path: /^\.pass1_fresh_seeds\.bonferroniAlpha$/, domain: PROB },
    { path: /^\.pass1_fresh_seeds\.convergence\[\]\.roundsPerConfig$/, domain: ROUNDS },
    { path: /^\.pass1_fresh_seeds\.convergence\[\]\.meanRTP$/, domain: RTP },
    { path: /^\.pass1_fresh_seeds\.convergence\[\]\.stdDev$/, domain: NONNEG },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.mineCount$/, domain: MINE },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.(theoreticalRTP|simulatedRTP)$/, domain: RTP },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.(winRate|theoreticalWin|positionPValue|runsPValue|positionPValueWR|runsPValueWinLoss)$/, domain: PROB },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.(positionChi2|positionChi2WR)$/, domain: NONNEG },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.(positionDf|positionDfWR)$/, domain: intIn(1, 24, 'degrees of freedom over 25 tiles') },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.r1$/, domain: CORR },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.(r1Z|runsZ|runsZWinLoss)$/, domain: FINITE },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.census\.(rounds|wins|adjacentWinPairs|transitions)$/, domain: ROUNDS },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.census\.(firstOutcome|lastOutcome)$/, domain: intIn(0, 1, 'a win/loss outcome') },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.census\.positionCounts\[\]$/, domain: ROUNDS },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.census\.checkpoint\.(rounds|wins)$/, domain: ROUNDS },
    { path: /^\.pass1_fresh_seeds\.results\[\]\.census\.checkpoint\.positionCounts\[\]$/, domain: ROUNDS },
    { path: /^\.pass2_casino_seeds\.(seeds_tested|test_a_chi2_fails_at_alpha01|test_b_cherry_pick_flags|test_c_flags)$/, domain: intIn(0, EXPECTED_SEEDS, 'revealed primary seeds') },
    { path: /^\.pass2_casino_seeds\.mine_count$/, domain: MINE },
    { path: /^\.pass2_casino_seeds\.(theoretical_win_chance|test_a_binomial_pValue|test_b_binomial_pValue)$/, domain: PROB },
    { path: /^\.pass2_casino_seeds\.nonces_per_seed$/, domain: intIn(0, SIM_NONCES_PER_SEED, 'Pass-2 nonces per seed') },
    { path: /^\.pass2_casino_seeds\.epoch_length$/, domain: intIn(0, SIM_EPOCH_LENGTH, 'epoch length') },
    { path: /^\.pass2_casino_seeds\.results\[\]\.(mineCount|servedConfigs\[\])$/, domain: MINE },
    { path: /^\.pass2_casino_seeds\.results\[\]\.(earlyWins|earlyTotal)$/, domain: intIn(0, SIM_EPOCH_LENGTH, 'epoch length') },
    { path: /^\.pass2_casino_seeds\.results\[\]\.(lateWins|lateTotal)$/, domain: intIn(0, SIM_NONCES_PER_SEED, 'Pass-2 nonces per seed') },
    { path: /^\.pass2_casino_seeds\.results\[\]\.(earlyP|lateP|testC_pValue)$/, domain: PROB },
    { path: /^\.pass2_casino_seeds\.results\[\]\.testC_earlyZ$/, domain: FINITE },
    { path: /^\.pass2_casino_seeds\.results\[\]\.testC_nullRank$/, domain: intIn(0, SIM_NONCES_PER_SEED / SIM_EPOCH_LENGTH - 1, 'later windows per seed') },
  ],
  'determinism-log.json': [
    { path: /^\.(verified|mismatches|skipped)$/, domain: intIn(0, EXPECTED_BETS, 'primary bets') },
  ],
  'chi-squared-results.json': [
    { path: /^\.groups\[\]\.mineCount$/, domain: MINE },
    { path: /^\.groups\[\]\.(wins|total)$/, domain: intIn(0, EXPECTED_BETS, 'primary bets') },
    { path: /^\.groups\[\]\.(theor|pValue)$/, domain: PROB },
  ],
  'payout-coverage.json': [
    { path: /^\.mineCounts$/, domain: intIn(0, MINE_COUNTS, 'mine counts') },
    { path: /^\.minBetsPerMineCount$/, domain: intIn(0, EXPECTED_BETS, 'primary bets') },
    { path: /^\.betsPerMineCount\.\d+$/, domain: intIn(0, EXPECTED_BETS, 'primary bets') },
    { path: /^\.(totalPayoutCells|cellsExercisedByLivePlay|cellsNeverExercised)$/, domain: intIn(0, 300, '(m, k) payout cells') },
    { path: /^\.uncoveredProbabilityShare$/, domain: PROB },
    { path: /^\.uncoveredCells\[\]\.minesCount$/, domain: MINE },
    { path: /^\.uncoveredCells\[\]\.reveals$/, domain: intIn(1, 24, 'safe tiles') },
    { path: /^\.uncoveredCells\[\]\.probabilityOfReaching$/, domain: PROB },
    { path: /^\.uncoveredCells\[\]\.multiplier$/, domain: MULT },
  ],
  // verification-results.json is the run record: its step `data` blocks are keyed by name, so its
  // domains are declared per LEAF KEY below (VERIFICATION_KEY_DOMAINS), every key listed explicitly.
  'verification-results.json': [
    { path: /^\.(totalBets)$/, domain: COUNT_BETS },
    { path: /^\.(totalSeeds)$/, domain: intIn(0, ALL_SEEDS, 'seed records in both datasets') },
    { path: /^\.summary\.(passed|flags|operatorFlags|captureFlags|hardFail)$/, domain: intIn(0, 26, 'scored steps') },
    { path: /^\.steps\[\]\.step$/, domain: intIn(1, 26, 'scored steps') },
  ],
};

const U32 = intIn(0, 2 ** 32, 'a 32-bit window or count');
const INT = D('a non-negative integer (count, index or size)', v => Number.isInteger(v) && v >= 0);
const keys = (names: string, d: Domain): Array<[string, Domain]> => names.trim().split(/\s+/).map(n => [n, d]);

/**
 * Every numeric leaf key that appears in a step's `data` block, with its domain. A key not listed
 * here is UNDECLARED and fails like an impossible value — adding a measurement to a step without
 * deciding what it physically admits is caught by step 24 and the unit suite.
 */
export const VERIFICATION_KEY_DOMAINS: ReadonlyMap<string, Domain> = new Map<string, Domain>([
  ...keys(`alpha bonferroniAlpha broadSevereP testAAlpha nullFlagProbability fractionPicked detectionPower
    minPositionPValue minWinRatePValue firstDrawPValue positionPValueWR runsPValueWinLoss winRatePValue uncoveredProbabilityShare
    testAWinChance targetRTP theoreticalRTP
    broadWindowAlpha broadPerSeedNull broadSeverePerSeedNull broadTailProbability earlyP lateP
    earlyWindow lateWindow perSeed earlyWindowSevere lateWindowSevere perSeedSevere fullWindowTestA
    perSeedTestA perSeedTestB nullTestA nullTestB nullTestC nullBroad nullSevere flagCap failCap
    testAFail testBFlag testBFail testCFail broadFlag broadFail broadSevereFail`, PROB),
  // union bounds over a step's rules: a sum of probabilities, so a bound rather than a probability
  ...keys(`unionBoundFail unionBoundFlagOrFail earlyExpected lateExpected`, NONNEG),
  ...keys(`r1Z runsZWinLoss minEarlyZ maxEarlyZ`, FINITE),
  ...keys(`adapterRelTol moneyRelTol multRelTol atol rtol deviationBound ceiling maxDeviation worstRelativeDeviation
    worstAdapterRelativeDeviation worstCrossCheckGap worstUncorrectedBias worstUncorrectedRelativeBias
    uncorrectedRelativeBias bias worstBias worstRelativeBias expectedRejectedChunks expected expectedCollisions
    collisionBound bound testABound testAExpected positionChi2WR winRateChi2 firstDrawChi2 lagSeconds commitmentLeadSeconds
    minCommitmentLeadSeconds`, NONNEG),
  ...keys(`simulatedRTP avgSimulatedRTP`, RTP),
  ...keys(`ladderMax ladderMin`, MULT),
  ...keys(`acceptedWindow maxFair rangesAccepted subsetsEnumerated totalRounds`, U32),
  ...keys(`mineCount phaseEMineCounts`, MINE),
  ...keys(`tilesRevealed`, TILE),
  ...keys(`range`, intIn(2, 25, 'shuffle ranges 2..25')),
  ...keys(`kValues phaseEDepths maxK worstK`, intIn(1, 24, 'reveal depth')),
  ...keys(`1 2 3 4 5 22 24 A B C D E1 E2 E3 E4 E5`, COUNT_BETS),
  ...keys(`adapterErrors anchorErrors artifactsPinned betBearingEpochs bets betsChecked betsTested betsWithRevealSteps
    bindFailures broadFlags broadSevere bustsChecked captureFlagDisagreements captureFlags captureOriginGaps
    cashOutsChecked cells cellsAboveBaseTier cellsExercisedByLivePlay cellsNeverExercised chainLinksChecked chainLinksOk changed
    cherryPickFlags chi2FailsPearsonUncorrected chi2FailsWithoutReplacement chunksRead collisions configs
    corruptedFormulaRejectedOnCells crossCheckDisagreements cursorAdvances declaredCaptureRetryGaps depthChecked
    disagreements distinctClientSeeds domainLeavesChecked domainProblems draws duplicateNonces
    earlyWindowReplayFailures emptyEpochs epochSize epochs epochsWithGaps errors exactRtpErrors expectedBets
    expectedCashOuts expectedCells expectedChainLinks expectedDisclosures expectedDraws expectedE5Bets
    expectedEpochs expectedNonAscendingOrders expectedPhaseEEpochs expectedRevealSteps expectedSeeds expectedSize
    expectedTested failThreshold failing firstPickTilesSpanned flagThreshold flags gapsMalformed
    gapsUnrecomputable gapsWellFormed groups hardFail isolatedEarly layoutErrors layoutsRecomputed
    leanestMineCountBets legacyRunsVacuousConfigs matched maxSize minBetsPerMineCount minSize minWins mineCounts
    mineCountsCovered mineCountsExpected mineStepsChecked mismatches missedNonces missingMultipliers
    nonAscendingOrders nonceBase offEpochs operatorFlags operatorGaps orphanBets pairsInK pairsInM passed
    perStepIsMineErrors phaseAOffPlan phaseAPerMineCount phaseBoundaryBoundToCommitment phaseBoundaryReveals
    phaseBoundarySkips phaseCBets phaseDBets phaseEBets phaseEEpochs phaseELosses phaseEOffPlan phaseERecords
    phaseESeeds phaseESubPhasesOffPlan phaseEWinsDepth1 predicateProbeFailures prefixErrors primaryLosses
    primaryWins recomputed rejectedChunks rejectedValues remainder revealStepsChecked rotationRecords
    roundsChecked roundsPerConfig rowDisagreements samplePerEpoch seedIndex seedRecords seeds seedsTested
    serialFailsBonferroni servedChecked servedOutside skipped testAFails testAFailsSimulatorScalar
    testBRecomputedFlags testBRowDisagreements firstDrawBets totalPayoutCells unrevealed verified violations windowsPerSeed
    winningBets wins worstMineCount siteVerifierRounds siteVerifierExpectedRounds siteVerifierMismatches
    siteVerifierUnrecomputable capKeysScanned capServedChecked servedAboveCap cellsAboveCap
    liveSiteRounds liveSiteExpectedRounds liveSiteMismatches liveSiteStandInModules pageModule
    bytes lines rounds expectedRounds disagreeWithRng disagreeWithServed
    broadFlagAt broadFailAt`, INT),
  ...keys(`earlyWins earlyTotal`, intIn(0, SIM_EPOCH_LENGTH, 'epoch length')),
  ...keys(`lateWins lateTotal`, intIn(0, SIM_NONCES_PER_SEED, 'Pass-2 nonces per seed')),
]);

/** Collapse `.a.b[3].c` to `.a.b[].c`. */
export const collapse = (p: string): string => p.replace(/\[\d+\]/g, '[]');

export function numericLeaves(value: unknown, prefix = '', out: Array<[string, number]> = []): Array<[string, number]> {
  if (typeof value === 'number') { out.push([prefix, value]); return out; }
  if (value && typeof value === 'object') {
    if (Array.isArray(value)) value.forEach((v, i) => numericLeaves(v, `${prefix}[${i}]`, out));
    else for (const k of Object.keys(value)) numericLeaves((value as Record<string, unknown>)[k], `${prefix}.${k}`, out);
  }
  return out;
}

export interface DomainReport { checked: number; violations: string[]; uncovered: string[] }

/** Check every numeric leaf of one artifact. Unknown artifact → every leaf is uncovered. */
export function validateDomains(file: string, value: unknown): DomainReport {
  const rules = DOMAIN_RULES[file] ?? [];
  const violations: string[] = [];
  const uncovered = new Set<string>();
  const leaves = numericLeaves(value);
  for (const [p, v] of leaves) {
    const c = collapse(p);
    let domain = rules.find(r => r.path.test(c))?.domain;
    if (!domain && file === 'verification-results.json' && c.startsWith('.steps[].data.')) {
      domain = VERIFICATION_KEY_DOMAINS.get(c.split('.').pop()!.replace(/\[\]$/, ''));
    }
    if (!domain) { uncovered.add(c); continue; }
    if (!domain.ok(v)) violations.push(`${file} ${p} = ${v} is not ${domain.label}`);
  }
  return { checked: leaves.length, violations, uncovered: [...uncovered] };
}
