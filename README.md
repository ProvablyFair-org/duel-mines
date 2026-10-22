# Duel Mines — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** PF-2026-DL04 · **Release:** `v1.2.2` · **Capture:** April 2026

**Result: PROVABLY FAIR — Full Pass.** Every mine layout in the 7,050-bet dataset (6,500 primary + 550 Phase E) reproduces from (serverSeed, clientSeed, nonce). The suite runs 26 scored verification steps: 25 PASS, one capture-origin FLAG and zero hard fails. The flag is a single Phase E nonce with no captured round, attributed on the evidence in DL-2 to a capture request that failed after the round was placed (inferred, not witnessed); it is disclosed and verdict-neutral, and Step 4 found no other nonce gap.

**Scope:** Live play on Duel.com Mines from one test account in April 2026: five phases, all 24 mine counts, stakes of $0.01 and $10, one revealed tile per round in Phases A–D and multi-reveal rounds up to k=5 in Phase E. Theoretical RTP is **99.9000% at Duel's 0.1% base edge**, for every mine count and depth: on all 300 (mines, reveals) payout cells the multiplier formula × the counted survival probability equals 999/1000 exactly at that edge. Duel's settings price 294 cells from the 0.1% tier; the six full-board cash-outs (10–15 mines) have no 0.1% tier and return 99.86%, 99.82% or 99.79% at their first tier ([RTP claim](MANIFEST.md#rtp-claim)). Above $25,000 potential profit at the current tile, Duel's [scaling edge](MANIFEST.md#scaling-edge) raises the edge to at most 1.0%, in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET; [E14](MANIFEST.md#evidence)). Every captured bet was in the 0.1% tier; what the server pays above it was not observed. The live-sample return illustrates variance only, and no adversarial request was sent to the API.

## What was verified

| Check | Captured evidence |
|---|---|
| Mine layouts | 7,050 of 7,050 reproduced: 6,500 primary (Step 5) and 550 Phase E (Step 21); 0 mismatches. The RNG code, `src/rng.ts`, was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Duel's published Verify-tab code ([E13](MANIFEST.md#operator-source-and-verifier-copies)) is run as a second check, not used as the source |
| Payouts | 0 errors on the 6,500 primary bets and 417 further Phase E rounds (Step 7), and on 133 Phase E cash-outs at k>1 (Step 23) |
| Multipliers | 2,795 primary wins and 39 Phase E wins settled at depth 1 (Step 8), 133 Phase E cash-outs at k>1 (Step 23) and 1,173 Phase E reveal steps (Step 20) match the exact rational C(25,k)/C(25−m,k) (× 999/1000); 0 mismatches |
| Seed records | 134 primary + 17 Phase E records; 133/133 and 16/16 commitment links recomputed from the raw hashes |
| Configurations | 24/24 mine counts; 33 of 300 (mines, reveals) payout cells reached in live play |
| Theoretical RTP | 99.9000% on all 300 cells at the 0.1% base edge, proven by counting all 2^25 tile subsets, with no casino-supplied probability; at the first stake tier of Duel's settings, 99.9000% on 294 cells and 99.79–99.86% on the six full-board cash-outs; Duel's scaling edge raises the edge to at most 1.0% above $25,000 potential profit (settings as fetched 2026-10-05 in a logged-in session, [E14](MANIFEST.md#evidence)) |
| Observed return | 100.86% over the 6,500 primary bets; reported separately from theoretical RTP |
| Simulation | 24,000,000 Pass 1 rounds across 24 mine counts (mean RTP 99.9041%); Pass 2 on 130 revealed casino seeds × 10,000 nonces |
| Player verification | The ProvablyFair.org site verifier, the live verify-bets bundle and Duel's own Verify-tab code (the second check), each executed on all 7,050 rounds; 0 mismatches |

The declared limitations DL-1 … DL-11, the assumed premises (P1–P3, and P7: the capture is a faithful record, on which the pre-bet timing of the commitments rests), residual operator trust in seed selection and the untested adversarial rows are kept in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Open a terminal in the package directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json). Nothing needs installing: `verify.js` and `test.js` are dependency-free bundles generated from the TypeScript.

```sh
npm test                          # or, with no npm at all: node test.js && node verify.js
```

Expected: **32 unit tests pass; 25 PASS + 1 capture-origin FLAG; zero hard fails; PROVABLY FAIR — Full Pass; REPRODUCED; exit 0.** `npm test` first checks that the bundles are the build of today's sources, then scores the committed simulation artifact instead of re-simulating. The exit code is the verdict: `0` PROVABLY FAIR — Full Pass · `2` PROVABLY FAIR — Conditional Pass · `5` RTP FIGURE OVERSTATED (the RTP-CLAIM rule 1.2.0 found a published RTP figure above the game's real RTP; the draws pass) · `1` NOT PROVABLY FAIR, or a reproduction difference.

**RTP claim (RTP-CLAIM 1.2.0, switched on).** Each of the 300 mine-count and cash-out cells is held to its own band, as in the Keno package: 1 − the house edge Duel's game settings state for the cell's first stake tier. That is 99.9% on 294 cells (house_edge 0.001; effective_edge 0.1 on all 6,500 bets) and 99.86%, 99.82% or 99.79% on the six full-board cash-outs (10–15 mines), which have no 0.1% tier. Scored on Step 16: PASS, 0 of 300 cells beyond their 0.1 pp band; true minimum 99.79% (12 and 13 mines, full board), true maximum 99.90% ([table](outputs/rtp-claim-table.json)); the higher stake tiers are not tabled.

```sh
npm ci                            # the toolchain only: Mocha, re-simulation, mutation battery
npm run test:full                 # optional: re-simulates into outputs/run/ (about 15 minutes) and diffs it field by field
node scripts/release-manifest.mjs --check
```

Ordinary runs write only to `outputs/run/` and leave the evidence of record intact. See [reproduction details](MANIFEST.md#reproduce-the-audit) for the gate, exit codes, mutation battery and the deliberate artifact-refresh procedure.

## Verify a bet

Before your first bet on a seed, save the server seed hash the Provably Fair panel shows. Rotate your seed to reveal the server seed, check that it hashes to the value you saved, then use the [ProvablyFair.org verifier](https://www.provablyfair.org/verify-bets) or follow the [complete verification instructions](MANIFEST.md#verify-a-bet). A hash PASS means hash equality: the revealed seed is the one behind that hash. The assurance that it was fixed before your bets comes from your own copy, saved before you played. The instructions cover where the seed is revealed, which fields to copy, the commitment encoding, the shuffle and the 0-based tile numbering, with a script you can paste.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The overview contains the game rules, algorithm, RTP proof, verification results, evidence, limitations and release history.

- [Primary dataset](data/mines-master-6500bets.json) — 6,500 bets (Phases A–D), SHA-256 `331f74ff98b88d06242d57e806186548612f13c4269eb754ebb571d8a6fc9b20`.
- [Phase E dataset](data/mines-phaseE-550bets.json) — 550 multi-reveal bets, SHA-256 `def563907949db10d584256a13b33102dfa46d33509424f642f803d74cd1b17b`.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json), [payout coverage](outputs/payout-coverage.json), [simulation results](outputs/simulation-results.json) and [release manifest](RELEASE-MANIFEST.json).
- [Audit report](https://audit.provablyfair.org/casino/duel/games/mines/overview) · [Public repository](https://github.com/ProvablyFair-org/duel-mines) · [MIT license](LICENSE).

The release's changes and the documentation consolidation are recorded in the [release history](MANIFEST.md#release-history).
