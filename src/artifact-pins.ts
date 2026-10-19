/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * WHAT IS PINNED, AND WHY NOT THE REST.
 *
 * - outputs/rtp-convergence.html and outputs/simulation-results.json — written by `npm run simulate`
 *   (PF_EMIT=1) and by nothing else; the reproduction gate in tests/verify.ts does not produce them.
 *   The simulation artifact carries no run metadata (`generatedAt` and `executionTimeMs` were
 *   removed, see src/simulate.ts), so a regeneration that changes no figure reproduces its bytes.
 *   Steps 18-19 score its contents; `npm run test:full` diffs a regeneration field by field.
 * - outputs/determinism-log.json, outputs/chi-squared-results.json, outputs/payout-coverage.json —
 *   the verifier's own derived artifacts. They carry NO run timestamp (see tests/verify.ts), so a
 *   regeneration that changes no figure reproduces the pinned bytes exactly, and a regeneration
 *   that changes a figure changes the hash — which is the point.
 * - outputs/verification-results.json is pinned too, although Step 24's own result is a field inside
 *   it: its pin is set by emitting (PF_EMIT=1), pinning and emitting again until the pin is a fixed
 *   point (MANIFEST.md, "Artifacts of record"). The field-level reproduction gate compares every leaf
 *   of it with the run as well.
 *
 * Regenerating an artifact legitimately means re-pinning it here, in the same commit, with the
 * run that produced it:  shasum -a 256 outputs/<file>
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'rtp-convergence.html':
    '4d5cadeca0ab206d0788b2f4bf59355bf61d757c31a33e10e3acee5d98559424',
  'determinism-log.json':
    '12c39c309bbb7539e2ae8756923f8b7caaa560e9dfe0bc4c18f744fbfaa1497a',
  'chi-squared-results.json':
    'c73aa5b90fc626c65c439eef964a3d3c795ae8d4b43515ee6d8023e16b569daf',
  'payout-coverage.json':
    'afc216a49f5176a634731b5ef2bb0324447d80af1f638681512f2434303ec46d',
  // RE-PINNED 2026-10-19: regenerated with `npm run simulate` after the Pass 1 description stopped
  // calling src/rng.ts an independent implementation (it is ported from Duel's Verify-tab code,
  // decision 1). Of the artifact's 36,301 leaves only that description changed; the chart is
  // byte-identical. Previous pin d8977f86….
  'simulation-results.json':
    'b6ce72390eaa5159d3c770ca96e6e4bd1b9d04dc03a11e453b00dd6c23f1de87',
  // RE-PINNED 2026-10-19: re-emitted (PF_EMIT=1) after Mike's 19 Oct QA: Step 16 holds each cell to
  // its own first-tier edge (new data field cellsAboveBaseTier: 6), Step 8 also scores the 39 Phase E
  // depth-1 wins (data field phaseEWinsDepth1), Steps 1 and 3 and the MINES-01/03/11/13/18/19/29 notes
  // reworded. No step result, figure or verdict changed. Previous pin 90f8b791….
  // RE-PINNED 2026-10-14 (second time): re-emitted (PF_EMIT=1) after FIXPASS2 class C3: Step 16's exact
  // identity holds formula × counted survival to the RTP table's exact row instead of the claimed
  // 999/1000, so a cell that pays less is scored by RTP-CLAIM (RTP FIGURE OVERSTATED, exit 5), not
  // failed here. Changed: the Step 16 detail line only; no step result, figure or verdict changed.
  // Previous pin 6f5d99ff… (2026-10-14, below).
  // RE-PINNED 2026-10-14: re-emitted (PF_EMIT=1) under Methodology v1.1: the Mines profile is cited as
  // 1.0.2 (decision D6, the -draft suffix dropped). Changed: profileCoverage.profileVersion only; no
  // step result, figure or verdict changed. Previous pin b3819a48… (2026-10-06, below).
  // RE-PINNED 2026-10-06: re-emitted (PF_EMIT=1) after (a) the MINES-04 note stopped citing the
  // round_id jump as DL-2 evidence on its own (round_id is not a per-player counter; the attribution
  // is inferred) and the E14 informational item wrote its tier rule with the formula multiplier
  // instead of "paid multiplier" (E14 holds no multiplier), and (b) Step 19's "broad" rule became a
  // count rule (K seeds off in both windows against Binomial(130, 0.05 x 0.05): FLAG at K >= 2, FAIL
  // at K >= 3) and the step began printing the false-alarm rate of each verdict-moving rule.
  // Changed: the MINES-04 note, the E14 informational item, the Step 19 detail line and data block,
  // the MINES-21 and MINES-29 notes; Step 19 stays PASS (0 broad), no other step result, figure or
  // verdict changed. Previous pin caec86b2… (2026-10-06, change (a) alone), before it 9e4bb663…
  // (2026-10-05, fourth time: re-emitted (PF_EMIT=1) after the commitment-timing wording was
  // narrowed: hash matches and forward links are consistency checks, pre-bet timing rests on the
  // capture's records (premise P7). Changed: the Step 2 and Step 17 detail lines and the MINES-06,
  // MINES-25 and MINES-30 notes; no step result, figure or verdict changed), before it 463ea3d0…
  // (2026-10-05, the scope of every E14 statement set to "the duel.com config as fetched 2026-10-05
  // in a logged-in session (read-only GET)": the MINES-14 note and the label of the E14
  // informational item), before it daa2010e… (2026-10-05, the mines settings saved as evidence E14: the MINES-14 note
  // cites E14, MINES-30 numbers E01-E14, and two informational items from src/scaling-edge.ts were
  // added under `info`), before it 31e0b15d… (2026-10-05, MINES-14 note named the settings
  // endpoint), before it 8aead87e… (2026-10-04, docs consolidated into README.md + MANIFEST.md),
  // before it 9d5ded55… (2026-09-29, MINES-22 informational), before it 65f0afb7….
  'verification-results.json':
    '3d4a24a990a3966ea693ec26b106ca735d3f6ebca0ba62c21fa379323db7b045',
});
