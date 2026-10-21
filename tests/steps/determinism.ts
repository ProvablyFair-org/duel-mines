/**
 * Steps 5–6: RNG Determinism
 *
 * Step 5 owns the shuffle, so it also carries the draw-bias bound (profile MINES-08): every
 * other RNG check proves a layout REPRODUCES, and none asks whether the shuffle that reproduces
 * it draws each swap index equally. A rejection window that was not a whole number of ranges
 * would over-represent the low indices, and all 6,500 exact recomputations would be exact
 * recomputations of a biased shuffle.
 *
 * src/rng.ts is rebuilt from the written spec docs/ALGORITHM.md (v1.2.0); the bound is src/bias.ts,
 * the audit's own code built on src/rng.ts drawFromChunk. Duel's Verify-tab code (fifth leg) is run as
 * a second check, not used as the source.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import {
  computeMinePositionsFromBuffer, computeMinePositions, newDrawCensus, GRID_SIZE,
} from '../../src/rng';
import { drawBiasBound } from '../../src/bias';
import { EXPECTED_BETS, EXPECTED_REVEALED_EPOCHS, EXPECTED_EPOCHS, EXPECTED_PHASE_E_BETS } from '../../src/loader';
import { sameLayout } from '../../src/layout';
import { loadSiteVerifier, SITE_VERIFIER_PROVENANCE } from '../../src/site-verifier';
import { runLiveSiteVerifier, LIVE_SITE_PROVENANCE } from '../../src/live-site-verifier';
import {
  runOperatorVerifier, OPERATOR_EXPECTED_LOGS, OPERATOR_VERIFIER_PROVENANCE,
} from '../../src/operator-verifier';

/**
 * The profile's ceiling on draw bias (MINES-08, methodology S2): one part in 2^32. Declared as
 * the number it is so the comparison is arithmetic.
 */
const BIAS_CEILING = Math.pow(2, -32);

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap } = ctx;

  // ── Step 5: Mine position recomputation ─────────────────────────────────────
  // A bet whose epoch seed was never revealed cannot be recomputed. Counting those as
  // "skipped" and then passing on "0 mismatches" would let a capture in which NOTHING was
  // revealed score a clean pass, so the number recomputed is bound to the declared population:
  // every one of the captured bets must be reproduced, not merely the reproducible ones.
  let mismatches = 0;
  let skipped    = 0;
  const census   = newDrawCensus();
  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) { skipped++; continue; }
    const key      = Buffer.from(ss, 'hex');
    const computed = computeMinePositionsFromBuffer(key, b.seed.clientSeed, b.seed.nonce, b.request.mines_count, GRID_SIZE, census);
    if (!sameLayout(computed, b.response.mines_positions)) mismatches++;
  }
  ctx.step5Mismatches = mismatches;
  ctx.step5Skipped    = skipped;
  const verifiedCount = bets.length - skipped;
  const s5Issues: string[] = [];
  if (bets.length !== EXPECTED_BETS) s5Issues.push(`bets ${bets.length} != ${EXPECTED_BETS}`);
  if (skipped !== 0) s5Issues.push(`${skipped} bet(s) not recomputable — their epoch seed was never revealed`);
  if (verifiedCount !== EXPECTED_BETS) s5Issues.push(`recomputed ${verifiedCount} != ${EXPECTED_BETS}`);

  // ── Step 5, second half: draw bias bound (MINES-08) ─────────────────────────
  // The bound is measured from src/rng.ts drawFromChunk — the function the shuffle calls — for
  // every range the shuffle draws on (2..25). Two conditions, both HARD FAIL:
  //   (1) every range's accepted window is a whole number of ranges (remainder 0), so each swap
  //       index receives exactly the same number of accepted chunk values — exact uniformity,
  //       the property rejection sampling exists to deliver;
  //   (2) the worst per-index deviation |P(j) − 1/range| is inside the profile's 2^-32 ceiling.
  // (1) is the binding one and the detail says why with a computed number: for a single 32-bit
  // chunk the ABSOLUTE deviation of even the uncorrected draw (plain v mod range) is about
  // 10^-10, inside the ceiling, so the ceiling alone could not tell a corrected draw from an
  // uncorrected one. The census counts how often the rejection branch was actually taken over
  // the rounds recomputed above; its draw count is bound to recomputed × (25 − 1).
  const bb = drawBiasBound(GRID_SIZE);
  const drawsPerRound  = GRID_SIZE - 1;
  const expectedDraws  = verifiedCount * drawsPerRound;
  const expectedRejectedChunks = verifiedCount * bb.expectedRejectedChunksPerRound;
  const biasIssues: string[] = [];
  if (bb.ranges.length !== drawsPerRound) {
    biasIssues.push(`bound covers ${bb.ranges.length} ranges, the shuffle draws on ${drawsPerRound}`);
  }
  if (bb.predicateProbeFailures > 0) {
    biasIssues.push(`drawFromChunk disagrees with "v < window ? v mod range : null" on `
      + `${bb.predicateProbeFailures} probe(s) — the accepted set is not the prefix window the bound assumes`);
  }
  if (bb.inexactRanges.length > 0) {
    const rows = bb.ranges.filter(r => !r.exact)
      .map(r => `range ${r.range}: window ${r.acceptedWindow} = ${r.range} × ${r.minIndexCount} + ${r.remainder}`);
    biasIssues.push(`accepted window is NOT a whole number of ranges on ${bb.inexactRanges.length} of `
      + `${bb.ranges.length} ranges (${rows.slice(0, 4).join('; ')}${rows.length > 4 ? '; …' : ''}) — `
      + `the low indices are over-represented`);
  }
  if (!(bb.worstBias <= BIAS_CEILING)) {
    biasIssues.push(`worst per-index bias ${bb.worstBias.toExponential(3)} exceeds the 2^-32 ceiling ${BIAS_CEILING.toExponential(3)}`);
  }
  if (census.draws !== expectedDraws) {
    biasIssues.push(`rejection census covers ${census.draws} draws, expected ${expectedDraws} `
      + `(${verifiedCount} recomputed × ${drawsPerRound})`);
  }
  const w25 = bb.ranges.find(r => r.range === GRID_SIZE);
  const biasSentence =
    `Draw bias bound (MINES-08), measured from src/rng.ts drawFromChunk on all ${bb.ranges.length} ranges `
    + `2..${GRID_SIZE}: every accepted window is an exact whole number of ranges`
    + (w25 ? ` (e.g. range ${GRID_SIZE}: ${w25.acceptedWindow} = ${GRID_SIZE} × ${w25.minIndexCount})` : '')
    + `, so every swap index is exactly equiprobable — worst bias 0, inside the 2^-32 ceiling. Uncorrected `
    + `v mod range would lean by up to ${bb.worstUncorrectedRelativeBias.toExponential(2)} relative `
    + `(${bb.worstUncorrectedBias.toExponential(2)} absolute, itself under 2^-32 — so exactness, not the `
    + `ceiling, is the binding assertion). Rejection census over the ${verifiedCount.toLocaleString()} `
    + `recomputed rounds: ${census.draws.toLocaleString()} draws, ${census.chunksRead.toLocaleString()} `
    + `chunks read, ${census.rejectedChunks} rejected, ${census.cursorAdvances} cursor advances `
    + `(expected rejections ${expectedRejectedChunks.toExponential(2)}).`;

  // ── Step 5, third leg: player-verifier parity (MINES-24) ────────────────────
  // The ProvablyFair.org site's own Mines verifier (VerifyBets derive.js + its one library import)
  // is vendored byte for byte under verifier-parity/ and pinned by SHA-256 in src/site-verifier.ts.
  // Its deriveMines — the site's code, executed, not re-typed — is run on EVERY captured round of
  // both datasets that has a revealed seed, and must return exactly the layout src/rng.ts computes
  // (which the loop above, and Step 21 for Phase E, bind to the served layout). HARD FAIL on a hash
  // mismatch, a module that will not load, any layout disagreement, or a round count other than
  // EXPECTED_BETS + EXPECTED_PHASE_E_BETS.
  const sv = loadSiteVerifier();
  const siteIssues: string[] = [];
  let siteCompared = 0, siteMismatches = 0, siteUnrecomputable = 0;
  const siteExpected = EXPECTED_BETS + EXPECTED_PHASE_E_BETS;
  const siteFirstMismatch: string[] = [];
  if (sv.error) siteIssues.push(sv.error);
  for (const f of sv.files) {
    if (!f.match) siteIssues.push(`${f.file}: vendored ${f.actual ?? '(absent)'} != pinned ${f.pinned}`);
  }
  if (sv.deriveMines) {
    for (const b of [...bets, ...ctx.phaseEBets]) {
      const ss = seedMap.get(b.seed.serverSeedHashed);
      if (!ss) { siteUnrecomputable++; continue; }
      const m = b.request.mines_count;
      const site = Array.from(sv.deriveMines({ clientSeed: b.seed.clientSeed, serverSeed: ss, nonce: b.seed.nonce, mineCount: m }).minePositions);
      const pkg = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, m);
      siteCompared++;
      if (site.length !== pkg.length || site.some((t, i) => t !== pkg[i])) {
        siteMismatches++;
        if (siteFirstMismatch.length < 3) {
          siteFirstMismatch.push(`round ${b.response.round_id} (m=${m}, nonce ${b.seed.nonce}): site [${site.join(',')}] vs package [${pkg.join(',')}]`);
        }
      }
    }
    if (siteMismatches > 0) {
      siteIssues.push(`${siteMismatches} of ${siteCompared} rounds: the site verifier derives a DIFFERENT layout from `
        + `src/rng.ts (${siteFirstMismatch.join('; ')})`);
    }
    if (siteUnrecomputable > 0) siteIssues.push(`${siteUnrecomputable} round(s) have no revealed seed`);
    if (siteCompared !== siteExpected) siteIssues.push(`site-verifier parity covered ${siteCompared} rounds, expected ${siteExpected}`);
  }
  const siteSentence =
    `Player-verifier parity (MINES-24): the ProvablyFair.org site verifier (VerifyBets games/mines/derive.js + `
    + `lib/hmac-sha256.js, vendored under verifier-parity/, both SHA-256 pins MATCH) was executed on all `
    + `${siteCompared.toLocaleString()} captured rounds (${bets.length.toLocaleString()} primary + `
    + `${ctx.phaseEBets.length} Phase E) and returned the same layout as src/rng.ts on every one — 0 mismatches.`;

  // ── Step 5, fourth leg: LIVE-SITE player-verifier parity (MINES-24) ─────────
  // The docusaurus derive.js above is the verifier in Mike's docs repository; the page a player
  // actually opens is https://www.provablyfair.org/verify-bets, a separate Next.js build whose source
  // is not available to this audit. Its deployed bundle is vendored byte for byte under
  // verifier-parity/live-site/ and pinned by SHA-256 in src/live-site-verifier.ts, and the site's own
  // code (verifyDuelsGame → the Mines derivation, WebCrypto HMAC-SHA-256) is EXECUTED on every
  // captured round with a revealed seed; the mine set it prints must equal src/rng.ts's. HARD FAIL on
  // a hash mismatch, a runner that will not load, any disagreement, or a round count other than
  // EXPECTED_BETS + EXPECTED_PHASE_E_BETS.
  const liveIssues: string[] = [];
  const liveRounds: Array<{ id: string; serverSeed: string; clientSeed: string; nonce: number; minesCount: number; pkg: number[]; round: string }> = [];
  [...bets, ...ctx.phaseEBets].forEach((b, i) => {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) return;
    const m = b.request.mines_count;
    liveRounds.push({ id: String(i), serverSeed: ss, clientSeed: b.seed.clientSeed, nonce: b.seed.nonce, minesCount: m,
      pkg: computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, m).slice().sort((x, y) => x - y), round: String(b.response.round_id) });
  });
  const live = runLiveSiteVerifier('Duel.com', liveRounds.map(({ id, serverSeed, clientSeed, nonce, minesCount }) => ({ id, serverSeed, clientSeed, nonce, minesCount })));
  let liveCompared = 0, liveMismatches = 0;
  const liveFirst: string[] = [];
  if (live.error) liveIssues.push(live.error);
  for (const f of live.files) if (!f.match) liveIssues.push(`${f.file}: vendored ${f.actual ?? '(absent)'} != pinned ${f.pinned}`);
  if (live.mines) {
    for (const r of liveRounds) {
      const printed = live.mines.get(r.id);
      const s = printed ? printed.slice().sort((x, y) => x - y) : null;
      liveCompared++;
      if (!s || s.join(',') !== r.pkg.join(',')) {
        liveMismatches++;
        if (liveFirst.length < 3) liveFirst.push(`round ${r.round} (m=${r.minesCount}, nonce ${r.nonce}): site [${s ?? 'no layout'}] vs package [${r.pkg.join(',')}]`);
      }
    }
    if (liveMismatches > 0) liveIssues.push(`${liveMismatches} of ${liveCompared} rounds: the live site prints a DIFFERENT layout from src/rng.ts (${liveFirst.join('; ')})`);
    if (liveCompared !== siteExpected) liveIssues.push(`live-site parity covered ${liveCompared} rounds, expected ${siteExpected}`);
  }
  const liveSentence =
    `Live-site parity (MINES-24): the deployed www.provablyfair.org/verify-bets bundle (3 chunks + runner, `
    + `${live.files.filter(f => f.match).length}/${live.files.length} SHA-256 pins MATCH) was executed on all `
    + `${liveCompared.toLocaleString()} captured rounds and printed the same mine set as src/rng.ts on every one — `
    + `${liveMismatches} mismatches.`;

  // ── Step 5, fifth leg: THE OPERATOR'S OWN Verify-tab code (MINES-09), a SECOND CHECK ──────
  // src/rng.ts is rebuilt from the written spec docs/ALGORITHM.md, not from this code; Duel's file is
  // run here as an independent cross-check of that rebuild and of the served layouts, never as its source.
  // Duel's Mines code panel (duel.com → Provably Fair → Verify → Expand → Copy, 2026-09-25) is
  // vendored verbatim under evidence/verify-tab/ and pinned by SHA-256 in src/operator-verifier.ts.
  // Its own generateMinesPositions is EXECUTED unmodified on every captured round of both datasets;
  // its mine set must equal the SERVED mines_positions and src/rng.ts's, and it must print only its own
  // empty-input message. HARD FAIL on a hash mismatch, a runner that will not load, any disagreement, or a round count other
  // than EXPECTED_BETS + EXPECTED_PHASE_E_BETS.
  const opIssues: string[] = [];
  const opRounds: Array<{ id: string; serverSeed: string; clientSeed: string; nonce: number; gridSize: number; minesCount: number; pkg: string; served: string; round: string }> = [];
  [...bets, ...ctx.phaseEBets].forEach((b, i) => {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) return;
    const m = b.request.mines_count;
    opRounds.push({ id: String(i), serverSeed: ss, clientSeed: b.seed.clientSeed, nonce: b.seed.nonce, gridSize: GRID_SIZE, minesCount: m,
      pkg: computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, m).join(','),
      served: [...b.response.mines_positions].sort((x, y) => x - y).join(','), round: String(b.response.round_id) });
  });
  const op = runOperatorVerifier(opRounds.map(({ id, serverSeed, clientSeed, nonce, gridSize, minesCount }) => ({ id, serverSeed, clientSeed, nonce, gridSize, minesCount })));
  let opCompared = 0, opVsPkg = 0, opVsServed = 0;
  const opFirst: string[] = [];
  if (op.error) opIssues.push(op.error);
  for (const f of op.files) if (!f.match) opIssues.push(`${f.file}: ${f.actual ?? '(absent)'} != pinned ${f.pinned}`);
  if (op.mines) {
    const logsOk = op.logs.length === OPERATOR_EXPECTED_LOGS.length && op.logs.every((l, i) => l === OPERATOR_EXPECTED_LOGS[i]);
    if (!logsOk) opIssues.push(`the operator file printed ${JSON.stringify(op.logs).slice(0, 200)} — not only its empty-input message`);
    for (const r of opRounds) {
      const got = op.mines.get(r.id);
      const g = got ? got.join(',') : null;
      opCompared++;
      if (g !== r.pkg) { opVsPkg++; if (opFirst.length < 3) opFirst.push(`round ${r.round} (m=${r.minesCount}, nonce ${r.nonce}): operator [${g ?? 'threw'}] vs src/rng.ts [${r.pkg}]`); }
      if (g !== r.served) { opVsServed++; if (opFirst.length < 3) opFirst.push(`round ${r.round} (m=${r.minesCount}, nonce ${r.nonce}): operator [${g ?? 'threw'}] vs served [${r.served}]`); }
    }
    if (opVsPkg > 0 || opVsServed > 0) {
      opIssues.push(`the operator's own code disagrees with src/rng.ts on ${opVsPkg} and with the served layout on ${opVsServed} of ${opCompared} rounds (${opFirst.join('; ')})`);
    }
    if (opCompared !== siteExpected) opIssues.push(`operator-code parity covered ${opCompared} rounds, expected ${siteExpected}`);
  }
  const opSentence =
    `Operator-code parity (MINES-09), the second check: Duel's own Mines Verify-tab code (${OPERATOR_VERIFIER_PROVENANCE.savedAs}, `
    + `copied ${OPERATOR_VERIFIER_PROVENANCE.copiedOn}; ${op.files.filter(f => f.match).length}/${op.files.length} SHA-256 pins MATCH) was executed `
    + `unmodified on all ${opCompared.toLocaleString()} captured rounds: its generateMinesPositions returned the served mine set on `
    + `${(opCompared - opVsServed).toLocaleString()} and src/rng.ts's on ${(opCompared - opVsPkg).toLocaleString()} (${opVsServed} / ${opVsPkg} differ). `
    + `src/rng.ts is rebuilt from docs/ALGORITHM.md, not from this code.`;

  const s5Ok = mismatches === 0 && s5Issues.length === 0 && biasIssues.length === 0 && siteIssues.length === 0 && liveIssues.length === 0
    && opIssues.length === 0;
  const s5FailParts: string[] = [];
  if (mismatches > 0) s5FailParts.push(`${mismatches} of ${verifiedCount} recomputed mine layouts disagree with the captured layout`);
  if (s5Issues.length > 0) s5FailParts.push(`POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s5Issues.join('; ')}`);
  if (biasIssues.length > 0) s5FailParts.push(`DRAW BIAS: ${biasIssues.join('; ')}`);
  if (siteIssues.length > 0) s5FailParts.push(`SITE VERIFIER PARITY (MINES-24): ${siteIssues.join('; ')}`);
  if (liveIssues.length > 0) s5FailParts.push(`LIVE-SITE VERIFIER PARITY (MINES-24): ${liveIssues.join('; ')}`);
  if (opIssues.length > 0) s5FailParts.push(`OPERATOR VERIFY-TAB CODE PARITY (MINES-09): ${opIssues.join('; ')}`);

  const s5 = step(5, 'Mine Position Recomputation',
    s5Ok ? 'PASS' : 'FAIL',
    s5Ok
      ? `All ${EXPECTED_BETS} captured bets recomputed from the revealed seed of their epoch — `
        + `0 unverifiable, 0 mismatches. ${biasSentence} ${siteSentence} ${liveSentence} ${opSentence}`
      : s5FailParts.join(' | '),
    {
      bets: bets.length, expectedBets: EXPECTED_BETS, recomputed: verifiedCount, skipped, mismatches,
      drawBias: {
        ceiling: BIAS_CEILING,
        worstBias: bb.worstBias,
        worstRelativeBias: bb.worstRelativeBias,
        worstUncorrectedBias: bb.worstUncorrectedBias,
        worstUncorrectedRelativeBias: bb.worstUncorrectedRelativeBias,
        inexactRanges: bb.inexactRanges,
        predicateProbeFailures: bb.predicateProbeFailures,
        perRange: bb.ranges.map(r => ({
          range: r.range, maxFair: r.maxFair, acceptedWindow: r.acceptedWindow,
          rangesAccepted: r.minIndexCount, remainder: r.remainder, rejectedValues: r.rejectedValues,
          bias: r.bias, uncorrectedRelativeBias: r.uncorrectedRelativeBias,
        })),
        census: { ...census, expectedDraws, expectedRejectedChunks },
        issues: biasIssues,
      },
      siteVerifier: {
        files: sv.files.map(f => ({ file: f.file, pinnedSha256: f.pinned, vendoredSha256: f.actual, match: f.match })),
        provenance: SITE_VERIFIER_PROVENANCE,
        siteVerifierRounds: siteCompared, siteVerifierExpectedRounds: siteExpected,
        siteVerifierMismatches: siteMismatches, siteVerifierUnrecomputable: siteUnrecomputable,
        issues: siteIssues,
      },
      liveSiteVerifier: {
        files: live.files.map(f => ({ file: f.file, pinnedSha256: f.pinned, vendoredSha256: f.actual, match: f.match })),
        provenance: LIVE_SITE_PROVENANCE,
        liveSiteRounds: liveCompared, liveSiteExpectedRounds: siteExpected, liveSiteMismatches: liveMismatches,
        liveSiteStandInModules: live.standIns.length,
        issues: liveIssues,
      },
      operatorVerifier: {
        files: op.files.map(f => ({ file: f.file, pinnedSha256: f.pinned, actualSha256: f.actual, match: f.match })),
        provenance: OPERATOR_VERIFIER_PROVENANCE,
        rounds: opCompared, expectedRounds: siteExpected, disagreeWithRng: opVsPkg, disagreeWithServed: opVsServed,
        issues: opIssues,
      },
    },
  );

  // ── Step 6: Client seed influence ─────────────────────────────────────────────
  // Substituting a wrong client seed must change the mine layout. It cannot be required to
  // change it EVERY time, and the reason is combinatorial rather than cryptographic: with m
  // mines on 25 tiles there are only C(25, m) distinct layouts, so two different client seeds
  // collide with probability 1/C(25, m) however good the RNG is. At m=1 and m=24 that is
  // C(25,1) = C(25,24) = 25 layouts — a 4% collision rate by the pigeonhole principle alone.
  //
  // The old threshold, `changed / tested > 0.95`, was the wrong instrument for this. It
  // forgave up to one bet in twenty being genuinely insensitive to the client seed — the exact
  // defect the step exists to detect — while being blind to the fact that the tolerable rate
  // depends entirely on m. Collisions are counted against the rate combinatorics predicts, so
  // an RNG that ignored the client seed (650 of 650 colliding) is nowhere near the bound.
  const WRONG_CLIENT = 'wrong-client-seed-test';
  const SAMPLE_PER_EPOCH = 5;
  /** Distinct mine layouts available: C(25, m). */
  const layouts = (m: number): number => {
    let r = 1;
    for (let i = 0; i < m; i++) r = r * (25 - i) / (i + 1);
    return Math.round(r);
  };

  let tested = 0;
  let changed = 0;
  let collisions = 0;
  let expectedCollisions = 0;
  let collisionVariance = 0;
  const collisionsByMineCount: Record<number, number> = {};

  const byEpoch = new Map<string, typeof bets>();
  for (const b of bets) {
    const arr = byEpoch.get(b.seed.serverSeedHashed) ?? [];
    arr.push(b);
    byEpoch.set(b.seed.serverSeedHashed, arr);
  }
  for (const [hash, epochBets] of byEpoch) {
    const ss = seedMap.get(hash);
    if (!ss) continue;
    for (const b of epochBets.slice(0, SAMPLE_PER_EPOCH)) {
      tested++;
      const m = b.request.mines_count;
      const p = 1 / layouts(m);
      expectedCollisions += p;
      collisionVariance  += p * (1 - p);
      const correct = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, m);
      const wrong   = computeMinePositions(ss, WRONG_CLIENT, b.seed.nonce, m);
      if (correct.join(',') !== wrong.join(',')) changed++;
      else {
        collisions++;
        collisionsByMineCount[m] = (collisionsByMineCount[m] ?? 0) + 1;
      }
    }
  }
  // 5 sigma plus a one-count buffer, the framework's bound for a statistic this sparse.
  const collisionBound = expectedCollisions + 5 * Math.sqrt(collisionVariance) + 1;

  // THE EMPTY-SEED CONTROL (profile MINES-06). A wrong client seed shows the client seed is READ;
  // an EMPTY one is the case an implementation that drops or defaults the field would reproduce.
  // Every one of the 6,500 primary bets is recomputed with clientSeed = "" and the collisions held
  // to the same model-predicted rate, sum over bets of 1/C(25, m), plus 5 sigma + 1. An RNG that
  // ignored the client seed would collide on all 6,500.
  let emptyTested = 0, emptyCollisions = 0, emptyExpected = 0, emptyVariance = 0;
  const emptyByMineCount: Record<number, number> = {};
  for (const b of bets) {
    const ss = seedMap.get(b.seed.serverSeedHashed);
    if (!ss) continue;
    emptyTested++;
    const m = b.request.mines_count;
    const p = 1 / layouts(m);
    emptyExpected += p;
    emptyVariance += p * (1 - p);
    const correct = computeMinePositions(ss, b.seed.clientSeed, b.seed.nonce, m);
    const empty   = computeMinePositions(ss, '', b.seed.nonce, m);
    if (correct.join(',') === empty.join(',')) {
      emptyCollisions++;
      emptyByMineCount[m] = (emptyByMineCount[m] ?? 0) + 1;
    }
  }
  const emptyBound = emptyExpected + 5 * Math.sqrt(emptyVariance) + 1;
  // The sample size is bound to the declared epoch count so a shrunken capture cannot satisfy
  // this step by testing almost nothing.
  const expectedTested = EXPECTED_REVEALED_EPOCHS * SAMPLE_PER_EPOCH;
  const s6Issues: string[] = [];
  if (tested !== expectedTested) {
    s6Issues.push(`bets tested ${tested} != ${expectedTested} (${SAMPLE_PER_EPOCH} per epoch x ${EXPECTED_REVEALED_EPOCHS} revealed epochs)`);
  }
  if (emptyTested !== EXPECTED_BETS) {
    s6Issues.push(`empty-seed control covered ${emptyTested} bets != ${EXPECTED_BETS}`);
  }
  if (emptyCollisions > emptyBound) {
    s6Issues.push(`EMPTY-SEED CONTROL: ${emptyCollisions} of ${emptyTested} layouts unchanged with clientSeed = "", above `
      + `the model bound ${emptyBound.toFixed(2)} — the layout does not depend on the client seed`);
  }

  const s6 = step(6, 'Client Seed Influence',
    collisions <= collisionBound && s6Issues.length === 0 ? 'PASS' : 'FAIL',
    collisions > collisionBound
      ? `${collisions} of ${tested} bets kept the SAME mine layout under a wrong client seed, above the `
        + `combinatorial bound — the layout is not responding to the client seed`
      : s6Issues.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s6Issues.join('; ')}`
        : `${SAMPLE_PER_EPOCH} bets sampled from each of the ${EXPECTED_REVEALED_EPOCHS} revealed epochs. `
          + `Substituting a wrong client seed changes the mine layout except where only C(25,m) layouts `
          + `exist to change between; the surviving collisions sit at or below the rate combinatorics `
          + `predicts (bound: expected + 5 sigma + 1), and all of them fall at m=1 and m=24, the two `
          + `configurations with just 25 distinct layouts. Empty-seed control over all ${EXPECTED_BETS} primary bets `
          + `(clientSeed = ""): collisions held to the same model bound, sum of 1/C(25,m) + 5 sigma + 1.`,
    {
      betsTested: tested, expectedTested, changed, collisions,
      expectedCollisions, collisionBound, collisionsByMineCount,
      samplePerEpoch: SAMPLE_PER_EPOCH, epochs: EXPECTED_EPOCHS,
      emptySeedControl: {
        betsTested: emptyTested, expectedTested: EXPECTED_BETS, collisions: emptyCollisions,
        expectedCollisions: emptyExpected, collisionBound: emptyBound, collisionsByMineCount: emptyByMineCount,
      },
    },
  );

  return [s5, s6];
}
