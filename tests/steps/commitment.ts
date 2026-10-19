/**
 * Steps 1–4: Commit-Reveal Integrity
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { verifyHash, computeMinePositions } from '../../src/rng';
import {
  EXPECTED_SEEDS, EXPECTED_CHAIN_LINKS, EXPECTED_PHASE_BOUNDARY_SKIPS,
  EXPECTED_EPOCHS, EPOCH_SIZE, NONCE_BASE,
  EXPECTED_PHASE_E_SEEDS, EXPECTED_PHASE_E_CHAIN_LINKS, EXPECTED_PHASE_E_PHASE_BOUNDARY_SKIPS,
  EXPECTED_PHASE_E_EPOCH_SIZES, DECLARED_CAPTURE_RETRY_GAPS,
} from '../../src/loader';
import type { SeedEntry } from '../../src/types';
import type { EpochGroup } from '../../src/loader';

export function run(ctx: VerifyContext): StepResult[] {
  const { seeds, seedMap, epochs, orphanBets } = ctx;

  // ── Step 1: Seed hash integrity ─────────────────────────────────────────────
  // SHA-256(hex_decode(serverSeed)) === serverSeedHashed for all revealed seeds.
  //
  // "0 mismatches" IS NOT A RESULT. An empty seed list satisfies it, and so does a list
  // truncated to a single entry — the old form counted only the seeds it happened to be
  // handed and passed whenever none of them disagreed. What makes the absence of a mismatch
  // mean something is the SIZE of the thing that produced it, so the population declared in
  // src/loader.ts is asserted here alongside the hashes.
  //
  // A seed whose plaintext is never revealed cannot be checked, and an unverifiable seed must
  // be COUNTED AND REPORTED, never `continue`d past in silence: silent skipping is how a step
  // arrives at "0 mismatches" having checked nothing.
  //
  // THE PHASE-BOUNDARY REVEALS ARE MATCHED TOO. The rotation that opens a phase (the first record of
  // the new phase) re-reveals the previous record's seed: the end-of-phase rotation just before it
  // carries no bets, so there is no transaction to read that record's own seed from. Its plaintext
  // therefore does not hash to the PRECEDING commitment. The old form
  // `continue`d past those and asserted only their COUNT — three plaintexts matched to no
  // commitment at all. Each is now required to be byte-identical to the previous record's reveal
  // AND to hash to the commitment two records back; anything else FAILs. Both datasets — the
  // primary capture and the Phase E corpus — are held to the same rule, each against its own
  // population constants.
  const chainAudit = (
    label: string, list: SeedEntry[], expectedSeeds: number, expectedLinks: number, expectedBoundary: number,
  ) => {
    let verified = 0, fails = 0, boundary = 0, boundaryBound = 0, unrevealed = 0;
    const failures: string[] = [];
    for (let i = 1; i < list.length; i++) {
      const reveal = list[i].seed.serverSeed;
      if (!reveal) { unrevealed++; continue; }
      if (verifyHash(reveal, list[i - 1].seed.serverSeedHashed)) { verified++; continue; }
      if (list[i].phase !== list[i - 1].phase) {
        boundary++;
        if (i >= 2 && reveal === list[i - 1].seed.serverSeed && verifyHash(reveal, list[i - 2].seed.serverSeedHashed)) {
          boundaryBound++;
        } else {
          fails++;
          failures.push(`${label} seed[${i}]: phase-opening reveal is neither the previous record's reveal nor `
            + `a preimage of seed[${i - 2}].serverSeedHashed — a plaintext matched to NO commitment`);
        }
        continue;
      }
      fails++;
      failures.push(`${label} seed[${i}]: SHA-256(revealed) != seed[${i - 1}].serverSeedHashed`);
    }
    const population: string[] = [];
    if (list.length !== expectedSeeds) population.push(`${label} seed records ${list.length} != ${expectedSeeds}`);
    if (unrevealed !== 0) population.push(`${label}: ${unrevealed} seed(s) never revealed a plaintext — unverifiable, not skipped`);
    if (verified + boundary !== expectedLinks) population.push(`${label}: ${verified} verified + ${boundary} boundary != ${expectedLinks} transitions`);
    if (boundary !== expectedBoundary) population.push(`${label}: ${boundary} phase-boundary reveals != ${expectedBoundary} in the capture plan`);
    return { verified, fails, boundary, boundaryBound, unrevealed, failures, population };
  };
  const p1 = chainAudit('primary', seeds, EXPECTED_SEEDS, EXPECTED_CHAIN_LINKS, EXPECTED_PHASE_BOUNDARY_SKIPS);
  const e1 = chainAudit('Phase E', ctx.phaseESeeds, EXPECTED_PHASE_E_SEEDS, EXPECTED_PHASE_E_CHAIN_LINKS, EXPECTED_PHASE_E_PHASE_BOUNDARY_SKIPS);
  const fails = p1.fails + e1.fails;
  const failures = [...p1.failures, ...e1.failures];
  const s1Population = [...p1.population, ...e1.population];

  const s1 = step(1, 'Seed Hash Integrity',
    fails === 0 && s1Population.length === 0 ? 'PASS' : 'FAIL',
    fails > 0
      ? `${fails} hash mismatches: ${failures.slice(0, 3).join('; ')}`
      : s1Population.length > 0
        ? `POPULATION MISMATCH vs the capture plan in src/loader.ts: ${s1Population.join('; ')}`
        : `Every one of the ${EXPECTED_SEEDS} primary and ${EXPECTED_PHASE_E_SEEDS} Phase E seed records in the `
          + `capture plan is present and revealed. Primary: ${EXPECTED_CHAIN_LINKS} transitions — `
          + `${EXPECTED_CHAIN_LINKS - EXPECTED_PHASE_BOUNDARY_SKIPS} reveal the preceding commitment, `
          + `${EXPECTED_PHASE_BOUNDARY_SKIPS} phase-opening reveals each equal the previous reveal and hash to the `
          + `commitment two records back. Phase E: ${EXPECTED_PHASE_E_CHAIN_LINKS} transitions — `
          + `${EXPECTED_PHASE_E_CHAIN_LINKS - EXPECTED_PHASE_E_PHASE_BOUNDARY_SKIPS} + ${EXPECTED_PHASE_E_PHASE_BOUNDARY_SKIPS} `
          + `on the same rule. Every revealed plaintext is matched to a commitment; 0 unverifiable.`,
    {
      seedRecords: seeds.length, expectedSeeds: EXPECTED_SEEDS, verified: p1.verified,
      phaseBoundarySkips: p1.boundary, phaseBoundaryBoundToCommitment: p1.boundaryBound,
      unrevealed: p1.unrevealed, mismatches: p1.fails,
      phaseE: {
        seedRecords: ctx.phaseESeeds.length, expectedSeeds: EXPECTED_PHASE_E_SEEDS, verified: e1.verified,
        phaseBoundaryReveals: e1.boundary, phaseBoundaryBoundToCommitment: e1.boundaryBound,
        unrevealed: e1.unrevealed, mismatches: e1.fails,
      },
    },
  );

  // ── Step 2: Next-Seed Promotion (Commitment Linkage) ────────────────────────
  // Set membership proves a bet was served under SOME captured seed. It says nothing about
  // ORDER, and order is the whole property: without it an operator may pick, after seeing the
  // bet, which of the seeds it already holds to serve it under.
  //
  // What fixes the order is the forward commitment: every rotation publishes the hash of the
  // seed it will activate NEXT, so seeds[i].nextServerSeedHash must equal
  // seeds[i+1].serverSeedHashed across every transition. The dataset has carried that field on
  // all 134 rows since capture and nothing read it — it was declared in src/types.ts and never
  // referenced. The old step read `nextSeedPromotion.match` instead, a boolean the CAPTURE
  // SCRIPT wrote, which asserts only that the capture script agreed with itself; and it
  // forgave up to two disagreements outright, so two broken links were indistinguishable from
  // none. The chain is recomputed here from the raw hashes and nothing is forgiven.
  const chainFailures: string[] = [];
  let linksChecked = 0, linksOk = 0;
  for (let i = 0; i < seeds.length - 1; i++) {
    linksChecked++;
    if (seeds[i].seed.nextServerSeedHash === seeds[i + 1].seed.serverSeedHashed) linksOk++;
    else chainFailures.push(
      `seed[${i}].nextServerSeedHash != seed[${i + 1}].serverSeedHashed — the chain does not link epoch ${i} to epoch ${i + 1}`);
  }

  // The first captured epoch has no predecessor inside the capture, so the chain above cannot
  // reach it. Its own rotation record carries the hash that was standing as "next" BEFORE
  // capture began; that is the pre-capture link, and it is the only evidence that the first
  // epoch was committed rather than chosen. An ABSENT link must FAIL — if it passed quietly,
  // deleting the field would be a way to make the check disappear.
  const first = seeds[0];
  const preCapture = first?.nextSeedPromotion;
  let preCaptureOk = false;
  if (!preCapture) {
    chainFailures.push('seed[0] carries no nextSeedPromotion — the pre-capture link is ABSENT, not satisfied');
  } else if (preCapture.previousNextHash !== first.seed.serverSeedHashed) {
    chainFailures.push('seed[0]: the hash standing as "next" before capture != the first epoch\'s active hash');
  } else {
    preCaptureOk = true;
  }

  // Cross-check the capture script's own verdict against what was just recomputed.
  let promoChecked = 0, promoDisagreements = 0;
  for (const s of seeds) {
    if (!s.nextSeedPromotion) continue;
    promoChecked++;
    const recomputed = s.nextSeedPromotion.previousNextHash === s.nextSeedPromotion.newActiveHash;
    if (recomputed !== s.nextSeedPromotion.match) promoDisagreements++;
  }
  if (promoDisagreements > 0) {
    chainFailures.push(
      `${promoDisagreements} rotation record(s) where the capture script's stored \`match\` disagrees with the recomputed hashes`);
  }
  if (linksChecked !== EXPECTED_CHAIN_LINKS) {
    chainFailures.push(`${linksChecked} chain links != ${EXPECTED_CHAIN_LINKS} in the capture plan`);
  }
  if (promoChecked !== EXPECTED_SEEDS) {
    chainFailures.push(`${promoChecked} rotation records != ${EXPECTED_SEEDS} in the capture plan`);
  }

  // The Phase E corpus is a second capture with its own rotation chain; the same three checks
  // run over it against its own population constants.
  const eSeeds = ctx.phaseESeeds;
  let eLinksChecked = 0, eLinksOk = 0, ePromoChecked = 0, ePromoDisagreements = 0;
  for (let i = 0; i < eSeeds.length - 1; i++) {
    eLinksChecked++;
    if (eSeeds[i].seed.nextServerSeedHash === eSeeds[i + 1].seed.serverSeedHashed) eLinksOk++;
    else chainFailures.push(`Phase E seed[${i}].nextServerSeedHash != seed[${i + 1}].serverSeedHashed`);
  }
  const ePre = eSeeds[0]?.nextSeedPromotion;
  const ePreOk = !!ePre && ePre.previousNextHash === eSeeds[0].seed.serverSeedHashed;
  if (!ePreOk) chainFailures.push('Phase E seed[0]: pre-capture link absent or != the first epoch\'s active hash');
  for (const s of eSeeds) {
    if (!s.nextSeedPromotion) continue;
    ePromoChecked++;
    if ((s.nextSeedPromotion.previousNextHash === s.nextSeedPromotion.newActiveHash) !== s.nextSeedPromotion.match) ePromoDisagreements++;
  }
  if (ePromoDisagreements > 0) chainFailures.push(`Phase E: ${ePromoDisagreements} capture \`match\` flag(s) disagree with the recomputed hashes`);
  if (eLinksChecked !== EXPECTED_PHASE_E_CHAIN_LINKS) chainFailures.push(`Phase E: ${eLinksChecked} chain links != ${EXPECTED_PHASE_E_CHAIN_LINKS}`);
  if (ePromoChecked !== EXPECTED_PHASE_E_SEEDS) chainFailures.push(`Phase E: ${ePromoChecked} rotation records != ${EXPECTED_PHASE_E_SEEDS}`);

  const s2 = step(2, 'Next-Seed Promotion (Commitment Linkage)',
    chainFailures.length === 0 ? 'PASS' : 'FAIL',
    chainFailures.length > 0
      ? `Forward commitment chain broken: ${chainFailures.slice(0, 3).join('; ')}`
      : `All ${EXPECTED_CHAIN_LINKS} epoch transitions recomputed from the raw hashes: each epoch's `
        + `serverSeedHashed equals the nextServerSeedHash recorded at the previous rotation, and the first `
        + `epoch equals the hash recorded as "next" before capture began. This is a consistency check: it `
        + `shows the ${EXPECTED_SEEDS} seed records form one chain, not when each hash was shown; that timing `
        + `rests on the capture's recorded observations (MANIFEST.md, Limitations and trust; premise P7). `
        + `The capture script's own \`match\` flags `
        + `agree with the recomputation on all ${EXPECTED_SEEDS} records. The Phase E chain holds on the same terms: `
        + `${EXPECTED_PHASE_E_CHAIN_LINKS} links, its own pre-capture anchor, ${EXPECTED_PHASE_E_SEEDS} capture flags in agreement.`,
    {
      chainLinksChecked: linksChecked,
      chainLinksOk: linksOk,
      expectedChainLinks: EXPECTED_CHAIN_LINKS,
      preCaptureLinkPresent: preCapture !== undefined,
      preCaptureLinkVerified: preCaptureOk,
      rotationRecords: promoChecked,
      captureFlagDisagreements: promoDisagreements,
      phaseE: { chainLinksChecked: eLinksChecked, chainLinksOk: eLinksOk, expectedChainLinks: EXPECTED_PHASE_E_CHAIN_LINKS,
        preCaptureLinkVerified: ePreOk, rotationRecords: ePromoChecked, captureFlagDisagreements: ePromoDisagreements },
    },
  );

  // ── Step 3: Hash consistency within epoch ────────────────────────────────────
  // THE OLD FORM WAS A TAUTOLOGY. Bets were grouped BY their serverSeedHashed and the step then
  // asserted one distinct serverSeedHashed per group — true of any input whatsoever, including
  // a dataset in which every bet carried a different hash. It could not fail, so it decided
  // nothing.
  //
  // Epoch membership now comes from the capture timeline (src/loader.ts groupByEpochWindow): a
  // bet belongs to the last rotation record that precedes it. That source does not read the
  // bet's hash, so the claim is falsifiable: every bet served while rotation record i was
  // active must carry record i's committed serverSeedHashed AND record i's clientSeed. The
  // client-seed half is asserted here, against the ROTATION RECORD; step 4 additionally checks
  // that the bets within a window agree among themselves, which is a weaker, within-file check.
  //
  // WHAT IT DOES NOT SHOW (Mike's QA, 19 Oct 2026: "Step 3 nearly repeats its own input"). A bet's
  // seed.serverSeedHashed and seed.clientSeed are not fields of the bet response: the capture copied
  // them from the last rotation response it received (meta.activeServerSeedHashed / activeClientSeed,
  // capture/mines-capture.reference.js lines 472–475, capture/mines-capture-phaseE.reference.js
  // lines 552–553). So this step binds the capture's records to each other: it would catch a record
  // filed under the wrong rotation or edited afterwards, not a bet the operator served under another
  // seed. That each served layout came from the epoch's seed is Step 5's recomputation.
  const s3Failures: string[] = [];
  let betBearing = 0, empty = 0;
  for (const e of epochs) {
    if (e.bets.length === 0) { empty++; continue; }
    betBearing++;
    const tag = `seeds[${e.index}] (${e.record.seed.serverSeedHashed.substring(0, 16)})`;
    const hashes  = new Set(e.bets.map(b => b.seed.serverSeedHashed));
    const clients = new Set(e.bets.map(b => b.seed.clientSeed));
    if (hashes.size !== 1) {
      s3Failures.push(`${tag}: ${hashes.size} distinct serverSeedHashed among its ${e.bets.length} bets`);
    } else if (!hashes.has(e.record.seed.serverSeedHashed)) {
      s3Failures.push(`${tag}: its bets carry ${[...hashes][0].substring(0, 16)}, not the hash the rotation committed`);
    }
    if (clients.size !== 1) {
      s3Failures.push(`${tag}: ${clients.size} distinct client seeds among its bets`);
    } else if (!clients.has(e.record.seed.clientSeed)) {
      s3Failures.push(`${tag}: its bets carry client seed ${[...clients][0]}, not the rotation record's ${e.record.seed.clientSeed}`);
    }
  }
  if (orphanBets.length > 0) {
    s3Failures.push(`${orphanBets.length} bet(s) captured before any rotation record — no epoch can claim them`);
  }
  if (betBearing !== EXPECTED_EPOCHS) {
    s3Failures.push(`${betBearing} bet-bearing epochs != ${EXPECTED_EPOCHS} in the capture plan`);
  }
  if (empty !== EXPECTED_SEEDS - EXPECTED_EPOCHS) {
    s3Failures.push(`${empty} rotation records without bets != ${EXPECTED_SEEDS - EXPECTED_EPOCHS} (the end-of-phase rotations)`);
  }

  const s3 = step(3, 'Hash Consistency Within Epoch',
    s3Failures.length === 0 ? 'PASS' : 'FAIL',
    s3Failures.length > 0
      ? `${s3Failures.length} epoch(s) disagree with their rotation record: ${s3Failures.slice(0, 3).join('; ')}`
      : `Epochs keyed by the capture timeline, not by the bets' own hash: every bet served under each of `
        + `the ${EXPECTED_EPOCHS} bet-bearing rotation records carries that record's committed serverSeedHashed `
        + `and its clientSeed; the ${EXPECTED_SEEDS - EXPECTED_EPOCHS} remaining records are the end-of-phase `
        + `rotations and carry no bets. 0 orphan bets. A bet's serverSeedHashed and clientSeed are the capture's `
        + `copies of its rotation response (capture/mines-capture.reference.js lines 472–475), not served with the `
        + `bet: this binds the capture's records to each other; Step 5's recomputation binds each served layout `
        + `to the seed.`,
    { rotationRecords: epochs.length, betBearingEpochs: betBearing, emptyEpochs: empty, orphanBets: orphanBets.length, disagreements: s3Failures.length },
  );

  // ── Step 4: Nonce Audit (declared base, no reuse, gap origin) ─────────────────
  // Within every epoch the nonces must run NONCE_BASE … NONCE_BASE + size − 1. The base is a
  // DECLARED constant (src/loader.ts), never the minimum observed: an epoch that began at nonce 3
  // would otherwise define its own base and pass.
  //
  // A GAP HAS AN ORIGIN, AND THE ORIGIN DECIDES THE SEVERITY (profile MINES-04, policy
  // 2026-09-17). An operator that skips or repeats a nonce is a HARD FAIL. An auditor whose capture
  // request failed after the round was placed also leaves a gap — the operator consumed the nonce,
  // the capture wrote no record — and that is a FLAG with origin = capture: disclosed, never
  // verdict-affecting. Nothing in the dataset can tell the two apart, so the auditor-side gaps are
  // DECLARED in src/loader.ts DECLARED_CAPTURE_RETRY_GAPS, each with its evidence and a
  // limitation id; every gap not in that register is treated as operator-side and FAILs, and a
  // register row with no gap behind it FAILs as stale.
  //
  // At every gap the revealed seed must still yield a WELL-FORMED layout (exactly mineCount
  // distinct tiles in 0..24): that is the most a re-derivation can say about a nonce nobody
  // captured, and a malformed layout FAILs. A DUPLICATE nonce — the same (seed, clientSeed, nonce)
  // served twice, i.e. the same layout sold twice — FAILs outright. Both datasets are audited:
  // the primary epochs (EPOCH_SIZE each) and the Phase E epochs (EXPECTED_PHASE_E_EPOCH_SIZES).
  const hardFailures: string[] = [];
  const captureGaps: string[] = [];
  const gapEpochs: string[] = [];
  let epochsChecked = 0, phaseEEpochsChecked = 0, epochsWithGaps = 0, totalMissedNonces = 0;
  let gapsWellFormed = 0, gapsMalformed = 0, gapsUnrecomputable = 0, duplicateNonces = 0;
  let operatorGaps = 0, captureOriginGaps = 0;
  const registerHits = new Set<number>();

  const auditEpoch = (dataset: 'primary' | 'phaseE', e: EpochGroup, plannedBets: number, clientSeedRecord: string) => {
    const sorted = [...e.bets].sort((a, b) => a.seed.nonce - b.seed.nonce);
    const tag = `${dataset === 'primary' ? '' : 'Phase E '}seeds[${e.index}] (${e.record.seed.serverSeedHashed.substring(0, 16)})`;
    const nonces = sorted.map(b => b.seed.nonce);

    const clientSeeds = new Set(sorted.map(b => b.seed.clientSeed));
    if (clientSeeds.size !== 1) hardFailures.push(`${tag}: ${clientSeeds.size} distinct client seeds`);
    if (nonces[0] !== NONCE_BASE) hardFailures.push(`${tag}: first nonce is ${nonces[0]} (declared base ${NONCE_BASE})`);

    const declared = DECLARED_CAPTURE_RETRY_GAPS
      .map((g, idx) => ({ ...g, idx }))
      .filter(g => g.dataset === dataset && g.seedIndex === e.index);
    // The last nonce is the declared base + the bets the plan puts in this epoch + the declared
    // capture gaps inside it − 1. An epoch cut short, or padded, disagrees.
    const expectedLast = NONCE_BASE + plannedBets + declared.length - 1;
    const maxNonce = Math.max(...nonces);
    if (maxNonce !== expectedLast) hardFailures.push(`${tag}: last nonce is ${maxNonce} (expected ${expectedLast})`);
    const nonceSet = new Set(nonces);
    if (nonceSet.size !== nonces.length) {
      const dups = nonces.length - nonceSet.size;
      duplicateNonces += dups;
      hardFailures.push(`${tag}: ${dups} nonce(s) served more than once — the same layout sold twice`);
    }

    const missing: number[] = [];
    for (let n = NONCE_BASE; n <= maxNonce; n++) if (!nonceSet.has(n)) missing.push(n);
    for (const g of declared) {
      if (!missing.includes(g.nonce)) hardFailures.push(`${tag}: declared capture-retry gap at nonce ${g.nonce} (${g.dl}) is not a gap — the register is stale`);
    }
    if (missing.length === 0) return;

    epochsWithGaps++;
    totalMissedNonces += missing.length;
    gapEpochs.push(`${tag}: ${missing.length} gap(s) at ${missing.slice(0, 5).join(',')}`);

    const serverSeed = seedMap.get(e.record.seed.serverSeedHashed);
    for (const missedNonce of missing) {
      const reg = declared.find(g => g.nonce === missedNonce);
      if (reg) {
        captureOriginGaps++;
        registerHits.add(reg.idx);
        captureGaps.push(`${tag} nonce ${missedNonce} (${reg.dl})`);
      } else {
        operatorGaps++;
        hardFailures.push(`${tag}: nonce ${missedNonce} missing and NOT a declared capture retry — operator-side gap`);
      }
      if (!serverSeed) {
        gapsUnrecomputable++;
        hardFailures.push(`${tag}: nonce ${missedNonce} missed and the epoch seed is UNREVEALED — unverifiable`);
        continue;
      }
      const nearBet = sorted.find(b => b.seed.nonce > missedNonce) ?? sorted[sorted.length - 1];
      const mineCount = nearBet.request.mines_count;
      const layout = computeMinePositions(serverSeed, clientSeedRecord, missedNonce, mineCount);
      const wellFormed = layout.length === mineCount
        && new Set(layout).size === mineCount
        && layout.every(t => Number.isInteger(t) && t >= 0 && t <= 24);
      if (wellFormed) gapsWellFormed++;
      else {
        gapsMalformed++;
        hardFailures.push(`${tag}: the revealed seed does not yield a well-formed ${mineCount}-mine layout at nonce ${missedNonce}`);
      }
    }
  };

  for (const e of epochs) {
    if (e.bets.length === 0) continue;
    epochsChecked++;
    auditEpoch('primary', e, EPOCH_SIZE, e.record.seed.clientSeed);
  }
  for (const e of ctx.phaseEEpochs) {
    const planned = EXPECTED_PHASE_E_EPOCH_SIZES[e.index] ?? 0;
    if (e.bets.length !== planned) {
      hardFailures.push(`Phase E seeds[${e.index}]: ${e.bets.length} bets != ${planned} in the capture plan`);
    }
    if (e.bets.length === 0) continue;
    phaseEEpochsChecked++;
    auditEpoch('phaseE', e, planned, e.record.seed.clientSeed);
  }
  if (ctx.phaseEOrphans.length > 0) {
    hardFailures.push(`${ctx.phaseEOrphans.length} Phase E bet(s) captured before any Phase E rotation record`);
  }
  if (epochsChecked !== EXPECTED_EPOCHS) {
    hardFailures.push(`${epochsChecked} bet-bearing primary epochs != ${EXPECTED_EPOCHS} in the capture plan`);
  }
  const expectedPhaseEEpochs = Object.values(EXPECTED_PHASE_E_EPOCH_SIZES).filter(n => n > 0).length;
  if (phaseEEpochsChecked !== expectedPhaseEEpochs) {
    hardFailures.push(`${phaseEEpochsChecked} bet-bearing Phase E epochs != ${expectedPhaseEEpochs} in the capture plan`);
  }
  if (registerHits.size !== DECLARED_CAPTURE_RETRY_GAPS.length) {
    hardFailures.push(`${DECLARED_CAPTURE_RETRY_GAPS.length - registerHits.size} declared capture-retry gap(s) matched no epoch`);
  }

  const s4Status = hardFailures.length > 0 ? 'FAIL' : captureOriginGaps > 0 ? 'FLAG' : 'PASS';
  const s4Detail = hardFailures.length > 0
    ? `${hardFailures.length} nonce violation(s): ${hardFailures.slice(0, 3).join('; ')}`
    : captureOriginGaps > 0
      ? `${EXPECTED_EPOCHS} primary epochs run ${NONCE_BASE}..${NONCE_BASE + EPOCH_SIZE - 1} with no gap and no reuse; `
        + `${expectedPhaseEEpochs} Phase E epochs match their planned sizes. ${captureOriginGaps} nonce gap(s), every one a `
        + `DECLARED capture retry (${captureGaps.join('; ')}): the operator consumed the nonce and the capture wrote no `
        + `record. At every gap the revealed seed yields a well-formed layout (${gapsWellFormed} well-formed) — which shows `
        + `the RNG is defined there, not what the operator served. Capture-origin FLAG: disclosed, verdict-neutral. `
        + `0 operator-side gaps, 0 reused nonces.`
      : `${EXPECTED_EPOCHS} primary and ${expectedPhaseEEpochs} Phase E epochs: nonces run from the declared base `
        + `${NONCE_BASE} with no gap and no reuse, single client seed per epoch.`;

  const s4 = step(4, 'Nonce Audit', s4Status, s4Detail, {
    epochs: epochsChecked, expectedEpochs: EXPECTED_EPOCHS, epochSize: EPOCH_SIZE, nonceBase: NONCE_BASE,
    phaseEEpochs: phaseEEpochsChecked, expectedPhaseEEpochs,
    epochsWithGaps, missedNonces: totalMissedNonces, operatorGaps, captureOriginGaps,
    declaredCaptureRetryGaps: DECLARED_CAPTURE_RETRY_GAPS.length, duplicateNonces,
    gapsWellFormed, gapsMalformed, gapsUnrecomputable,
  }, captureOriginGaps > 0 && hardFailures.length === 0 ? 'capture' : undefined);

  return [s1, s2, s3, s4];
}
