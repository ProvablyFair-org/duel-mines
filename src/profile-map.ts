/**
 * Which ProvablyFair.org Mines profile check each scored step implements.
 *
 * WHY THIS FILE EXISTS. The framework's Mines game profile (Framework 1.1, profile 1.0.2)
 * declares checks MINES-01 … MINES-30. This suite scores 26 steps under its own numbering, which
 * every chapter cites by number and which therefore cannot be renumbered to match. Without a
 * written mapping the only way to relate the two was to read all 26 steps by hand and type the
 * answer into the profile — where it went stale the moment a step changed, silently, because
 * nothing re-derived it. The mapping is declared here, emitted into
 * `outputs/verification-results.json` beside the step results, and read back by `pf-audit matrix`,
 * which prints the conformance matrix and exits 1 when a HARD_FAIL check has nothing implementing
 * it.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. Nothing here can make a step pass or fail. An id claimed for
 * a step the step does not implement is a false statement in a published artifact, so the rule is
 * the profile's own `asserts` text: claim the check only if the step's assertion actually decides it
 * AND the step's failing branch is reachable (the profile's rules.unfailableGuard).
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented; where a check is split
 *             across two or more steps every one of them says `full` and each note says which half
 *             it carries.
 *   partial — something the profile requires is implemented nowhere in this package, and the note
 *             says what. `partial` is a disclosure, never a softer word for `full`.
 * A check no step and no package artifact claims is reported `missing`; none is, since 2026-09-24
 * (MINES-24, player-verifier parity, is answered by the two site-verifier legs of Step 5). One check is
 * n/a by the declaration's predicate: MINES-16 (no balance field).
 *
 * THE 2026-09-24 ROUND. MINES-24 was implemented (Step 5 third leg + verifier-parity/ +
 * scripts/check-site-verifier.mjs; the fourth leg — the LIVE www.provablyfair.org/verify-bets bundle,
 * verifier-parity/live-site/ + src/live-site-verifier.ts — was added the same day) and MINES-14 was completed UNDER THE PROPOSED RULE R2, PENDING
 * PROFILE OWNER (the cap half scored on served/settled multipliers; n/a with cited evidence when no
 * cap is declared). Every note below that relies on R2 says so.
 *
 * EVERY NOTE BELOW WAS READ OUT OF THE CODE IT DESCRIBES on the 2026-09-23 conformance bump (26
 * steps), every count it quotes was produced by `npm run verify` against the pinned datasets and
 * artifacts, and every "FAIL is reachable" is backed by a mutation in tests/mutations.json that
 * `npm run mutate` runs in a throwaway copy (the M-id is cited). Nothing here is from memory, and
 * nothing is from the declaration's lineNote, which describes an earlier layout.
 */

export type Coverage = 'full' | 'partial';

export interface CheckClaim {
  id: string;
  coverage: Coverage;
  /** For `partial`: what the profile requires that this package does not do. */
  note?: string;
}

export interface StepClaims {
  claims: CheckClaim[];
  /** Required when `claims` is empty: why the step answers no profile check. */
  reason?: string;
}

export const PROFILE_GAME = 'mines';
export const PROFILE_VERSION = '1.0.2';

/** Scored step number → the profile checks it implements. Every step 1..26 has an entry. */
export const STEP_CLAIMS: Record<number, StepClaims> = {
  // Step 1 — Seed Hash Integrity. MINES-01 in full.
  1: {
    claims: [{
      id: 'MINES-01', coverage: 'full',
      note: 'every revealed plaintext in BOTH datasets is matched to a commitment under the one declared '
        + 'encoding (SHA-256 of the hex-decoded bytes, src/rng.ts verifyHash): a reveal must hash to the '
        + 'preceding record\'s serverSeedHashed or, at the rotation that opens a phase, be byte-identical to the '
        + 'previous reveal AND hash to the commitment two records back — anything else FAILs (the old form '
        + 'counted those reveals and matched them to nothing). Population from code: primary 134 records / '
        + '133 transitions / 3 boundary reveals, Phase E 17 / 16 / 4 (src/loader.ts); an unrevealed '
        + 'plaintext FAILs. Measured: primary 130 + 3 bound, Phase E 12 + 4 bound, 0 unrevealed, 0 '
        + 'mismatches. FAIL probed: M01 (a forged phase-opening plaintext, dataset re-pinned)',
    }],
  },

  // Step 2 — Next-Seed Promotion. MINES-02 in full.
  2: {
    claims: [{
      id: 'MINES-02', coverage: 'full',
      note: 'every rotation link recomputed from the RAW fields — seeds[i].seed.nextServerSeedHash must equal '
        + 'seeds[i+1].seed.serverSeedHashed — in both datasets, link counts bound to EXPECTED_CHAIN_LINKS '
        + '(133) and EXPECTED_PHASE_E_CHAIN_LINKS (16); the capture script\'s `nextSeedPromotion.match` '
        + 'boolean is only cross-checked (a disagreement FAILs). The pre-capture anchor of each dataset '
        + '(seeds[0].nextSeedPromotion.previousNextHash === the first active hash) is asserted and its '
        + 'absence FAILs. Measured: 133/133 + 16/16, both anchors verified, 0 flag disagreements. FAIL '
        + 'probed: M02 (one nextServerSeedHash zeroed, dataset re-pinned)',
    }],
  },

  // Step 3 — Hash Consistency Within Epoch. MINES-03 in full.
  3: {
    claims: [{
      id: 'MINES-03', coverage: 'full',
      note: 'epochs are keyed on the CAPTURE TIMELINE (src/loader.ts groupByEpochWindow), not on the bets\' '
        + 'own hash; every bet in a window must carry the rotation record\'s committed serverSeedHashed and '
        + 'its clientSeed, both HARD FAIL; orphans FAIL; bet-bearing and empty record counts bound to 130 '
        + 'and 4. Measured: 130 bet-bearing, 4 empty, 0 orphans, 0 disagreements. A bet\'s serverSeedHashed '
        + 'and clientSeed are the capture\'s copies of its rotation response (capture/mines-capture.reference.js '
        + 'lines 472–475), not served with the bet, so this binds the capture\'s records to each other; that '
        + 'each served layout came from that seed is Step 5. FAIL probed: M03 (epoch timeline shifted by one '
        + 'record)',
    }],
  },

  // Step 4 — Nonce Audit. Within-window half of MINES-03; MINES-04 in full.
  4: {
    claims: [
      {
        id: 'MINES-03', coverage: 'full',
        note: 'the within-window half: the bets of each timeline epoch (primary and Phase E) must agree on one '
          + 'client seed (HARD FAIL otherwise)',
      },
      {
        id: 'MINES-04', coverage: 'full',
        note: 'every bet-bearing epoch of both datasets (130 primary + 12 Phase E, both bound) must start at '
          + 'the DECLARED base NONCE_BASE = 0 (src/loader.ts — never the minimum observed) and end at base + '
          + 'planned bets + declared gaps − 1; a repeated nonce FAILs. THE SEVERITY SPLIT: a gap listed in '
          + 'DECLARED_CAPTURE_RETRY_GAPS (each row with its evidence and a DL id) is an auditor-side capture '
          + 'retry → FLAG with origin = capture, disclosed and verdict-neutral (the Duel Video Poker mechanism: '
          + 'tests/verify.ts separates capture-origin from operator-origin flags; exit 0); any gap NOT in the '
          + 'register is operator-side → HARD FAIL; a register row with no gap behind it FAILs as stale; the '
          + 'revealed seed must yield a well-formed layout at every gap. Measured: primary 130 epochs 0..49, '
          + 'no gap; Phase E one gap — seeds[9] (d6ff34bb…) nonce 12, the declared capture retry (DL-2, '
          + 'inferred: a 30 s clock gap across it and the E3 pattern due there served 7 times not 8; round_id '
          + 'is not a per-player counter, so its jump there does not on its own show a lost round) — '
          + 'so the step reports FLAG:capture and the verdict stays Full Pass. This gap was UNASSERTED '
          + 'before 2026-09-23 (Step 4 read the primary dataset only). FAIL probed: M04 (register emptied → '
          + 'the gap is operator-side → FAIL), M04b (declared base 1 → FAIL)',
      },
    ],
  },

  // Step 5 — Mine Position Recomputation. MINES-07 (primary population) and MINES-08 in full.
  5: {
    claims: [{
      id: 'MINES-07', coverage: 'full',
      note: 'the primary-dataset half: every one of the 6,500 bets — wins and losses, no filter — is '
        + 'recomputed from its revealed seed and compared with the served mines_positions as a SORTED SET '
        + '(src/layout.ts sameLayout; the declaration\'s layoutRepresentation.orderMatters is false); a '
        + 'skipped bet FAILs and the count is bound to EXPECTED_BETS. Measured: 6,500/6,500, 0 skipped, 0 '
        + 'mismatches. The Phase E half (550) is Step 21. FAIL probed: M06 (client seed dropped from the HMAC '
        + 'message: Step 5 fails beside Step 6)',
    }, {
      id: 'MINES-08', coverage: 'full',
      note: 'maxFair PER RANGE as a computed bound — for all 24 ranges 2..25 the accepted window is MEASURED '
        + 'from src/rng.ts drawFromChunk (binary search + ~600 probes), HARD FAIL unless every window is a '
        + 'whole number of ranges and the worst per-index bias is <= 2^-32 — plus the rejection census over '
        + 'the 6,500 recomputed rounds, its draw count bound to recomputed x 24. Measured: 24/24 exact (range '
        + '25: 4294967275 = 25 x 171798691), worst bias 0, 156,000 draws, 0 rejected chunks, expected '
        + 'rejections 2.36e-4. FAIL probed: M05 (maxFair = 2^32 − 1 for every range)',
    }],
  },

  // Step 6 — Client Seed Influence. The influence and empty-seed half of MINES-06; partial on the generator.
  6: {
    claims: [{
      id: 'MINES-06', coverage: 'partial',
      note: 'what IS asserted: (1) a WRONG client seed on 5 bets from each of the 130 revealed epochs (650, '
        + 'bound) changes the layout except for collisions held to the model rate sum(1/C(25,m)) + 5 sigma + 1 '
        + '— measured 4 collisions, expected 5.97, bound 18.95; (2) an EMPTY-SEED CONTROL (clientSeed = "") '
        + 'over all 6,500 primary bets on the same model bound — measured 56 collisions, expected 59.33, bound '
        + '98.08 (new 2026-09-23); (3) the Phase D half and the predictable-seed disclosure are Step 17. FAIL '
        + 'probed: M06 (client seed dropped from the HMAC message → 650/650 collide). WHAT IS MISSING — and '
        + 'cannot be closed without a new capture: the profile requires the A–C client-seed generator to be a '
        + 'CSPRNG, and it is not: capture/mines-capture.reference.js generateClientSeed draws 16 characters '
        + 'with Math.random() for the 120 bet-bearing A–C epochs. It is DISCLOSED as MANIFEST.md DL-1 with that '
        + 'count; the property itself is a capture-design fact no verifier change can make true',
    }],
  },

  // Step 7 — Payout Math. MINES-11 in full (with Steps 10 and 23).
  7: {
    claims: [{
      id: 'MINES-11', coverage: 'full',
      note: 'EVERY settled round not scored by Step 23: all 6,500 primary bets and the 417 Phase E rounds that '
        + 'Step 23 does not take (39 depth-1 wins, 378 losses — before 2026-09-23 none of these 417 had a payout '
        + 'assertion). Every win must credit amount x the served with-edge multiplier within MONEY_REL_TOL = '
        + '1e-12 relative floored at 1 (for a $0.01 stake 1e-12 absolute — four orders inside the profile\'s '
        + '1e-8 ceiling; the declaration has no money grid, so the tolerance arm applies); every loss must '
        + 'credit exactly "0"; each win/loss population bound to src/loader.ts (2,795 / 3,705 / 39 / 378 / 133). '
        + 'The multiplier the credit uses is itself bound to the exact formula by Step 8 (every k = 1 win, '
        + 'primary and Phase E) and Step 23 (k > 1). Measured: 0 '
        + 'errors. FAIL probed: M07 (a Phase E loss credited 0.01, dataset re-pinned)',
    }],
  },

  // Step 8 — Multiplier Formula (k = 1). MINES-13 in full (with Steps 20, 23).
  8: {
    claims: [{
      id: 'MINES-13', coverage: 'full',
      note: 'the k = 1 arm: both served strings of every winning primary bet and of the 39 Phase E wins settled '
        + 'at depth 1 (scored here since 2026-10-19; before, only Step 25\'s range held them) are parsed EXACTLY and compared '
        + 'with the exact rational — multiplier with C(25,1)/C(25−m,1), no_house_edge_multiplier with the same '
        + 'x 999/1000 — at MULT_REL_TOL = 1e-12 relative (src/exact.ts; it replaced 1e-6 ABSOLUTE). No exact '
        + 'equality is available because the operator\'s k > 1 values carry double-precision error (worst '
        + '9.2e-15, Step 20); the bound is justified by that computed number (108x headroom) and the worst '
        + 'deviation is emitted every run — here 6.4e-19, the 18th-decimal rounding. The derivation reads '
        + '(m, k) only; the formula\'s origin is declared (MANIFEST.md, published fairness page). Measured: '
        + '2,795 primary + 39 Phase E depth-1 wins, 0 mismatches. FAIL probed: M08 (one served multiplier moved 1.3e-9 relative, dataset '
        + 're-pinned — the old 1e-6 bound passed it)',
    }],
  },

  // Step 9 — Win condition & reveal-sequence consistency. MINES-10 in full.
  9: {
    claims: [{
      id: 'MINES-10', coverage: 'full',
      note: 'for EVERY round of both datasets (7,050, bound; an unrecomputable round FAILs) the outcome is '
        + 'derived from the layout RECOMPUTED from the revealed seed — never from the served mines_positions or '
        + 'the outcome label — and must equal the served outcome: win iff no opened tile is a recomputed mine; '
        + 'every bust (4,083, bound) must end on exactly the last opened tile with no earlier mine; the opened '
        + 'count must equal the recorded depth (1 for every primary bet — its plan; reached_k and the '
        + 'reveal-step count for Phase E); no tile may repeat or leave 0..24; and a Phase E round is cashed out '
        + 'iff it is a win. Measured: 0 errors. FAIL probed: M09 (win/loss arms of the derivation swapped). '
        + 'Step 21 adds the per-step is_mine leg, Step 22 the E5 leg',
    }],
  },

  // Step 10 — Phase C Bet-Size Invariance. MINES-12 in full; the elevated-stake arm of MINES-11.
  10: {
    claims: [
      {
        id: 'MINES-12', coverage: 'full',
        note: 'every one of the 200 $10 bets (m = 12, the low count the profile asks for; stake and mine count '
          + 'asserted) has its layout RECOMPUTED here; every $10 win is scored on the exact multiplier (1e-12 '
          + 'relative), on money (1e-12 relative), and must be served the IDENTICAL multiplier strings as the '
          + '$0.01 m = 12 wins of Phase A — the same formula at both stakes, compared as served; and the '
          + 'profile floor of >= 100 elevated-stake wins is ASSERTED (PHASE_C_MIN_WINS), not merely measured. '
          + 'Measured: 200 recomputed, 105 wins, 0 errors. FAIL probed: M10 (floor raised to 106)',
      },
      {
        id: 'MINES-11', coverage: 'full',
        note: 'the elevated-stake money arm: the 105 $10 wins credited at the same 1e-12 relative bound as Step 7',
      },
    ],
  },

  // Step 11 — Configuration & depth coverage. MINES-15 in full.
  11: {
    claims: [{
      id: 'MINES-15', coverage: 'full',
      note: 'asserted against the PLAN IN CODE (src/loader.ts), FLAG on any shortfall: Phase A carries exactly '
        + 'PHASE_A_BETS_PER_MINE_COUNT = 200 bets on each of the 24 mine counts (profile floor 50); every '
        + 'multi-reveal sub-phase matches PHASE_E_PLAN — bets, mine counts (request and response) and target '
        + 'depth: E1 m3 k5, E2 m5 k3, E3 m12 k3, E4 m15 k2, E5 m{2,4,8,15} k1 at first picks {3,7,11,17,23} — '
        + 'covering 4 depths and 7 mine counts; and the Phase E first picks span all 25 tiles '
        + '(FIRST_PICK_TILES_REQUIRED). The whole-primary floor of 100 per mine count and the 300-cell reach '
        + 'inventory (outputs/payout-coverage.json, pinned) remain. Measured: 24 x 200, 5/5 sub-phases on '
        + 'plan, 25/25 first picks. FAIL (FLAG) probed: M11 (plan says E2 used 6 mines)',
    }],
  },

  // Step 12 — House Edge Audit (operator field). The comparison arm of MINES-19.
  12: {
    claims: [{
      id: 'MINES-19', coverage: 'full',
      note: 'the comparison arm only: the served effective_edge must equal the literal 0.1 on all 6,500 '
        + 'primary bets, HARD FAIL otherwise; the derivation is Step 16, which reads no operator data. '
        + 'Measured: 0 deviations. FAIL probed: M12',
    }],
  },

  // Step 13 — Population & Phase Labels. MINES-05 in full (with Step 15).
  13: {
    claims: [{
      id: 'MINES-05', coverage: 'full',
      note: 'the population half of G-BIND, for BOTH datasets: primary bets 6,500 and seeds 134 with the '
        + 'per-phase split A 4,800/97, B 1,000/21, C 200/5, D 500/11; the secondary (Phase E, pinned by '
        + 'SHA-256) counted the same way — bets 550 and seed records 17, per sub-phase E1..E5 bets '
        + '100/100/200/100/50 and seeds 3/3/6/3/2 (EXPECTED_PHASE_E_SEEDS was declared and read by nothing '
        + 'until 2026-09-23); all constants in src/loader.ts, an undeclared label FAILs. Measured: all at plan. '
        + 'FAIL probed: M13 (Phase E seed plan says E3 has 5 records). The epoch half is Step 15',
    }],
  },

  // Step 14 — Dataset Hash. MINES-26 in full.
  14: {
    claims: [{
      id: 'MINES-26', coverage: 'full',
      note: 'both dataset files are pinned by SHA-256 as constants in src/loader.ts and enforced by the '
        + 'tests/verify.ts pre-flight BEFORE any step (exit 1 on mismatch, and on absence for the secondary); '
        + 'this step re-asserts BOTH pins as a scored step whose own branch is now FAIL (it was FLAG). '
        + 'Measured: both MATCH. FAIL probed: M14 (wrong master pin with the pre-flight abort removed — the '
        + 'only way to reach this branch)',
    }],
  },

  // Step 15 — Epoch Size. MINES-05 in full (with Step 13).
  15: {
    claims: [{
      id: 'MINES-05', coverage: 'full',
      note: 'the epoch half: 130 primary epochs of exactly EPOCH_SIZE = 50 (both directions FAIL) with '
        + '130 x 50 === 6,500 asserted; and the Phase E epochs — keyed on its own capture timeline — each hold '
        + 'exactly the bets EXPECTED_PHASE_E_EPOCH_SIZES declares for that rotation record (ten of 50, seeds[9] '
        + '49 around the declared capture-retry gap, seeds[10] 1), the table summing to 550 and covering all 17 '
        + 'records. Measured: 0 off-plan. FAIL probed: M15 (one bet moved between seeds[9] and seeds[10])',
    }],
  },

  // Step 16 — Anti-Circularity. MINES-18 in full; the derivation leg of MINES-19 in full.
  16: {
    claims: [
      {
        id: 'MINES-18', coverage: 'full',
        note: 'the survival probability comes from COUNTING: src/exact.ts enumerateSurvivalCounts visits all '
          + '2^25 subsets of the grid and tallies the k-subsets avoiding m given tiles — no binomial formula in '
          + 'the path — and on all 300 cells the count must equal the integer C(25−m,k) (BigInt), the total '
          + 'C(25,k), and the operator formula x the counted survival probability must equal that cell\'s exact '
          + 'row in the RTP table (1 − the edge of the cell\'s first stake tier in E14: 999/1000 on 294 cells, '
          + '0.9986, 0.9982 and 0.9979 on the six full-board cash-outs) EXACTLY in rational arithmetic. The adapter\'s own theoreticalMultiplier and winChance product must agree '
          + 'with the counted values at 1e-12, so a wrong comb() no longer cancels out of the identity. '
          + 'NEGATIVE CONTROLS run every time and FAIL the step if not rejected: the corrupted closed form '
          + 'C(26−m,k) (rejected on 300/300 cells) and a real recomputed layout with one mine moved (refused '
          + 'by the comparator Steps 5/10/17 use). No operator win-chance field is read. FAIL probed: M16 '
          + '(winChance off by one), M16b (comb() off by one)',
      },
      {
        id: 'MINES-19', coverage: 'full',
        note: 'the derivation leg: 1 − P(survive k) x mult(m, k) derived per cell for all 300 cells from the '
          + 'counted survival probability and the declared closed form at the cell\'s first-tier edge, exactly (0 '
          + 'cells off 1 − that edge; 999/1000 on 294 cells), with the '
          + 'float identity\'s widest deviation emitted as the magnitude (2.2e-16 at m=2, k=14) against '
          + 'RTP_DEVIATION_BOUND = 1e-4 (stricter than the profile\'s FLAG). No operator edge field enters it',
      },
    ],
  },

  // Step 17 — Phase D recomputation + predictable-seed disclosure. MINES-06 partial (package-wide).
  17: {
    claims: [{
      id: 'MINES-06', coverage: 'partial',
      note: 'the Phase D half, now HARD FAIL (it was FLAG): all 500 Phase D bets recompute under the client '
        + 'seed actually used (an unrecomputable bet FAILs), >= 2 distinct seeds (10). THE PREDICTABLE-SEED '
        + 'DISCLOSURE, derived from the data: every Phase D seed decodes (\'pfaudit\' + base-36 milliseconds) '
        + 'to a timestamp 0.416–0.463 s before its own rotation record, and the exposed epochs — rotation '
        + 'records 123–132, 500 bets — must equal PHASE_D_PREDICTABLE_EPOCHS, which MANIFEST.md DL-3 '
        + 'publishes; by the capture\'s timestamps each epoch\'s server-seed hash had been recorded as the previous '
        + 'rotation\'s nextServerSeedHash before its client seed existed (shortest lead 1.574 s, seeds[123]). FAIL probed: M17 (the disclosed list omits record 132). Partial for the '
        + 'package-wide reason on Step 6: the A–C generator is Math.random(), not a CSPRNG (DL-1)',
    }],
  },

  // Step 18 — Simulation Pass 1. MINES-20 in full.
  18: {
    claims: [{
      id: 'MINES-20', coverage: 'full',
      note: '24 mine counts x 1,000,000 rounds on PINNED fresh seeds — plan and seeds in src/sim-plan.ts, '
        + 'shared with the simulator, and the artifact bound to them (configs, roundsPerConfig, totalRounds '
        + 'are no longer read from the artifact). STATISTICS RE-DERIVED IN VERIFY from the integer census the '
        + 'artifact now carries (25 tile counts, wins, adjacent win pairs, transitions, end outcomes): '
        + 'mine-position uniformity WITH the without-replacement correction (Pearson x 24/(25−m)), lag-1 '
        + 'autocorrelation, the runs test on the win/loss dichotomy, and RTP; the artifact\'s own figures are '
        + 'cross-checked at 1e-14 + 1e-9 relative (worst gap 2.8e-11) and never scored. REPLAYABLE: the first '
        + '10,000 rounds of every config are replayed from the pinned seeds each run and must reproduce the '
        + 'checkpoint census exactly; `npm run replay` replays all 24,000,000 and every census field. PINNED: '
        + 'outputs/simulation-results.json is in src/artifact-pins.ts, carries no run metadata, and was '
        + 'regenerated on 2026-09-23 with all 1,768 previously pinned leaves identical. Measured: 0/24 below '
        + 'the Bonferroni alpha on the corrected position test (min p 0.0144, m=19), 0/24 serial. Found on '
        + 'the way and disclosed (DL-7): the legacy median-split runs statistic is vacuous (z = 0, p = 1) on '
        + '12/24 configs (every m >= 13); it is no longer scored. FAIL probed: M18 (forged statistic, '
        + 'artifact re-pinned), M18b (pinned seed changed → checkpoint replay fails)',
    }],
  },

  // Step 19 — Simulation Pass 2. MINES-21 in full.
  19: {
    claims: [{
      id: 'MINES-21', coverage: 'full',
      note: 'every revealed seed (130, bound) x 10,000 nonces (SIM_NONCES_PER_SEED), early window = nonces '
        + '0–49 = the captured epoch. TEST C is the profile\'s statistic: the return of the configs the casino '
        + 'ACTUALLY SERVED in that epoch (the 50 captured mine counts by nonce, taken from the dataset in verify '
        + 'and required to equal the row\'s servedConfigs) against the exact per-config mean and variance, '
        + 'standardised per 50-round window; the null is the seed\'s own 199 later windows with the same config '
        + 'sequence — an empirical block-resampling null — p = (1 + rank)/200, lower tail. EVERY WINDOW IS '
        + 'RE-DERIVED in verify from the row\'s win bitmasks, and the early window is REPLAYED from the '
        + 'revealed seed and must equal the win/loss outcomes the casino served in the capture. Pre-registered: '
        + 'flag at p < 0.05 (exact null flag probability 9/200), FAIL above N x 0.045 + 5 sigma + 1 = 18.67. '
        + 'DETECTION POWER printed: 0.464 if 10 % of seeds were picked, 0.9999 at 25 %, ~1 at 50 %. Tests A '
        + 'and B remain, both re-derived (Test B p-values were read from the rows until 2026-09-23; its '
        + '"broad" branch was unreachable until then). "Broad" (a seed off in both its early and late window '
        + 'at p < 0.05) is scored as a COUNT: K broad seeds against Binomial(130, 0.05 x 0.05), FLAG at K >= 2 '
        + '(P = 0.0425), FAIL at K >= 3 (P = 0.0044); one broad seed, which a fair game shows with probability '
        + '0.28 at 130 seeds, does not move the step. Every verdict-moving rule of the step '
        + 'prints its false-alarm rate on a fair game against the 5 % (FLAG) / 1 % (FAIL) caps. Measured: '
        + 'Test C 3/130, Test A 1/130, Test B 7/130, 0 broad. FAIL probed: M19 (forged Test C rank), M19b '
        + '(forged Test B p-value), M19d (three seeds forged broad); FLAG probed: M19c (two seeds forged '
        + 'broad); each with the artifact re-pinned',
    }],
  },

  // Step 20 — Multi-Reveal Multiplier Chain. MINES-17 rung leg; MINES-13 k > 1 arm.
  20: {
    claims: [
      {
        id: 'MINES-17', coverage: 'full',
        note: 'the rung leg: per-step multipliers are recorded (perStepMultipliersRecorded true) and EVERY rung '
          + 'is compared with the exact rational at 1e-12 relative — the 795 safe steps with C(25,k)/C(25−m,k) '
          + 'at their depth, and the 378 MINE steps (skipped until 2026-09-23) with the multiplier standing before '
          + 'the fatal reveal, the formula at k − 1 (exactly 1 at k − 1 = 0); counts bound, deepest k = 5, a '
          + 'missing multiplier FAILs. Measured: 1,173 rungs, worst deviation 9.2e-15. FAIL probed: M20 (one '
          + 'rung moved ~6e-10, dataset re-pinned), M20b (mine-step reference wrong)',
      },
      {
        id: 'MINES-13', coverage: 'full',
        note: 'the k > 1 depth arm: the served multiplier equals the exact closed form at every depth 1..5 on '
          + '795 rungs from (m, k) only, at the 1e-12 relative bound (see Step 8 for why exact equality is not '
          + 'available: the operator\'s double-precision product)',
      },
    ],
  },

  // Step 21 — Mine-Set Invariance Across Reveals. MINES-07 (Phase E); MINES-17 and MINES-10 legs.
  21: {
    claims: [
      {
        id: 'MINES-07', coverage: 'full',
        note: 'the Phase E half: all 550 Phase E layouts recomputed and compared as a set with the served '
          + 'mines_positions, count bound to 550, an unrecomputable bet FAILs. Measured: 550/550',
      },
      {
        id: 'MINES-17', coverage: 'full',
        note: 'mine-set invariance and reveal-ORDER legs: at all 1,173 reveal steps the reported is_mine equals '
          + 'membership in the SEED-DERIVED layout and each step\'s revealed_positions is the exact prefix opened '
          + 'so far; order-independence evidence bound to 11 non-ascending rounds. FAIL probed: M21',
      },
      {
        id: 'MINES-10', coverage: 'full',
        note: 'the per-step leg over the whole Phase E corpus (1,173/1,173 is_mine flags equal the layout)',
      },
    ],
  },

  // Step 22 — Reveal-Position Independence (E5). Position leg of MINES-17; E5 leg of MINES-10.
  22: {
    claims: [
      {
        id: 'MINES-17', coverage: 'full',
        note: 'the reveal-POSITION leg: all 50 E5 bets (bound), which open tiles other than 0 first, recompute '
          + 'and derive their outcome from the recomputed layout. Measured: 50/50. FAIL probed: M22',
      },
      {
        id: 'MINES-10', coverage: 'full',
        note: 'the E5 leg of the recomputed-layout outcome (Step 9 carries all 7,050 rounds)',
      },
    ],
  },

  // Step 23 — Cash-Out Payout Correctness (k > 1). MINES-11, MINES-13 and MINES-17 cash-out legs.
  23: {
    claims: [
      {
        id: 'MINES-11', coverage: 'full',
        note: 'the multi-reveal money leg: all 133 cash-outs at k > 1 (bound) credit amount x the served '
          + 'with-edge multiplier at 1e-12 relative. Measured: 0 errors',
      },
      {
        id: 'MINES-13', coverage: 'full',
        note: 'the cash-out arm: final multiplier AND with-edge multiplier equal the exact rationals at the '
          + 'recorded reached_k (step 9 binds reached_k to the opened count), 1e-12 relative; worst 5.9e-15. '
          + 'FAIL probed: M23',
      },
      {
        id: 'MINES-17', coverage: 'full',
        note: 'the cash-out leg: the settled multiplier at the reached depth equals the formula (133/133)',
      },
    ],
  },

  // Step 24 — Artifact Integrity. MINES-27 in full.
  24: {
    claims: [{
      id: 'MINES-27', coverage: 'full',
      note: 'every artifact the report quotes — rtp-convergence.html, determinism-log.json, '
        + 'chi-squared-results.json, payout-coverage.json, simulation-results.json and '
        + 'verification-results.json — is pinned by SHA-256 in src/artifact-pins.ts, un-ignored by name in '
        + '.gitignore, and re-hashed from the COMMITTED copy (absent or altered = HARD FAIL). NONE carries run '
        + 'metadata: generatedAt and executionTimeMs were removed from the simulation artifact and generatedAt '
        + 'from verification-results.json (the runtime lives in outputs/run/diff.json). A plain verify writes '
        + 'only outputs/run/; committed copies change only under PF_EMIT=1 / npm run simulate. VALUE DOMAINS: '
        + 'every numeric leaf of the five JSON artifacts is held to a domain declared in src/domains.ts with '
        + 'bounds from code, and an UNDECLARED leaf fails like an impossible one (the count is emitted each run; 0 problems); '
        + 'the HTML chart\'s numbers are the convergence series of the domain-checked simulation artifact. '
        + 'Byte identity is asserted for the committed evidence; a regeneration is compared field by field at '
        + '1e-14 + 1e-12 (verify for its own artifacts, src/diff-simulation.ts for the simulation). FAIL '
        + 'probed: M24 (artifact edited without re-pin), M24b (impossible value, artifact RE-PINNED → domain '
        + 'failure)',
    }],
  },

  // Step 25 — Multiplier Monotonicity & Bounds. MINES-14 in full under the proposed rule R2.
  25: {
    claims: [{
      id: 'MINES-14', coverage: 'full',
      note: 'UNDER THE PROPOSED RULE R2, PENDING PROFILE OWNER. Monotonicity half (FLAG policy): over the '
        + 'exact ladder C(25,k)/C(25−m,k) x 999/1000, strictly increasing in k for every m (276 adjacent pairs) '
        + 'and in m for every k (276 pairs), exact rational comparisons; and all 7,107 served multipliers '
        + '(primary and Phase E, rungs and settlements) lie inside the ladder\'s own range [1.040625, '
        + '5,195,099.7]. FLAG probed: M25 (comparator reversed). Cap half: R2 scores "every quoted multiplier '
        + 'within the declared max-odds cap" on what the operator SERVED or SETTLED, and makes it n/a with the '
        + 'evidence cited when the operator declares no cap. Duel declares none in what was checked — '
        + 'src/loader.ts DECLARED_MAX_ODDS = null lists it: no cap-like key in either dataset, none on the '
        + 'captured screens E01-E05, E07, E09-E11; NOT checked: Terms of Service, in-game rules panel, Zero Edge '
        + 'page, E06, E08, the live site other than the mines settings endpoint (E14, fetched 2026-10-05 in a logged-in session: a '
        + 'max-profit limit, no multiplier cap; MANIFEST.md DL-6). The n/a is re-checked every run: Step 25 walks all '
        + '161,440 keys of both datasets and FLAGs if a cap-like field appears while none is declared (FLAG '
        + 'probed: M25c, a meta.maxPayout field added and the dataset re-pinned); with a cap declared every '
        + 'served paid multiplier is held to it and formula cells above it are counted, not failed (FLAG '
        + 'probed: M25b, cap 10x against served 24.975x)',
    }],
  },

  // Step 26 — Live-Sample Fit. MINES-22 in full.
  26: {
    claims: [{
      id: 'MINES-22', coverage: 'full',
      note: 'scored, informational (it was an unscored info block; policy INFORMATIONAL, Mike 2026-09-29: a deviation '
        + 'is INFO — reported, never counted, verdict unchanged): over the 6,500 primary bets, (a) the '
        + 'win rate per mine count against the binomial (24 groups, Bonferroni 0.01/24), (b) the served mine '
        + 'positions per mine count against the uniform lattice with the without-replacement correction, and '
        + '(c) the FIRST-DRAWN mine of every bet against the uniform lattice — the capture records the layout '
        + 'as a set, so the draw order is recovered by recomputing the shuffle (src/rng.ts '
        + 'shuffleTilesFromBuffer, whose sorted prefix is the served layout per Step 5): positions[m − 1] is the '
        + 'first mine placed. Measured: 0 fits deviate; min win-rate p 0.0345, min position p 0.111, first-draw p '
        + '0.938. The PLAYER\'s first pick is tile 0 on every primary bet, so it is not a variable here; Phase '
        + 'E first picks span 25/25 (Step 11). INFO probed: M26 (alpha 0.9)',
    }],
  },
};

/**
 * Checks this casino's design makes inapplicable, each the result of evaluating the profile's
 * `applies` predicate against declarations/duel.mines.json and confirming the declaration's truth
 * against the pinned data (profile rules.applicability / declarationTruth). MINES-24 is NOT here:
 * the declaration sets rng.operatorVerifier.published = true (Duel's in-site Verify tab,
 * evidence/E03-fairness-verify-mines.png; its code copied verbatim 2026-09-25 to evidence/verify-tab/),
 * so that check applies; it is answered below by the ProvablyFair.org site-verifier parity legs of Step 5.
 */
export const NOT_APPLICABLE: Array<{ id: string; reason: string }> = [
  {
    id: 'MINES-16',
    reason: 'applies = { path: money.balanceField, notNull: true } is false — the declaration sets '
      + 'money.balanceField = null. declarationTruth verified today: a key walk over every record '
      + 'of data/mines-master-6500bets.json and data/mines-phaseE-550bets.json (meta, 151 seed '
      + 'records, 7,050 bet records, every nested reveal step) finds NO key matching '
      + '/balance|wallet/i, so there is no consecutive-bet wallet delta to reconcile. What IS '
      + 'verified is the settle-response credit: amount_won on every primary win and every k > 1 '
      + 'cash-out at rel 1e-12 (Steps 7, 10, 23), which the profile does not count as a balance '
      + 'ledger',
  },
];

/**
 * Checks a package artifact answers rather than a scored step. `none` means the check is not
 * answered at all — recorded so the gap is machine-readable instead of merely absent.
 */
export const PACKAGE_CHECKS: Array<{ id: string; artifact: string; coverage: Coverage | 'none'; note: string }> = [
  {
    id: 'MINES-09',
    artifact: 'docs/ALGORITHM.md + tests/mines/RngSpecTests.ts + tests/mines/MinesTests.ts (Second check block) + src/operator-verifier.ts + Step 5 fifth leg',
    coverage: 'full',
    note: 'REWRITTEN 2026-10-20 (v1.2.0). src/rng.ts is rebuilt from a written specification, docs/ALGORITHM.md '
      + '(framework games/mines/ALGORITHM.md), by an implementer who never opened Duel\'s code; Duel\'s published '
      + 'Verify-tab code is run as a second check, not used as the source. Through v1.1.0 src/rng.ts was a port of that '
      + 'code and cited 16 of its lines (OPERATOR_SOURCE_CITES); the port and the citation table are gone. The asserts: '
      + '(1) "unit tests reproduce captured bets from their revealed seeds … against the operator\'s published source" — '
      + 'the Second check block in tests/mines/MinesTests.ts EXECUTES Duel\'s Verify-tab file (copied verbatim by Paulo on '
      + '2026-09-25 from duel.com → Provably Fair → Verify, Expand → Copy, to evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js, '
      + 'SHA-256 88f5268b…, 3,026 bytes; evidence/E03 shows the same panel collapsed) unmodified (src/operator-verifier.ts: '
      + 'pinned SHA-256, child-process runner verifier-parity/operator/run-operator-verifier.cjs, the file\'s own '
      + 'generateMinesPositions) on all 7,050 captured rounds of both datasets and requires its mine set to equal the '
      + 'served mines_positions and src/rng.ts computeMinePositions: 7,050/7,050, 0 differ; (2) "fixed vectors" — the '
      + 'same block requires the operator code to return the 7 known-answer layouts (server seed b255e0f5…, client seed '
      + 'EveJlkDtA24dfvBr, nonces 0-6), and tests/mines/RngSpecTests.ts runs the spec\'s own vectors and properties '
      + 'against src/rng.ts (115/115); (3) "the adapter cites the operator source line it ports" — superseded for this '
      + 'package by the 20 Oct 2026 rule that RNG code is rebuilt from a written spec: nothing is ported, so no operator '
      + 'line is cited; docs/ALGORITHM.md §4 names the source of every step instead (Duel\'s public pages, the standard '
      + 'construction, or the 7,050 live rounds). Step 5 (fifth leg) runs the same execution in the verifier and FAILs on '
      + 'a hash mismatch, any disagreement or a round count other than 7,050. FAIL probed: M05f (a comment of the operator '
      + 'file changed without a re-pin → hash mismatch), M05g (the file\'s HMAC digest byte order reversed AND re-pinned → '
      + 'layouts disagree). Known differences between src/rng.ts and Duel\'s file, on inputs no captured round reaches '
      + '(0 rejected chunks in the captured draws): for ranges 2, 4, 8, 16 src/rng.ts accepts every chunk where Duel\'s '
      + 'file rejects the top r values (both exactly uniform), and when all eight chunks of a digest are rejected src/rng.ts '
      + 'throws (spec O1) where Duel\'s file moves to the next cursor (MANIFEST.md DL-11, premise P1). What this does NOT '
      + 'establish: that the Verify button runs exactly the code the panel shows, or that Duel\'s server runs it '
      + '(MANIFEST.md DL-4, premise P2)',
  },
  {
    id: 'MINES-23', artifact: 'MANIFEST.md#verification-results (S5-MATRIX block)', coverage: 'full',
    note: 'MANIFEST "Verification results" carries the framework\'s standardized matrix between S5-MATRIX markers: the '
      + 'eight rows S5-1 … S5-8 in the methodology\'s order (replay protection, input validation, seed '
      + 'integrity under adversarial input, cross-player isolation, payout field integrity, nonce sequence '
      + 'enforcement, parameter boundary enforcement, game-specific state), each with a Pass / Flag / Hard '
      + 'Fail / Not tested result and tied to the steps and the capture. All eight are "Not tested": the '
      + 'capture recorded normal play and sent no adversarial request, which each row states with what the '
      + 'data does show (MANIFEST.md DL-10). The ten offline consistency checks keep their own ids EC-1 … '
      + 'EC-10 (they were S5-01 … S5-10, which collided with the framework ids). The profile floor — every '
      + 'matrix test executed — needs a new, deliberate probe capture',
  },
  {
    id: 'MINES-24',
    artifact: 'verifier-parity/ + src/site-verifier.ts + src/live-site-verifier.ts + Step 5 (docusaurus and live-site legs) + scripts/check-site-verifier.mjs [--live]',
    coverage: 'full',
    note: 'TWO site verifiers are pinned and executed. (1) DOCUSAURUS: the site verifier the profile names — the ProvablyFair.org VerifyBets component\'s '
      + 'games/mines/derive.js and the one file it imports, lib/hmac-sha256.js — is HASH-MATCHED and '
      + 'EXECUTED: the package records both SHA-256 (src/site-verifier.ts SITE_VERIFIER_PINS: derive.js '
      + '2321b23c…, hmac-sha256.js bc30bfe9…, re-vendored 2026-09-25 from the site\'s origin/main @ bd4d59c; the earlier repotree-sync @ 2ad89bc bytes differed only in the source-URL comment) and holds byte-exact copies in verifier-parity/; Step 5 FAILs '
      + 'unless the copies hash to the pins, then runs the site\'s own deriveMines on every captured round '
      + 'with a revealed seed — 7,050, bound to EXPECTED_BETS + EXPECTED_PHASE_E_BETS — and FAILs on any '
      + 'layout that differs from src/rng.ts computeMinePositions. Measured: 7,050/7,050, 0 mismatches. '
      + 'scripts/check-site-verifier.mjs <site derive.js> compares a site checkout with the pins (exit 1 on '
      + 'any difference, on a changed import set, or with no argument); run 2026-09-25 against '
      + 'the site\'s origin/main @ bd4d59c (files read with git cat-file): both '
      + 'MATCH, exit 0. FAIL probed: M05b (one logic line of the vendored derive.js changed AND re-pinned → '
      + 'layouts disagree), M05c (a byte changed without re-pin → hash mismatch). (2) LIVE SITE: the page a '
      + 'player opens, https://www.provablyfair.org/verify-bets (a Next.js build, source not available to this '
      + 'audit), GET 2026-09-24: the three chunks the Mines derivation needs (Turbopack runtime '
      + 'turbopack-828b80f5…, page chunk 34934e0e… carrying module 7721 → verifyDuelsGame, process-shim chunk '
      + '4f34301b…) are vendored byte for byte in verifier-parity/live-site/chunks/ and pinned with the '
      + 'runner in src/live-site-verifier.ts LIVE_SITE_PINS; Step 5 runs the site\'s OWN code (its Turbopack '
      + 'runtime instantiates the page module; the page\'s React/UI modules are inert stand-ins, none in the '
      + 'verifier\'s closure) on the same 7,050 rounds with the call the page\'s Verify button makes and FAILs '
      + 'on any mine set that differs from src/rng.ts. Measured: 7,050/7,050, 0 mismatches. '
      + 'node scripts/check-site-verifier.mjs --live re-downloads the page and each pinned chunk (GET) and '
      + 'compares hashes; run 2026-09-24: 3/3 MATCH, exit 0. FAIL probed: M05d (the vendored page chunk\'s '
      + 'Duel Mines line changed AND re-pinned → layouts disagree), M05e (a byte changed without re-pin → '
      + 'hash mismatch). The two site verifiers were also compared with each other in a scratch harness on '
      + 'the 7,050 rounds: 0 disagreements. Duel\'s OWN Verify-tab code (the declaration\'s rng.operatorVerifier) '
      + 'is a third verifier: copied 2026-09-25 and executed on the same 7,050 rounds by Step 5\'s fifth leg (MINES-09, '
      + '0 disagreements); pasting rounds into the live Verify tab itself was not done (MANIFEST.md DL-4, premise P2)',
  },
  {
    id: 'MINES-25',
    artifact: 'MANIFEST.md#verify-a-bet',
    coverage: 'full',
    note: 'MANIFEST "Verify a bet" states, in order: where the seed is revealed (the Provably Fair panel shows only '
      + 'serverSeedHashed and the nonce, and the player saves that hash before the first bet on a seed; after '
      + 'Rotate seed the bet\'s transaction detail carries the plaintext '
      + '— the capture read every revealed seed from /api/v2/user/transactions/{id}), which fields to copy '
      + '(serverSeedHashed, clientSeed, nonce, mines_count, mines_positions, revealed_positions, outcome, '
      + 'serverSeed — the declaration\'s names), the commitment encoding (SHA-256 of the hex-DECODED 32 bytes, '
      + 'compared with the saved hash: hash equality, with the timing assurance coming from the player\'s own '
      + 'pre-bet copy), the shuffle, and the tile numbering (0-based, 0–24). Its pasteable script was run on '
      + '2026-09-23 against a captured round (epoch eecc6f36…, nonce 0, 14 mines): committed true, matches true; '
      + 'its hash field was renamed hashMatches on 2026-10-05 and the script re-run on the same round: '
      + 'hashMatches true, matches true',
  },
  {
    id: 'MINES-28',
    artifact: 'verify.js + test.js + standalone-manifest.json + scripts/ + package.json + .nvmrc + MANIFEST.md',
    coverage: 'full',
    note: 'ZERO-INSTALL: verify.js and test.js are generated from the TypeScript by scripts/build-standalone.mjs '
      + '(ported from LIQD Mines) and run on bare Node 22 with no node_modules; scripts/check-standalone.mjs '
      + 'refuses a bundle that drifted from its sources. `npm test` = check-standalone → unit-parity → node '
      + 'verify.js, so a fresh clone needs no install to verify. TEST-COUNT PARITY: scripts/unit-parity.mjs '
      + 'requires the zero-install unit count to equal both MANIFEST.md\'s stated count and the Mocha count, '
      + 'and fails on any skipped or cancelled test. AUDIT ID: AUDIT_ID = PF-2026-DL04 is a constant in '
      + 'src/loader.ts and is emitted into outputs/verification-results.json. REGENERATION DIFFED: '
      + '`npm run test:full` re-simulates into outputs/run/ and src/diff-simulation.ts compares the result '
      + 'with the committed artifact field by field (integers and strings exact, 1e-14 + 1e-12 otherwise), '
      + 'recording the runtime in outputs/run/diff-simulation.json. Step counts: 26 in README.md, MANIFEST.md '
      + 'and the suite. Runtime pinned (engines 22.x, .nvmrc). The verdict line is PROVABLY FAIR — Full Pass '
      + 'with 25/26 PASS and one capture-origin FLAG (Step 4, DL-2), exit 0',
  },
  {
    id: 'MINES-29',
    artifact: 'tests/mutations.json + tests/survivors.json + tests/mutations.ts (npm run mutate)',
    coverage: 'full',
    note: 'a step-named registry run in disposable temp copies (tests/mutations.ts, ported from LIQD with '
      + 'multi-file `edits`): 47 must-fail entries, each with the result it must produce: 36 turn their named '
      + 'step FAIL, 7 turn it FLAG (M11, M19c, M25, M25b, M25c with Conditional Pass; MC3a, MC3b with RTP FIGURE '
      + 'OVERSTATED, exit 5), M26 must leave Step 26 at INFO with the verdict unchanged, and 3 name no step (M27 '
      + 'must fail the unit suite; MC3as and MC3bs must exit 1 with the committed RTP table reported as '
      + 'differing). Every one of the 26 scored steps is reached BY NAME by at least one entry — the runner '
      + 'fails an entry whose verdict flips through a different step, and fails the gate if any step has none. The FORGED-EVIDENCE battery is in the same registry: M01, M02, '
      + 'M07, M08, M20, M25c forge a dataset AND re-pin its SHA-256 as a forger would; M18, M19, M19b, M19c, M19d, M24b forge '
      + 'the simulation artifact AND re-pin it; M05b and M05d forge the vendored docusaurus and live-site verifiers AND re-pin them; M24, '
      + 'M05c and M05e edit an artifact without re-pinning; added 2026-09-25 for the operator\'s own Verify-tab code '
      + '(MINES-09): M05g forges it AND re-pins it, M05f edits it without re-pinning (M05h, which broke a src/rng.ts '
      + 'citation, was retired on 20 Oct 2026 with the citation table; M05, M06, M16, M16b and M27 were retargeted to the '
      + 'rebuilt src/rng.ts). Three declared '
      + 'survivors in tests/survivors.json, each tied to a limitation id (DL-11, DL-5, DL-6)',
  },
  {
    id: 'MINES-30',
    artifact: 'MANIFEST.md#limitations-and-trust (Declared Limitations DL-1 … DL-11, Load-Bearing Premises) + MANIFEST.md#evidence (E01-E14)',
    coverage: 'full',
    note: 'MANIFEST.md carries the declared-limitations register DL-1 … DL-11, each row with its measured '
      + 'magnitude and its closure evidence (the step or artifact that binds it, or what would close it), and '
      + 'a Load-Bearing Premises table marking the unwitnessed premises ASSUMED (P1 where no captured round reaches '
      + '(all eight chunks rejected; the top values of a power-of-two range) the operator\'s server draws as its published code does, P2 the Verify button runs the code its panel shows, P3 the API '
      + 'tile numbering is the board the player sees, P7 the capture is a faithful record of what Duel served and '
      + 'when, on which the pre-bet timing of the commitments rests) beside the witnessed ones; MANIFEST Evidence numbers every exhibit '
      + 'E01-E14 with a file '
      + 'and a role; no internal QA folder ships (`ls` finds no results/ directory and no .pf-* file)',
  },
];

/** The block emitted alongside the step results. */
export function profileCoverageBlock(): Record<string, unknown> {
  return {
    game: PROFILE_GAME,
    profileVersion: PROFILE_VERSION,
    notApplicable: NOT_APPLICABLE,
    packageChecks: PACKAGE_CHECKS,
  };
}

/** The label fields for one scored step, to be merged into its emitted record. */
export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: entry.claims.map(c => c.id), profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}
