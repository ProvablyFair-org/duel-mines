# Duel Mines — Consolidated Audit Overview

**Audit ID:** PF-2026-DL04 · **Auditor:** ProvablyFair.org · **Release:** `v1.2.0` · **Framework:** 1.1

Audit date: April 2026. Publication date: 4 June 2026. Audit report: https://audit.provablyfair.org/casino/duel/games/mines/overview. This overview consolidates the package documentation; the machine-readable release identity is in [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass.** Duel.com Mines passed 25 of 26 scored verification steps with no hard fail and no verdict-affecting flag. Every mine layout in the 7,050-bet dataset (6,500 primary + 550 Phase E) was reproduced from (serverSeed, clientSeed, nonce) by `src/rng.ts`, a backward Fisher-Yates shuffle with HMAC-SHA256 rejection sampling rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code, and, as a second check, by Duel's published Verify-tab code run unmodified ([Operator source](#operator-source-and-verifier-copies)): zero mismatches. The one FLAG is capture-origin: Step 4 found a single Phase E nonce (12, in the epoch under server-seed hash `d6ff34bb…`) with no captured round, which the evidence attributes to a capture request that failed after the round was placed (inferred, not witnessed). It is declared with its evidence as DL-2, disclosed on every run and verdict-neutral under the framework's FLAG policy.

Win condition, multiplier and payout were verified for all 6,500 primary bets and for every Phase E reveal step and cash-out, including multi-reveal sequences (k=1–5), with credited money held to a relative 1e-12. Every revealed server seed in both datasets hashes to its commitment, and each of the 133 + 16 rotation links matches the next-seed hash recorded at the previous rotation. Both are consistency checks; that each commitment was shown before its bets rests on the capture's recorded pre-bet observations ([Limitations and trust](#limitations-and-trust)).

**Theoretical RTP is 99.9000% at Duel's 0.1% base edge, for every mine count and reveal depth.** On all 300 reachable (mines, reveals) cells the operator formula × the survival probability counted over all 2^25 tile subsets equals 1 − the edge exactly (999/1000 at the base edge), using no casino-supplied data. In Duel's settings (E14), 294 cells start at the 0.1% tier; the six full-board cash-outs (10–15 mines, every safe tile revealed) have no 0.1% tier, and at their first tier they return 99.86% (10 and 15 mines), 99.82% (11 and 14) and 99.79% (12 and 13). Each cell is scored against its own band ([RTP claim](#rtp-claim)). Above $25,000 potential profit at the current tile, Duel's scaling-edge settings, in the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET; E14), raise the edge to at most 1.0%; every captured bet was in the 0.1% tier, and what the server pays above it was not observed ([Scaling edge](#scaling-edge)). The 24,000,000-round simulation at the base edge agrees (mean RTP 99.9041%). The live-sample return over the primary bets, 100.86%, illustrates variance only (DL-9).

The dataset comes from a single test account, and no adversarial request was sent to the API (DL-10). No external randomness beacon participates, so seed selection by the operator before commitment remains residual trust; the Pass 2 seed-selection tests found no evidence of it. These are scope boundaries and structural properties, not defects; they are recorded under [Limitations and trust](#limitations-and-trust).

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

Live bet data was collected by browser session interception during active play on Duel.com Mines, using a test account funded by ProvablyFair.org. API responses were recorded in five structured phases:

| Phase | Bets | Stake | Mine count | Purpose |
|---|---:|---:|---|---|
| A | 4,800 | $0.01 | All 24 (1–24, 200 each) | Baseline: full mine-count coverage |
| B | 1,000 | $0.01 | 24 (fixed) | High-mine-count statistical validation |
| C | 200 | $10.00 | 12 (fixed) | High-stake payout and bet-size invariance |
| D | 500 | $0.01 | All 24 (1–24) | Custom client seed variation (10 seeds) |
| E | 550 | $0.01 | 2, 3, 4, 5, 8, 12, 15 | Multi-reveal verification (k=1–5; 1,173 reveal steps, 133 cash-outs at k>1) |
| **Total** | **7,050** | | | |

Each bet record stores the request (`amount`, `mines_count`), the response (`round_id`, `outcome`, `mines_positions`, `revealed_positions`, `multiplier`, `no_house_edge_multiplier`, `amount_won`, `amount_currency`, `transaction_id`, `effective_edge`) and the seed commitment (`serverSeedHashed`, `clientSeed`, `nonce`). The 50-bet seed epochs are this capture's rotation interval, not a Duel rule: the capture made every rotation itself, with `POST /api/v2/client-seed/rotate`, at each phase start and end and after every 50 bets in an epoch (`BETS_PER_EPOCH = 50` in both capture reference records). Duel did not rotate a seed on its own in this capture: all 7,050 served mine layouts recompute from their epoch's revealed seed at the recorded nonce (Steps 5 and 21), and that nonce starts at 0 in each of the 142 bet-bearing epochs and never resets within one. The primary capture holds 134 seed records: 130 epochs with live bets and 4 rotation records with no bets (3 phase-end rotations that immediately precede a phase-start rotation, and the closing rotation that reveals the final Phase D seed). Phase E holds 17 seed records. Primary `seeds[0].serverSeed` holds that record's own seed (`b255e0f5…`, byte-identical to `seeds[1]`'s reveal of it) and was added after the capture: the capture script, as its reference record gives it, writes `serverSeed: null` on every rotation record (`capture/mines-capture.reference.js` line 366) and fills it only from the transaction of the previous epoch's last bet (lines 380–384), which the first rotation does not have (`lastTxId` starts null, line 97). The step that added it is not in the reference record, which calls an export (`pub.save`, line 207) but does not define it. The record's `at`, `01:43:43.754Z`, dates its rotation-response fields (commitment, next commitment, client seed), not that seed. No step reads it: Step 1 starts at `seeds[1]`, and the seed map takes each record's plaintext from the next record. Phase E `seeds[0].serverSeed` is null, as the script writes it.

| Input | Identity |
|---|---|
| [data/mines-master-6500bets.json](data/mines-master-6500bets.json) | 6,500 Phase A–D bets, SHA-256 `331f74ff98b88d06242d57e806186548612f13c4269eb754ebb571d8a6fc9b20` |
| [data/mines-phaseE-550bets.json](data/mines-phaseE-550bets.json) | 550 Phase E bets (evidence E12), SHA-256 `def563907949db10d584256a13b33102dfa46d33509424f642f803d74cd1b17b` |

Both datasets are hash-pinned in `src/loader.ts` and checked at startup before any step runs. The population of each (bet, seed, epoch and per-phase counts) is pinned there as code constants that the verifier asserts against, so a dataset that agrees only with its own header does not pass.

The capture methodology is published as [capture/mines-capture.reference.js](capture/mines-capture.reference.js) and [capture/mines-capture-phaseE.reference.js](capture/mines-capture-phaseE.reference.js): reference records of the scripts that produced `data/`, not runnable tools. These two `.reference.js` records are the only capture files in this package. The runnable capture tools are kept in ProvablyFair.org's private workshop and are not published, because they place bets on duel.com: neither the runnable versions that produced `data/` nor the next capture's scripts (`mines-capture.js` v6 and `mines-capture-phaseE.js` v2, not yet run; [Scope boundaries and next capture](#scope-boundaries-and-next-capture)) are in this package. The capture generated the Phase A–C client seeds with `Math.random()` (DL-1) and the ten Phase D seeds as `'pfaudit' + Date.now().toString(36)` (DL-3). The primary capture used auto-bet: each round reveals tile 0 and either cashes out or hits a mine (DL-8).

Phase E used the step-by-step API (start → reveal → … → cashout). Higher mine counts and deeper chains have exponentially lower survival `P = C(25−m,k)/C(25,k)`, so target k and bet counts were tuned for at least 14 full completions per sub-phase:

| Sub-phase | Mines | Reveals (k) | Bets | Survival | Completions | Rationale |
|---|---:|---:|---:|---:|---:|---|
| E1 | 3 | 5 | 100 | 49.6% | ~45 | Low mines, deep chain: five multiplier points per completion |
| E2 | 5 | 3 | 100 | 49.6% | ~49 | Mid mines: the formula changes correctly as m increases |
| E3 | 12 | 3 | 200 | 12.4% | ~25 | Reduced from k=5 (2.4% survival); chain 1.92× → 3.84× → 8.03× |
| E4 | 15 | 2 | 100 | 15.0% | ~14 | Changed from m=20 (3.3% survival); chain 2.50× → 6.66× |
| E5 | 2, 4, 8, 15 | 1 | 50 | — | — | Tiles [3,7,11,17,23]: reveal-position independence |

Losses are equally useful: each one exposes the full mine layout, so it supplies mine-set invariance data even when the target k is not reached.

## Game and algorithm

The player selects a mine count (1–24) hidden on a 5×5 grid of 25 tiles and reveals tiles one at a time. A safe tile lets the player cash out at the current multiplier or continue; a mine ends the round as a loss. Tiles are indexed 0–24. Parameters: `mines` (1–24), `amount` (stake in USD), `revealed_positions` (tile indices 0–24).

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/v2/client-seed` | Fetch the current seed commitment |
| `POST` | `/api/v2/mines/start` | Start a round |
| `POST` | `/api/v2/mines/reveal` | Reveal a tile |
| `POST` | `/api/v2/mines/cashout` | Cash out the current round |
| `POST` | `/api/v2/client-seed/rotate` | Rotate seeds (reveals the previous server seed) |
| `GET` | `/api/v2/user/transactions/{txId}` | Retrieve the revealed server seed after rotation |

### Commitment and shuffle

The server seed is a 64-character hex string (32 bytes). Its commitment is `SHA-256(hexDecode(serverSeed))`, published as `serverSeedHashed` before any bet in the epoch and revealed after rotation. The HMAC key is the hex-decoded bytes, not the UTF-8 text: `Buffer.from(serverSeed, 'utf-8')` produces different mine positions for all 7 test vectors checked, and only the hex-decoded key matches the live results.

```
key = hexDecode(serverSeed)
a   = [0, 1, ..., 24]

for i from 0 to 23:                       # draw i, cursor = i
    r      = 25 - i                       # 25, 24, ..., 2
    LIMIT  = floor(2^32 / r) * r
    digest = HMAC-SHA256(key, clientSeed + ":" + nonce + ":" + i)
    for each 4-byte chunk of digest, first to last:
        v = the chunk as an unsigned 32-bit big-endian integer
        if v < LIMIT: j = v mod r; stop
    (all eight chunks rejected: not specified, spec O1; src/rng.ts stops with an error)
    swap a[r - 1], a[j]

mines = a[0..mineCount-1] sorted
safe  = a[mineCount..24]
```

This is the algorithm as [docs/ALGORITHM.md](docs/ALGORITHM.md) §2 writes it; `src/rng.ts` implements it, and §4 there names the source of every step (Duel's public pages, the standard provably-fair construction, or the 7,050 live rounds). The rejection guard (`v < LIMIT`) removes modulo bias. At range 25, `LIMIT = 4294967275` and 21 of 2^32 values are rejected (4.89×10⁻⁹ per chunk); at ranges 2, 4, 8 and 16, `LIMIT = 2^32` and nothing is rejected. Step 5 asserts the bound (profile MINES-08): for each of the 24 ranges 2–25 it measures the accepted window from the draw function the shuffle calls (`src/rng.ts` `drawFromChunk`), requires it to be a whole number of ranges (range 25: 4,294,967,275 = 25 × 171,798,691) and the worst per-index bias to be ≤ 2^-32. All 24 windows are exact (bias 0). Without the guard, plain `v mod range` would lean by up to 5.82×10⁻⁹ relative (2.19×10⁻¹⁰ absolute, itself under 2^-32, which is why exactness and not the ceiling is the binding assertion). The rejection census over the 6,500 recomputed rounds is 156,000 draws, 156,000 chunks read, 0 rejected, 0 cursor advances (expected 1.91×10⁻⁴). Exhausting all eight chunks of one digest is below 10⁻⁶⁰ for every range; that branch was never exercised (DL-11, premise P1).

No external randomness beacon participates: no bet record carries a beacon field (neither dataset contains the string `drand`), and every layout reproduces from (serverSeed, clientSeed, nonce, mineCount) alone.

### Operator source and verifier copies

Duel publishes the algorithm as source: the Mines tab of duel.com → Provably Fair → Verify carries a code panel (E03 shows it collapsed). Paulo copied it verbatim on 2026-09-25 (Expand → Copy) to [evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js](evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js) (E13). It is not the source of `src/rng.ts`: since v1.2.0 that module is rebuilt from the written specification [docs/ALGORITHM.md](docs/ALGORITHM.md) by an implementer who never opened Duel's code (through v1.1.0 it was a port of this file and cited 16 of its lines; the port and the citation table were removed on 20 October 2026). Duel's file is run as a second check: Step 5 executes it unmodified on all 7,050 captured rounds; its `generateMinesPositions` returns the served mine set, and the set `src/rng.ts` computes, on every one. The two differ only on inputs no captured round reaches: for ranges 2, 4, 8 and 16 Duel's file rejects the top r chunk values where `src/rng.ts` accepts every value (both exactly uniform), and when all eight chunks of a digest are rejected Duel's file moves to the next cursor where `src/rng.ts` stops with an error (DL-11, P1). This does not show that the live Verify button, or Duel's server, runs exactly this code (DL-4, P2). The same backward Fisher-Yates pattern is used by other Duel games (Keno, on 40 positions).

The ProvablyFair.org site's Mines verifier and the deployed www.provablyfair.org/verify-bets bundle are vendored, pinned and also executed by Step 5 on all 7,050 rounds (profile MINES-24), with 0 mismatches against `src/rng.ts`. Their hashes are listed under [Evidence](#evidence).

### Seed lifecycle

Before any bet the player sees `serverSeedHashed` (E04, illustrative: its seed occurs nowhere in `data/`). Bets use the current client seed and a nonce incrementing from 0; in this dataset an epoch is 50 bets (nonces 0–49) because the capture requested a rotation after every 50 ([Dataset and capture](#dataset-and-capture)). Rotation, which the player requests, reveals the previous server seed and resets the nonce: every later rotation record in `data/` carries the revealed `serverSeed` and the `revealedFrom.transactionId` it was read from, and every bet-bearing epoch starts at nonce 0 (Step 4). Every rotation also publishes the hash of the seed it will activate next. Step 2 checks that each epoch's active hash equals the next-seed hash recorded at the rotation before it; that is a consistency check, and the timing rests on the capture's records ([Limitations and trust](#limitations-and-trust)).

The default client seed is generated by the player's browser and submitted with `POST /api/v2/client-seed/rotate` ([client-seed-origin.png](evidence/client-seed-origin.png); the capture made the same call, `rotateSeed` in [capture/mines-capture.reference.js](capture/mines-capture.reference.js)). The response carries the new `server_seed_hashed`, the `next_server_seed_hash` and the echoed `client_seed`, which each rotation record stores; the server echoes the submitted value and does not assign it: the ten Phase D seeds, which the capture built as `'pfaudit' + Date.now().toString(36)`, come back in that form in their rotation records, each decoding to a moment 0.416–0.463 s before its rotation (Step 17). The epoch's `server_seed_hashed` is the `next_server_seed_hash` of the rotation before, so it is shown before the rotation request that submits the epoch's client seed; in this capture that order is the capture's own record of the earlier rotation, not something the hash link shows. The player can rotate to any client seed at any time.

## Payouts and RTP

The multiplier for revealing `k` safe tiles with `m` mines on the board is derived from the combinatorics of safe-tile selection. The edge factor is 0.999 at Duel's base tier, the only tier captured; above it, Duel's scaling-edge settings (E14, as fetched 2026-10-05 in a logged-in session) list higher edges, and the multiplier the server pays there was not observed ([Scaling edge](#scaling-edge)):

```
multiplier = C(25,k) / C(25-m,k) × (1 − edge)    // edge 0.001 on every captured bet; E14 lists up to 0.01
k = 1:       multiplier = 25 / (25-m) × (1 − edge)
```

The response carries two multiplier fields. `multiplier` is the raw combinatorial value `C(25,k)/C(25−m,k)`, without the edge. `no_house_edge_multiplier`, despite its name, includes the edge deduction (0.1% on every captured bet) and is the value the payout uses: a win credits `amount × no_house_edge_multiplier`, a loss credits exactly `"0"`. Served values from the capture ($0.01 single-reveal wins):

| Round ID | Mines | `multiplier` (served) | Exact raw | `no_house_edge_multiplier` (served) |
|---|---:|---|---|---|
| 25075333 | 1 | `1.041666666666666667` | 25/24 | `1.040625` |
| 25075376 | 2 | `1.086956521739130435` | 25/23 | `1.085869565217391305` |
| 25075415 | 3 | `1.136363636363636364` | 25/22 | `1.135227272727272728` |
| 25075373 | 4 | `1.190476190476190476` | 25/21 | `1.189285714285714286` |
| 25075359 | 6 | `1.315789473684210526` | 25/19 | `1.314473684210526315` |
| 25075345 | 8 | `1.470588235294117647` | 25/17 | `1.469117647058823529` |

Served multipliers at k > 1 are computed by the operator in double precision and are not the exact rational: the worst relative deviation is 9.2e-15 at k > 1 and 6.4e-19 at k = 1 (18-decimal rounding), over the 7,107 served multipliers of the wins and reveal steps in both datasets (DL-5). Steps 8, 10, 20 and 23 therefore compare at a relative 1e-12 and print the worst deviation each run.

### Theoretical RTP

For `k` reveals with `m` mines, the reach probability is `C(25−m,k)/C(25,k)`, so

```
RTP = C(25-m,k)/C(25,k) × C(25,k)/C(25-m,k) × 0.999 = 0.999
```

for every configuration: **99.9000% theoretical RTP at the 0.1% base edge, for every mine count 1–24 and every reveal depth. At a scaled tier the RTP would be 1 − that tier's edge, down to 99.0% in Duel's settings as fetched 2026-10-05 in a logged-in session (E14), if the server pays the formula at that edge: consistent with E14's tier boundaries, but E14 holds no multiplier and this is not verified.** Step 16 establishes it without the casino's data: it counts survival over all 2^25 tile subsets, and on all 300 (mines, reveals) cells the counted survivals equal the integer C(25−m,k) and the total C(25,k), and the operator formula × counted survival probability equals the cell's row in the RTP table exactly: 1 − the edge of the cell's first stake tier in E14 (999/1000 on 294 cells; on the six full-board cash-outs 0.9986, 0.9982 or 0.9979, below). Evaluated in floating point, the largest deviation from 0.999 is 2.2e-16 (mines=2, k=14). Negative controls are rejected on every run: the corrupted closed form C(26−m,k) fails the exact identity, and a layout with one mine moved is refused by the layout comparator.

| Mines | Win chance (first reveal) | Raw multiplier | Payout multiplier | RTP |
|---:|---:|---:|---:|---:|
| 1 | 96.00% | 1.041667× | 1.040625× | 99.9000% |
| 2 | 92.00% | 1.086957× | 1.085870× | 99.9000% |
| 3 | 88.00% | 1.136364× | 1.135227× | 99.9000% |
| 8 | 68.00% | 1.470588× | 1.469118× | 99.9000% |
| 12 | 52.00% | 1.923077× | 1.921154× | 99.9000% |
| 17 | 32.00% | 3.125000× | 3.121875× | 99.9000% |
| 24 | 4.00% | 25.000000× | 24.975000× | 99.9000% |

The win chance of the kth reveal is `(25 − m − (k−1)) / (25 − (k−1))`. At the base edge the ladder's maximum is 5,195,099.7× (m=12, k=13). That cell and five other full-board cash-outs (10–15 mines) pass $25,000 potential profit even at a $0.01 stake, so Duel's settings always price them at a scaled edge: as fetched 2026-10-05 in a logged-in session (E14), their tier lists have no 0.1% tier and start at 0.14–0.21% ([Scaling edge](#scaling-edge)). At that first tier the formula gives:

| Full-board cash-out | First-tier edge (E14) | RTP |
|---|---:|---:|
| 10 mines, 15 tiles; 15 mines, 10 tiles | 0.14% | 99.8600% |
| 11 mines, 14 tiles; 14 mines, 11 tiles | 0.18% | 99.8200% |
| 12 mines, 13 tiles; 13 mines, 12 tiles | 0.21% | 99.7900% |

No captured bet reached a full-board cash-out, so these six figures are the formula at the stated edge, not an observed payout. `outputs/rtp-claim-table.json` holds every cell to its own band ([RTP claim](#rtp-claim)).

### RTP claim

`outputs/rtp-claim-table.json` scores each of the 300 (mines, cash-out) cells against its own band, as the Keno package does: the claim is the house edge the game settings state, one of the RTP-CLAIM rule's six places (game page, fairness page, help page, bet panel, rules, game settings). Each cell is priced at the first stake tier of its list in Duel's mines settings (E14, the tier from a $0 stake) and held to 1 − that tier's house_edge within the 0.1 pp band: 99.9% on the 294 cells whose first tier is 0.1% (house_edge 0.001, served on all 6,500 captured bets as `effective_edge` 0.1), and 99.86%, 99.82% or 99.79% on the six full-board cash-outs, which have no 0.1% tier. Until 19 October 2026 all 300 cells were held to a flat 99.9%, including the six cells Duel never prices at 0.1%. The rule (RTP-CLAIM 1.2.0, Methodology v1.1) is switched on (decision D3, 14 October 2026): the outcome is scored on Step 16, the step carrying MINES-19, and a house-side miss would make the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR, because the draws themselves pass. Outcome: pass (0 of 300 cells beyond their band; true minimum 99.790000% at 12 mines, 13 tiles and 13 mines, 12 tiles; true maximum 99.900000%). The higher stake tiers of each cell are not tabled: E14 holds no multiplier, so a row there would be the formula at the tier's edge held to that same edge.

### Scaling edge

0.1% is Duel's base edge, not a fixed rate. In the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET; E14), the edge is tiered by the potential profit at the current tile: up to $25,000 it is 0.1% (except at the six full-board cash-outs named below), and above that it rises in 0.01% steps to 1.0%, where the potential profit reaches Duel's $250,000 maximum. Because the potential profit grows with every safe tile, a round's later tiles can fall in a higher tier of that config than its first. How the server applies the tiers within a round, and what it pays at a scaled tier, were not tested: no captured bet left the 0.1% tier. The tiers for each mine count were read in that session from `GET /api/v2/mines/settings?mines=N`; a logged-out request is not part of E14.

E14 holds the 24 responses, the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET). They give one tier list for each of the 300 (mines, tile) cells, 27,254 tiers in all, each list contiguous from a $0 stake. E14 holds no multiplier: each tier carries its ids, `mines`, `depth`, `min_bet`, `max_bet` and `house_edge`, and none of the 49 files in `evidence/settings/` contains the word. Taking the multiplier at the tile as C(25,k)/C(25−m,k) × (1 − edge), the formula served at the base tier, on every tier max bet × (that multiplier − 1) = $25,000,000 × that tier's edge, and on every list the 1.0% tier ends at $250,000 potential profit, both to a relative 1e-12. The formula is consistent with E14's tier boundaries; that the server pays it at a scaled tier is not verified. 294 lists start at 0.1%. The six full-board cash-outs (all safe tiles revealed, 10–15 mines) have no 0.1% tier: their lists start at 0.14% (10 and 15 mines), 0.18% (11 and 14) and 0.21% (12 and 13), with a first tier that ends just above a $0.01 stake ($0.01011 to $0.01072). The table reads six cells from E14, rounded:

| Mines, tile | 0.1% edge up to | 1.0% edge, max bet |
|---|---:|---:|
| 1 mine, 1st tile | $615k | $8.0m |
| 3 mines, 1st tile | $185k | $2.0m |
| 12 mines, 1st tile | $27.1k | $277k |
| 3 mines, 5th tile | $24.6k | $251k |
| 24 mines, 1st tile | $1,043 | $10,526 |
| 3 mines, 22nd tile | $10.89 | $110 |

At the 0.1% tier the paid multiplier is C(25,k)/C(25−m,k) × (1 − effective_edge/100): Steps 8, 10 and 23 hold the served with-edge multiplier of every primary win and every Phase E cash-out at k>1 to it. Every bet carries its `effective_edge`. At a scaled tier the same formula is consistent with E14's tier boundaries, but E14 holds no multiplier and this is not verified. All 7,050 captured bets were in the 0.1% tier (`effective_edge` 0.1 on every bet; the largest potential profit was $9.21), so no scaled tier was exercised. An informational check on every run (not a scored step; `src/scaling-edge.ts`) re-hashes the 24 responses against their pins and `evidence/settings/SHA256SUMS`, re-derives from them the list and tier counts, contiguity, the 0.01% steps, the floors and the $25,000,000 and $250,000 relations above (not the rounded table), and holds each captured bet's stake, at every tile it reached, to the 0.1% tier of E14: 7,673 of 7,673 bet-tile pairs are inside it, and the closest is a $10 Phase C stake at 12 mines, 1st tile, against a limit of $27,139.87. E14 shows the settings as fetched 2026-10-05 in a logged-in session; the April 2026 capture shows only that every bet was served `effective_edge` 0.1.

### Captured returns and simulation

| Phase | Bets | Wagered | Won | Observed RTP | Wins |
|---|---:|---:|---:|---:|---:|
| A | 4,800 | $48.0000 | $48.1769 | 100.37% | 2,392 |
| B | 1,000 | $10.0000 | $9.7402 | 97.40% | 39 |
| C | 200 | $2,000.0000 | $2,017.2115 | 100.86% | 105 |
| D | 500 | $5.0000 | $5.5856 | 111.71% | 259 |
| **Total** | **6,500** | **$2,063.0000** | **$2,080.7143** | **100.86%** | **2,795** |

The $10 phase dominates the monetary total, and Phase D's 111.71% is ordinary variance on 500 bets at mixed mine counts. The live-sample RTP is informational only; the sample cannot confirm or reject a 0.1% effect at any useful confidence (DL-9).

Pass 1 simulated 1,000,000 rounds per mine count, 24,000,000 in total, on auditor-generated seeds pinned in `src/sim-plan.ts`: 0/24 mine-position failures with the without-replacement correction and 0/24 serial-independence failures, at the Bonferroni α/24 = 0.000417, and a mean simulated RTP of 99.9041%. Pass 2 replays all 130 revealed casino seeds over 10,000 nonces each (see Step 19 and [seed selection](#residual-operator-trust)). The convergence chart is [outputs/rtp-convergence.html](outputs/rtp-convergence.html), mean RTP at 1K, 5K, 10K, 50K, 100K, 500K and 1M rounds per configuration.

## Verification results

The suite evaluates both captured datasets. Its 26 scored steps report **25 PASS, one capture-origin FLAG and zero hard fails**, `PROVABLY FAIR — Full Pass`. None of the three hard-fail conditions triggered: layout recomputation mismatch, payout error beyond tolerance, seed hash failure.

| # | Check | Result | Finding |
|---|---|---|---|
| **Commit-reveal integrity** | | | |
| 1 | Seed hash integrity | PASS | Every revealed plaintext in both datasets matched to a commitment (SHA-256 of the hex-decoded bytes): primary 130 + 3 phase-opening reveals (the rotations that open Phases B, C and D) bound to the commitment two records back; Phase E 12 + 4; 0 unrevealed, 0 mismatches |
| 2 | Next-seed promotion (commitment linkage) | PASS | 133/133 primary and 16/16 Phase E rotation links recomputed from the raw hashes; both pre-capture anchors verified |
| 3 | Hash consistency within epoch | PASS | Epochs keyed by the capture timeline, not by the bets' own hash: every bet under each of the 130 bet-bearing rotation records carries that record's serverSeedHashed and clientSeed; 4 records carry no bets; 0 orphan bets. A bet's hash and client seed are the capture's copies of its rotation response, so this binds the capture's records to each other; Step 5 binds each layout to the seed |
| 4 | Nonce audit | FLAG (capture-origin) | 130 primary epochs run 0..49 from the declared base with no gap and no reuse; 12 Phase E epochs match their planned sizes; 1 declared capture-retry gap (Phase E seeds[9], nonce 12 — DL-2): disclosed, verdict-neutral; 0 operator-side gaps |
| **RNG determinism** | | | |
| 5 | Mine position recomputation | PASS | 6,500/6,500 primary bets recomputed, 0 unverifiable, 0 mismatches; draw bias bound (MINES-08): all 24 shuffle ranges 2–25 exact, bias 0 ≤ 2^-32; rejection census 156,000 draws, 0 rejected chunks; site and live-site verifier parity (MINES-24) and Duel's own Verify-tab code (MINES-09, the second check) each executed on all 7,050 rounds, 0 mismatches |
| 6 | Client seed influence | PASS | 650 bets sampled (5 × 130 epochs): 646 change layout under a wrong client seed; 4 collisions, all at m=1/m=24, within the combinatorial bound (expected 5.97, bound 18.95); empty-seed control over all 6,500 bets: 56 collisions (expected 59.33, bound 98.08) |
| **Payout verification** | | | |
| 7 | Payout math | PASS | 6,500 primary bets + the 417 Phase E rounds step 23 does not take (39 depth-1 wins, 378 losses): every win credits amount × multiplier (relative 1e-12), every loss exactly "0"; 0 errors |
| 8 | Multiplier formula | PASS | 2,795 winning primary bets and the 39 Phase E wins settled at depth 1: both served multipliers equal the exact rationals 25/(25−m) and 25/(25−m) × 999/1000 (relative bound 1e-12; worst 6.4e-19); 0 mismatches |
| 9 | Win condition (tile not in mines) | PASS | 7,050 rounds (6,500 primary + 550 Phase E): outcome derived from the RECOMPUTED layout; every bust ends on exactly the last opened tile; opened count = recorded depth; 0 errors |
| 10 | Phase C bet-size invariance ($10 bets) | PASS | 200 Phase C bets ($10, m=12), every layout recomputed; 105 wins (floor 100) scored on the exact multiplier and on money (relative 1e-12) and served the identical multiplier strings as the $0.01 m=12 wins; 0 errors |
| 11 | Config completeness & payout-cell coverage | PASS | Phase A = 200 bets on each of the 24 mine counts (plan in code); the multi-reveal phase matches its plan (E1 m3 k5, E2 m5 k3, E3 m12 k3, E4 m15 k2, E5 m2/4/8/15 k1); Phase E first picks span all 25 tiles; 33 of 300 (mines, reveals) payout cells exercised, itemised in `outputs/payout-coverage.json` |
| 12 | House edge audit (effective_edge = 0.1%) | PASS | 6,500 bets: effective_edge = 0.1% for all; 0 deviations |
| **Dataset integrity** | | | |
| 13 | Population & phase labels | PASS | Primary: 6,500 bets (A: 4,800 · B: 1,000 · C: 200 · D: 500) and 134 seed records (A: 97 · B: 21 · C: 5 · D: 11); Phase E: 550 bets and 17 seed records, per sub-phase — all match the capture plan pinned in `src/loader.ts` |
| 14 | Dataset hash | PASS | Master SHA-256 331f74ff98b88d06242d57e806186548612f13c4269eb754ebb571d8a6fc9b20 and Phase E SHA-256 def563907949db10d584256a13b33102dfa46d33509424f642f803d74cd1b17b match their pins |
| 15 | Epoch size | PASS | Exactly 130 primary epochs of exactly 50 bets, reconciling to 6,500; every Phase E rotation record holds exactly its planned bets, reconciling to 550 |
| 16 | Probability independence (anti-circularity) | PASS | Survival counted over all 2^25 tile subsets; on all 300 (mines, reveals) cells the operator formula × counted survival = the RTP table's exact row (1 − the cell's first-tier edge: 999/1000 on 294 cells, 0.9986–0.9979 on the six full-board cash-outs) exactly; the adapter agrees within 1e-12; negative controls (corrupted formula, corrupted layout) rejected. Since 14 October 2026 (C3) the identity is held to the table's row, not to the claimed 999/1000: a cell that paid less would be an RTP-CLAIM miss on this step (RTP FIGURE OVERSTATED, exit 5), not a fail of this check |
| 17 | Phase D client seed variation | PASS | 500 bets, 10 distinct client seeds, all 24 mine counts; recomputation 500/500; the 10 seeds are predictable ('pfaudit' + timestamp) — exposed epochs, records 123–132, disclosed as DL-3 and bound to the data |
| **Simulation integrity** | | | |
| 18 | Simulation Pass 1 integrity | PASS | 24,000,000 rounds × 24 configs; every statistic re-derived from the artifact's census; mine positions (without-replacement corrected) 0/24 and serial (lag-1, win/loss runs) 0/24 at Bonferroni α/24=0.000417; mean RTP 99.9041%; first 10,000 rounds of every config replayed |
| 19 | Simulation Pass 2 cherry-pick test | PASS | 130 seeds × 10,000 nonces; Test A: 1/130 (FAIL above 7.97); Test B: 7/130 flags (FLAG above 14, FAIL above 28); seeds off in both windows 0/130 (FLAG at 2, FAIL at 3); Test C (return of the configs each epoch served, vs its own 199-window null): 3/130 (FAIL above 18.67; detection power 0.46 / 0.9999 / ~1 at 10% / 25% / 50% of seeds picked); every window re-derived — no cherry-picking detected |
| **Multi-reveal verification (Phase E)** | | | |
| 20 | Multi-reveal multiplier chain | PASS | All 795 non-mine reveal steps (k=1..5) equal the exact rational C(25,k)/C(25−m,k) (relative 1e-12; worst 9.2e-15), and all 378 mine steps carry the formula at k−1; 0 mismatches |
| 21 | Mine-set invariance across reveals (per-step, order-independent) | PASS | 550/550 final layouts match the RNG; at all 1,173 reveal steps is_mine equals membership in the seed-derived layout and revealed_positions is the exact prefix opened so far, including the 11 bets that opened tiles out of ascending order; 0 errors |
| 22 | Reveal-position independence (Phase E5) | PASS | 50 bets revealing tiles [3,7,11,17,23]: layout recomputes correctly, outcome=win iff no revealed tile is a mine; 0 errors |
| 23 | Cash-out payout correctness (k>1) | PASS | 133 cash-outs at k>1 (k=2: 14, k=3: 74, k=5: 45): final and with-edge multipliers equal the exact rationals at the reached k (relative 1e-12); payout = amount × with-edge multiplier (relative 1e-12); 0 errors |
| **Artifact integrity** | | | |
| 24 | Artifact integrity (pinned artifacts of record) | PASS | 6 artifacts (`rtp-convergence.html`, `determinism-log.json`, `chi-squared-results.json`, `payout-coverage.json`, `simulation-results.json`, `verification-results.json`) match their SHA-256 pins, carry no run metadata, and every numeric leaf lies in its declared value domain |
| **Bounds and live fit** | | | |
| 25 | Multiplier monotonicity & bounds | PASS | The exact ladder is strictly increasing in k and in m (276 + 276 pairs); all 7,107 served multipliers lie in its range; no max-odds cap is declared, so the cap half is n/a under the proposed rule R2 (pending profile owner), re-checked each run by a key walk of both datasets that finds no cap-like field (DL-6) |
| 26 | Live-sample fit (win rate & mine positions) | PASS | 24 mine-count groups: win rate vs binomial and mine positions vs the uniform lattice at Bonferroni α/24; first-drawn mine of all 6,500 bets vs uniform (p = 0.938); 0 flags |

**The nonce flag (Step 4).** All 130 primary epochs run exactly 0–49 with one `clientSeed` throughout. Since 2026-09-23 the step also audits the 12 Phase E epochs, and in the E3 epoch under server-seed hash `d6ff34bb…` (Phase E `seeds[9]`) nonce 12 has no captured round. The evidence points to the capture losing it: the capture clock moves 30 s across the gap (neighbouring bets are about 3 s apart), and the E3 position pattern due there, `[11,12,13]`, was served 7 times against 8 for every neighbour. The capture advanced its position cursor before sending each round (`pickPositions` in `capture/mines-capture-phaseE.reference.js`, lines 330–353, called at line 521), so a round placed and then lost to a failed request leaves its pattern one short. `round_id` jumps from 25754616 to 25754625 across the gap, but `round_id` is not a per-player counter (consecutive captured Phase E bets differ by 1 to 10, median 2, with no nonce missing), so the jump does not on its own show a lost round. The inferred cause is a capture request that failed after the round was placed (the `bet failed` path, line 580), consuming the nonce with no record written; the dataset holds no record of the failure, so the cause is inferred, not witnessed. The FLAG policy (decided 2026-09-17) scores an auditor-side capture retry as a FLAG with origin = capture; an undeclared gap would be treated as operator-side and FAIL. The revealed seed yields a well-formed layout at nonce 12; what the operator served there is not known.

**Commitment chain (Steps 1–3).** The rotations that open Phases B, C and D (records 97, 118 and 123) re-reveal the previous record's seed: the end-of-phase rotation just before each (records 96, 117 and 122) carries no bets, so the capture had no transaction to read that record's own seed from. Each repeated reveal is byte-identical to the one before and hashes to the commitment two records back, which Step 1 now asserts (it used to count these three and match them to nothing). Step 2 recomputes every `nextServerSeedHash` → `serverSeedHashed` link from the raw fields and anchors each capture's first epoch to the hash standing as "next" before capture began; an absent pre-capture link fails the step. The capture script's own `nextSeedPromotion.match` flags (all 134 + 17 agree) are cross-checked and never the source of the verdict. Step 3 derives epoch membership from the rotation timeline, not from the hash each bet carries; the earlier form grouped bets by their own hash, which no dataset could fail. Step 3 still largely restates its input: a bet's `serverSeedHashed` and `clientSeed` are not served with the bet but copied by the capture from the last rotation response (`capture/mines-capture.reference.js` lines 472–475), so the step shows that the capture filed each bet under the rotation it copied from. That each served layout came from that epoch's seed is Step 5's recomputation. The hash matches of Step 1 and the links of Step 2 are consistency checks: they show the seed records fit together, and a seed and hash constructed after settlement would pass them too. When each commitment was shown rests on the capture's own records ([Limitations and trust](#limitations-and-trust)).

**Client seed collisions (Step 6).** With m mines there are only C(25,m) layouts, so two client seeds must sometimes agree however good the RNG is. All 4 collisions fall at m=1 (1) and m=24 (3), where C(25,m) = 25. The step requires the count to fall within 5σ + 1 of the combinatorial expectation; an RNG that ignored the client seed would collide on all 650. The earlier form accepted any rate under 5%, which would have forgiven up to 32 insensitive bets.

**Simulation (Steps 18–19).** The committed artifact carries, beside each statistic, the integer census it is a function of (25 tile counts, wins, adjacent win pairs, transitions), and the verifier re-derives every statistic from it. Smallest corrected position p-value 0.0144 (m=19); smallest runs p-value 0.0196 (m=6). The legacy median-split runs statistic is vacuous for every m ≥ 13 (DL-7) and is not scored. Pass 2 Test A (chi-squared on the full window at mines=3) and Test B (early window 0–49 vs late) are scored against the bounds in the table; Test C standardises the return of the configurations each epoch actually served (the 50 captured mine counts, in nonce order, opening tile 0) against the seed's own 199 later windows. The early window of every seed is replayed from the revealed seed and equals the outcomes served. Seeds whose early and late windows are both off at p < 0.05 are counted, and the count is scored against Binomial(130, 0.05 × 0.05): FLAG at 2 or more (P = 0.0425), FAIL at 3 or more (P = 0.0044); 0 of 130 seeds are off in both windows. Any such seed is listed in the Step 19 record with its win counts and p-values.

Each rule that can move Step 19 has a written false-alarm rate: the probability that it fires when all 130 seeds are fair. The cap is 5% for a FLAG and 1% for a FAIL. The per-seed chance is the larger of the nominal level and the exact rejection probability of the rule's own chi-squared test, summed over every win count at the 88% win chance. Figures from `outputs/verification-results.json`, Step 19:

| Rule | Moves Step 19 to | Per-seed chance on a fair game | False-alarm rate, 130 seeds |
|---|---|---|---|
| Test A: more than 7.97 seeds fail at α = 0.01 | FAIL | 0.0102 (exact; nominal 0.01) | 6.2e-5 |
| Test B: more than 14 cherry-pick flags | FLAG | 0.0475 (nominal; exact 0.0433) | 0.0014 |
| Test B: more than 28 cherry-pick flags | FAIL | 0.0475 | 2.9e-12 |
| Test C: more than 18.67 seeds flag | FAIL | 0.045 (exact, 9/200) | 6.3e-6 |
| 2 or more seeds off in both windows at p < 0.05 | FLAG | 0.0025 (nominal; exact 0.0023) | 0.0425 |
| 3 or more seeds off in both windows at p < 0.05 | FAIL | 0.0025 | 0.0044 |
| Any seed off in both windows at p < 0.001 | FAIL | 1.8e-6 (exact; nominal 1e-6) | 2.3e-4 |

Summed over the rules, the chance that a fair game ends Step 19 at FLAG or worse is at most 0.0441, and at FAIL at most 0.0047.

**Phase E (Steps 20–23).** Each of the 378 mine steps carries the multiplier standing before the fatal reveal (the formula at k−1, exactly 1 at k−1 = 0), which the step used to skip. The count of non-ascending reveal orders (11) is pinned in `src/loader.ts`, so the evidence for order independence cannot silently vanish. Higher k values (up to 25−m) were not exercised; the formula is structurally identical at all k.

**Artifact integrity (Step 24).** The simulation artifact's `generatedAt` and `executionTimeMs` and the run record's `generatedAt` were removed; the regenerated simulation reproduced every previously pinned figure exactly. Every numeric leaf of the five JSON artifacts is held to the domain `src/domains.ts` declares, so a forged value that is re-pinned still fails when it is impossible.

**Informational context (not scored; underpowered at live sample sizes).** Empirical RTP 100.86%; theoretical 99.9000% is proven in Step 16. Win rate chi-squared over 24 mine-count groups (≥10 bets): 0/24 fail at α=0.01, minimum p=0.0345 (mines=1: 206 wins in 221 bets against 96.00%), Bonferroni α/24=0.000417. Mines=24 returned 51 wins in 1,219 bets against an expected 48.76 (χ² = 0.11, p = 0.743); Phase B alone, 39 in 1,000 against 40. Per-group figures are in [outputs/chi-squared-results.json](outputs/chi-squared-results.json). Serial tests on the live `mine_count` sequence (lag-1 r₁=0.303, z=24.41; runs 2,701 against an expected 3,241.5, z=−13.45) measure the capture's deliberate phase ordering, not the RNG; the definitive serial test is Pass 1 at fixed mine count, 0/24. Two further items check Duel's scaling-edge settings (E14) and hold every captured bet to their 0.1% tier ([Scaling edge](#scaling-edge)).

**Boundary cases.** Nonce 0 and nonce 49 reproduce in all 130 epochs. Tile positions 0 and 24 are valid mine positions, and position uniformity passes 0/24 in simulation. The HMAC key is always 32 bytes.

### Framework S5 matrix and offline checks

S5: fairness-integrity matrix; game-integrity testing not commissioned.

<!-- S5-MATRIX:BEGIN -->
| Test ID | Category | What the framework tests | Result | Tied to |
|---|---|---|---|---|
| S5-1 | Replay protection | A completed bet ID cannot be replayed to duplicate a payout | Not tested | No replay request was sent during the capture. Observed only: every captured round settled once, with one credit (Steps 7, 23). DL-10 |
| S5-2 | Input validation | Invalid, out-of-range or malformed parameters are rejected | Not tested | The capture sent only valid requests (mine counts 1–24, stakes $0.01 and $10). DL-10 |
| S5-3 | Seed integrity under adversarial input | Server and client seed fields cannot be injected or overridden via the API | Not tested | No injection was attempted. Observed only: every bet carries its rotation record's committed hash and client seed (Steps 1–3), and the 10 player-set Phase D seeds are the ones the layouts were computed with (Step 17). DL-10 |
| S5-4 | Cross-player isolation | One player's seeds, nonces or outcomes are not observable or influenced by another | Not tested | Single test account (EC-10). DL-10 |
| S5-5 | Payout field integrity | Client-supplied payout or multiplier values are ignored by the server | Not tested | The capture never sent a payout or multiplier field. Observed only: every credit equals stake × the formula multiplier (Steps 7, 8, 10, 20, 23). DL-10 |
| S5-6 | Nonce sequence enforcement | Nonces cannot be forced, replayed or skipped via the API | Not tested | No nonce was supplied by the client. Observed only: nonces run from 0 with no reuse and no undeclared gap in all 142 bet-bearing epochs (Step 4; one declared capture-retry gap, DL-2). DL-10 |
| S5-7 | Parameter boundary enforcement | Bet amounts, configuration values and game parameters outside valid ranges are rejected | Not tested | No out-of-range mine count or stake was sent. Observed only: the largest potential profit of any captured bet is $9.21, far below Duel's $250,000 limit (E14, as fetched 2026-10-05 in a logged-in session); the server's handling of a bet that passes the limit at a later tile was not tested (DL-6). DL-10 |
| S5-8 | Game-specific state | For Mines: revealing the same tile twice, cashing out after a loss | Not tested | Neither action was attempted. Observed only: no round repeats a tile, every bust is the last opened tile, every Phase E cash-out is a win and no bust is cashed out (Step 9); per-step state agrees with the layout (Step 21). DL-10 |
<!-- S5-MATRIX:END -->

All eight framework rows are **Not tested**: the capture recorded normal play, and no adversarial request (a replay, a malformed parameter, an injected seed or payout, a forced nonce, a repeated tile) was sent to Duel's API. The "Observed only" notes state what the captured data does show; none substitutes for the adversarial test. Closing any row needs a new, deliberate probe capture (DL-10).

The ten offline consistency checks are this audit's own ids, not the framework's S5 rows (they were S5-01 … S5-10, which collided with the framework ids):

| Check | Category | What was tested | Result | Finding |
|---|---|---|---|---|
| EC-1 | RNG integrity | Mine position prediction | Pass | Server seed hidden until the player rotates (the capture rotated every 50 bets); SHA-256 preimage infeasible |
| EC-2 | Commitment integrity | Seed pre-knowledge / reselection | Pass | 130 bet-bearing seeds revealed, each hashing to its epoch's commitment with 0 mismatches (consistency); the capture's records put each commitment before the epoch's first bet (timing, conditional on P7); residual operator trust disclosed |
| EC-3 | Player influence | Client seed neutralisation | Pass | Client seed active in HMAC; 646/650 changed; empty-seed control 56/6,500 unchanged, under the model bound |
| EC-4 | Nonce integrity | Nonce manipulation / reuse | Pass | 130 primary epochs: 0 gaps; single clientSeed per epoch |
| EC-5 | RNG integrity | Shuffle bias | Pass | Step 5 draw bias bound: 24/24 ranges exact, bias 0 ≤ 2^-32; position chi-squared 0/24 fails |
| EC-6 | Payout integrity | Win condition consistency | Pass | 7,050/7,050 verified against the recomputed layout (6,500 primary + 550 Phase E) |
| EC-7 | Payout integrity | Bet-size independence | Pass | Phase C: 200 bets, 105 wins (52.50% against 52.00%), 0 errors |
| EC-8 | RNG transparency | Algorithm substitution | Pass | 7,050/7,050 reproduced from the published specification; 0 mismatches |
| EC-9 | Commitment integrity | Hash commitment integrity | Pass | 130/130 bet-bearing revealed seeds verified; the 3 phase-opening reveals are bound to the commitment two records back (Step 1) |
| EC-10 | Scope limitation | Multi-account seed sharing | Not tested | Single account; future audit item (R-MULTI) |

## Reproduce the audit

Runtime: **Node 22.x** (`engines` in `package.json`, `.nvmrc`). The committed artifacts in `outputs/` were produced on that line, and the last bits of a derived floating-point statistic are runtime-dependent; see the gate below.

```sh
npm test          # or, with no npm at all: node test.js && node verify.js
```

Nothing needs installing. `verify.js` and `test.js` are dependency-free bundles generated from the TypeScript. `npm test` first checks they are the build of today's sources (`scripts/check-standalone.mjs`), runs the unit tests and requires their count to match this file and Mocha (`scripts/unit-parity.mjs`), then runs the verification suite against the committed `outputs/simulation-results.json`, so a fresh clone reproduces the verdict without re-simulating.

- **Verification steps:** 26 scored steps in `tests/verify.ts` (steps 20–23 score the Phase E multi-reveal corpus; step 24 pins the artifacts of record and checks their value domains; steps 25–26 are the FLAG-policy monotonicity and live-sample checks, appended on 2026-09-23 so no earlier step number moved)
- **Unit tests:** Mocha (`tests/**/*Tests.ts`) and the zero-install bundle `test.js` — 32 tests (`scripts/unit-parity.mjs` fails the run if the two counts, or this line, disagree)
- **Expected `npm test` result:** 25/26 PASS + 1 capture-origin FLAG (step 4, DL-2) · PROVABLY FAIR — Full Pass · `REPRODUCED` against the committed artifacts · exit 0

| Command | Purpose |
|---|---|
| `npm run verify` | Verification and comparison against the committed evidence (toolchain) |
| `npm run test:full` | Re-simulate into `outputs/run/` (about 15 minutes), diff the regeneration field by field (`npm run diff:simulation`, `outputs/run/diff-simulation.json`), then `npm test` |
| `npm run replay` | Replay every integer census field of the committed simulation from its pinned seeds (about 20 minutes) |
| `npm run mutate` | Run the mutation battery in disposable copies |
| `npm run build` | Regenerate `verify.js`, `test.js` and `standalone-manifest.json` from the TypeScript |

The toolchain commands need `npm ci` first.

**The gate.** `npm run verify` writes **nothing** into `outputs/`. This run's results, determinism log, chi-squared table and `diff.json` go to `outputs/run/` (gitignored), so a re-run cannot replace the evidence it scores, and a disagreement between two runs is recorded rather than resolved in favour of whichever ran last. `outputs/run/diff.json` compares the run with the committed artifacts field by field and records the runtime. The tolerance is **1e-14 absolute + 1e-12 relative**, and two distinct integers never agree; a statistic that moved by a unit in the last place is recorded as `withinTolerance`, anything beyond the bound is a different result. The SHA-256 dataset guard is the identity of the dataset of record and is never rewritten to make a run agree.

| Code | Meaning |
|---:|---|
| 0 | `PROVABLY FAIR — Full Pass`, and the run reproduces the committed artifacts (a capture-origin FLAG, the auditor's own capture gap declared in this file, is disclosed and leaves this at 0) |
| 1 | At least one hard fail, **or** a reproduction difference beyond tolerance |
| 2 | At least one operator-origin FLAG: `PROVABLY FAIR — Conditional Pass` |
| 5 | `RTP FIGURE OVERSTATED`: no draw check failed, but the RTP-CLAIM rule (1.2.0, switched on) found settings beyond the 0.1 pp band on the house side of the published figure. It outranks a Conditional Pass; a hard fail (exit 1) outranks it |

**Artifacts of record.** Step 24 pins six artifacts by SHA-256 in `src/artifact-pins.ts`; none carries run metadata (no `generatedAt`, no `executionTimeMs`).

| File | Guarded by |
|---|---|
| `outputs/verification-results.json` | SHA-256 pin, step 24 + value domains + field-level reproduction gate (`outputs/run/diff.json`, tolerance 1e-14 abs + 1e-12 rel, integers exact) |
| `outputs/determinism-log.json` | SHA-256 pin, step 24 + value domains + reproduction gate |
| `outputs/chi-squared-results.json` | SHA-256 pin, step 24 + value domains + reproduction gate |
| `outputs/payout-coverage.json` | SHA-256 pin, step 24 + value domains + reproduction gate |
| `outputs/simulation-results.json` | SHA-256 pin, step 24 + value domains; statistics re-derived by steps 18–19; `npm run replay` reproduces every census field; `npm run test:full` diffs a regeneration field by field |
| `outputs/rtp-convergence.html` | SHA-256 pin, step 24 |

The committed artifacts are refreshed only by `PF_EMIT=1 npm run verify` (verifier artifacts) and `npm run simulate` (`PF_EMIT=1`, simulation artifacts); a regenerated artifact must be re-pinned in `src/artifact-pins.ts` in the same change. `verification-results.json` carries step 24's own result, so its pin is set by emitting, pinning and emitting again until the pin is a fixed point. The 2026-09-23 simulation regeneration reproduced every one of the 1,768 previously pinned leaves exactly and the chart byte for byte. To refresh the RTP claim table, run `npm run rtp-claim:write` and re-pin `RTP_CLAIM_TABLE_SHA256` in `src/rtp-settings.ts`. After any change to `src/` or `tests/`, `npm run build` regenerates the bundles, and `npm run release-manifest` rewrites [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

**Mutation battery.** `npm run mutate` runs 47 must-fail mutations in `tests/mutations.json` (44 until 14 October 2026, 48 until 20 October 2026), each with the result it must produce: 36 must make their named step FAIL; 7 must make it FLAG (M11, M19c, M25, M25b and M25c with a Conditional Pass; MC3a and MC3b with RTP FIGURE OVERSTATED, exit 5); M26 must leave Step 26 at INFO with the verdict unchanged; and 3 name no step (M27 must fail the unit suite; MC3as and MC3bs must exit 1 with the committed RTP table reported as differing). Between them every one of the 26 scored steps is reached by name, including forged datasets, forged simulation artifacts and forged docusaurus and live-site verifier copies re-pinned as a forger would; 3 declared survivors in `tests/survivors.json` are each tied to a DL row. The battery was rerun on 2026-10-06: 44/44 caught by their named step, 0 missed, 3 declared survivors, 26/26 scored steps killed. Rerun on 2026-10-14 on the tree carrying RTP-CLAIM 1.2.0 switched on (Apple M2 Max, Node 22.23.1, wall 2765 s): 44/44 caught by their named step, 0 missed, 3 declared survivors, 26/26 scored steps killed. Second pass, 14–15 October 2026 (FIXPASS2 class C3, the exit-5 entries): see the release-history entry "14 October 2026 (second pass)". Rerun on 2026-10-19 on the tree carrying the QA fixes of that day: see the release-history entry "19 October 2026". Rerun on 2026-10-20 on the 20 October v1.2.0 tree (Apple M2 Max, Node 22.23.1, wall 2197 s): 47/47 caught by their named step, 0 missed, 3 declared survivors, 26/26 scored steps killed; the release manifest records that run.

## Verify a bet

Everything below uses the field names Duel serves, so you can copy them from your bet history and the seed panel. Tiles are numbered **0-based, 0 to 24**, exactly as in `mines_positions` and `revealed_positions`.

1. **Save the commitment before you bet, then reveal the seed.** While you play, the Provably Fair panel shows only the hash of the active server seed, `serverSeedHashed`, and your nonce (E09, illustrative: its seed occurs nowhere in `data/`). **Before your first bet on a seed, save that hash** (the panel can truncate it on screen, as in E04, so copy it with the field's copy button and keep the full value); it is the commitment the later checks compare against. Pressing **Rotate seed** retires that server seed; from then on the transaction detail of any bet played under it carries the plaintext as `server_seed`. This audit's capture read every revealed `serverSeed` from exactly there, `/api/v2/user/transactions/{id}` ([capture/mines-capture.reference.js](capture/mines-capture.reference.js)).
2. **Which fields to copy.** From the round: `serverSeedHashed` (it should equal the hash you saved), `clientSeed`, `nonce`, `mines_count`, `mines_positions`, `revealed_positions`, `outcome`. From the transaction detail after the rotation: the revealed `serverSeed`.
3. **The commitment.** `SHA-256(hexDecode(serverSeed))` must equal the `serverSeedHashed` you saved before betting. The seed is hashed as the 32 **bytes** its 64 hex characters encode, not as the text of the hex string. A match is hash equality: it shows the revealed seed is the one behind that hash. It does not by itself show when the hash was shown, because a seed and hash made after the round would also match. The assurance that the seed was fixed before your bets comes from your own saved copy, made before you played.
4. **The shuffle** ([docs/ALGORITHM.md](docs/ALGORITHM.md) §2). Start from tiles `[0, 1, …, 24]`. For draw `i` from 0 to 23: `r = 25 − i`; compute `HMAC-SHA256(key = hexDecode(serverSeed), message = clientSeed + ":" + nonce + ":" + i)`; read the digest as eight 32-bit big-endian numbers and take the first one below `floor(2^32 / r) × r`; swap tile `r − 1` with tile `value mod r`. If all eight were rejected the spec leaves the step open (O1); it never happened in the capture. The mines are the first `mines_count` tiles after the shuffle.
5. **The result.** Sorted, those tiles must equal your round's `mines_positions`. You won exactly when none of your `revealed_positions` is among them, and a lost round ends on the first mine you opened. The payout is `amount × no_house_edge_multiplier`, where `no_house_edge_multiplier` = C(25,k)/C(25−m,k) × (1 − effective_edge/100), using the `effective_edge` served on your bet. This audit verified the formula at `effective_edge` 0.1, the only value captured; at a higher edge it is not verified ([Scaling edge](#scaling-edge)).

```javascript
// node verify-round.js — paste your values into the six constants
// serverSeedHashed: the hash you saved from the Provably Fair panel BEFORE betting
const crypto = require('crypto');
const serverSeed = '', serverSeedHashed = '', clientSeed = '', nonce = 0, mines_count = 0;
const mines_positions = [];

const key = Buffer.from(serverSeed, 'hex');
const hashMatches = crypto.createHash('sha256').update(key).digest('hex') === serverSeedHashed;
const tiles = Array.from({ length: 25 }, (_, t) => t);
for (let i = 0; i < 24; i++) {
  const r = 25 - i, limit = Math.floor(2 ** 32 / r) * r;
  const h = crypto.createHmac('sha256', key).update(`${clientSeed}:${nonce}:${i}`).digest();
  let j = -1;
  for (let off = 0; off < 32 && j < 0; off += 4) { const v = h.readUInt32BE(off); if (v < limit) j = v % r; }
  if (j < 0) throw new Error('all eight chunks rejected: not specified (docs/ALGORITHM.md O1)');
  [tiles[r - 1], tiles[j]] = [tiles[j], tiles[r - 1]];
}
const mines = tiles.slice(0, mines_count).sort((a, b) => a - b);
console.log({ hashMatches, mines, matches: JSON.stringify(mines) === JSON.stringify([...mines_positions].sort((a, b) => a - b)) });
```

`hashMatches: true` means the revealed seed hashes to the value you pasted (hash equality). `matches: true` means the mine layout you were served is the one that seed produces. That the seed was fixed before your round rests on the hash you saved before betting: paste that saved value, not one read after the reveal.

Worked captured vector: server seed `b255e0f55d255669bbd42a777b0e6b6570027b058d1db571df57325a2269a75f`, client seed `EveJlkDtA24dfvBr`, nonce `0`, 14 mines. Commitment: `SHA-256(hexDecode(serverSeed)) = eecc6f36cd2e55109959a19a9667bfcccf27e8a75842bd800d77ed054766ff30`. The first three swaps:

| Draw i | r | Message | First chunk | j | Swap |
|---:|---:|---|---|---:|---|
| 0 | 25 | `EveJlkDtA24dfvBr:0:0` | `0xd8c82daa` = 3636997546 | 21 | tiles[24] ↔ tiles[21] |
| 1 | 24 | `EveJlkDtA24dfvBr:0:1` | `0xa6cb9b87` = 2798361479 | 23 | no-op |
| 2 | 23 | `EveJlkDtA24dfvBr:0:2` | `0x291cf2f0` = 689763056 | 2 | tiles[22] ↔ tiles[2] |

After all 24 swaps the first 14 tiles, sorted, are **[1, 4, 5, 7, 8, 13, 14, 15, 16, 17, 19, 20, 22, 24]**, exactly the served `mines_positions`.

The ProvablyFair.org site's own Mines verifier returns the same layout on all 7,050 captured rounds (Step 5). `node scripts/check-site-verifier.mjs <site>/src/components/VerifyBets/games/mines/derive.js` checks a site checkout against the pinned copy, and `node scripts/check-site-verifier.mjs --live` checks the live page at https://www.provablyfair.org/verify-bets.

## Evidence

All screenshots are in `evidence/`. Screenshots illustrate interface states; they do not replace the recorded responses. They are interface illustrations, not frames matched to the captured epochs: the seeds, hashes and client seeds visible in E04 and E09 occur nowhere in `data/`, and the other screens show none.

| ID | File | Description |
|---|---|---|
| E01 | [evidence/E01-mines-game-ui.png](evidence/E01-mines-game-ui.png) | Mines game interface: 5×5 grid, mine count selector and bet controls |
| E02 | [evidence/E02-fairness-page-overview.png](evidence/E02-fairness-page-overview.png) | Duel.com fairness page overview |
| E03 | [evidence/E03-fairness-verify-mines.png](evidence/E03-fairness-verify-mines.png) | Mines verification tab on the fairness page, code panel collapsed |
| E04 | [evidence/E04-active-commitment.png](evidence/E04-active-commitment.png) | Provably Fair panel showing an active server seed hash, nonce 0. Illustrative only: its hash and client seed occur nowhere in `data/`, so no recorded bet was placed under it, and it is not pre-bet evidence for any recorded round |
| E05 | [evidence/E05-phase-a-start.png](evidence/E05-phase-a-start.png) | Mines game panel before a round: stake field (0.00) and mine count 3 |
| E06 | [evidence/E06-phase-b-start.png](evidence/E06-phase-b-start.png) | Mines game panel with mine count 24 selected (the Phase B setting) |
| E07 | [evidence/E07-phase-c-start.png](evidence/E07-phase-c-start.png) | Mines game panel with mine count 12 selected (the Phase C setting); the stake field shows 0.00 |
| E08 | [evidence/E08-phase-d-start.png](evidence/E08-phase-d-start.png) | Same image as E05 (byte-identical) |
| E09 | [evidence/E09-seed-rotation.png](evidence/E09-seed-rotation.png) | Provably Fair panel after rotating from the E04 state: E04's next server seed hash and new client seed are now active, nonce 0. Illustrative only: its seeds occur nowhere in `data/` |
| E10 | [evidence/E10-bet-history.png](evidence/E10-bet-history.png) | Live-bets feed below the Mines panel (All Bets tab): Casino and Dice rows, players' usernames masked; it shows no Mines round |
| E11 | [evidence/E11-client-seed-rotation-response.png](evidence/E11-client-seed-rotation-response.png) | Same image as E09 (byte-identical); no API response is shown |
| E12 | [data/mines-phaseE-550bets.json](data/mines-phaseE-550bets.json) | Phase E multi-reveal dataset: 550 bets across five sub-phases (E1–E5) |
| E13 | [evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js](evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js) | Duel's own Mines verification code: the code panel of duel.com → Provably Fair → Verify (Mines) → Expand → Copy, copied verbatim by Paulo on 2026-09-25 and never edited. SHA-256 `88f5268b0b1c359eb76d43b2f14e1402e47921154c1935ae2790256c02cff592`, 3,026 bytes, 92 lines. E03 shows the same panel collapsed. Pinned in `src/operator-verifier.ts`, executed unmodified by Step 5 on all 7,050 captured rounds (0 differ) as the second check (profile MINES-09); not the source of `src/rng.ts`, which is rebuilt from docs/ALGORITHM.md |
| E14 | [evidence/settings/](evidence/settings/) | Duel's mines scaling-edge settings: `GET /api/v2/mines/settings?mines=1…24`, 24 responses as served on 5 October 2026, the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), 12:16:48–12:18:45 UTC, every response HTTP 200. Each body is saved byte for byte as `mines-settings-m01.json` … `m24.json`, with a `.meta.json` beside it (path, status, response headers, fetch time); SHA-256 per file in `evidence/settings/SHA256SUMS`. The bodies are pinned in `src/scaling-edge.ts` and read by an informational check on every run ([Scaling edge](#scaling-edge)) |
| — | [evidence/client-seed-origin.png](evidence/client-seed-origin.png) | Client seed origin in the game client: annotated excerpt of Duel's live JS bundle (DevTools Sources, captured 2026-06-03), where the default client seed is drawn in the browser with `crypto.getRandomValues` |

E10 (2026-10-01): other players' usernames in the Player column of the live-bets table are masked with a solid box. Every pixel outside the box is unchanged (compared pixel by pixel). SHA-256 as captured `f9a2eab15918d999db7ae0f3e2e179f88ac33c4004badfc7c7ce17ec0165410b`, masked `fe682cda71d4a49946749b5c3a169478be0d877453a957e93ed5fd9367c798d2`. No step reads or hashes an image.

### Verifier copies

The ProvablyFair.org site's Mines verifier, `src/components/VerifyBets/games/mines/derive.js` and the one file it imports, `src/components/VerifyBets/lib/hmac-sha256.js`, is vendored byte for byte in `verifier-parity/` and pinned in `src/site-verifier.ts`:

| File | SHA-256 |
|---|---|
| `games/mines/derive.js` | `2321b23c91faf66542b1db4776548998778c616180033240bea338aeff48c993` |
| `lib/hmac-sha256.js` | `bc30bfe9ef202905ece93de33440d41851abf16e910f90c2a567774a2b79d889` |

Re-vendored on 2026-09-25 from the site's `origin/main` @ `bd4d59c` (2026-09-19; `mikepforg/pf-audit-duel`, read with `git cat-file`, the local checkout untouched). The copy pinned on 2026-09-24 came from the local checkout's branch `repotree-sync` @ `2ad89bc`, which is not an ancestor of main; its `derive.js` differed only in the source-URL comment. Step 5 executes the vendored `deriveMines` on all 7,050 captured rounds: 0 mismatches. `node scripts/check-site-verifier.mjs <site derive.js>` exits 1 on any difference.

The live page (www.provablyfair.org/verify-bets) is a separate Next.js build whose source is not available to this audit. Its deployed bundle was fetched on 2026-09-24 (GET only), and the three files the Mines derivation needs are vendored byte for byte in `verifier-parity/live-site/chunks/`, pinned with the package's runner in `src/live-site-verifier.ts`:

| File | SHA-256 |
|---|---|
| `chunks/turbopack-828b80f561e7c968.js` (the site's Turbopack runtime) | `6e8629f444df945f8fecfdfe05e24f4fa6c63b6b1ecc8f39fc45e9c4f4ecc903` |
| `chunks/34934e0e762aa37e.js` (page module 7721: `verifyDuelsGame` and its crypto dependencies) | `9fb319dec0d79f9bf5851ec8e0052b6b2125e603be03d12b78a0fe99eed817d1` |
| `chunks/4f34301b2f166201.js` (the `process` shim the crypto dependency requires) | `8111e3f3e9a137888558f69547a19b0238d1c50a339b4c51095f9481785df0f5` |
| `run-live-verifier.cjs` (package harness: loads the chunks with the site's own runtime and makes the page's Verify call) | `b06a01332a26a931c73c58c1399b956958e3cf552741a925939d331c2a7f9488` |

Step 5 executes the site's own code on all 7,050 captured rounds: 0 mismatches. The runner's header lists everything in it that is not the site's code (browser globals, inert stand-ins for the page's React/UI modules, a one-shot observer of the page's `VERIFY.bind`). `node scripts/check-site-verifier.mjs --live` re-downloads the page and each pinned chunk and compares hashes (exit 1 on any difference or if the page no longer loads a pinned chunk); run 2026-09-24: 3/3 MATCH. `verifier-parity/operator/run-operator-verifier.cjs` executes E13 unmodified in a child Node process; its header lists every line of harness surface, and it is pinned with E13 in `src/operator-verifier.ts`.

### Files supporting the recorded result

| File | Role | Generated by |
|---|---|---|
| [outputs/verification-results.json](outputs/verification-results.json) | All 26 scored step results and informational items | `PF_EMIT=1 npm run verify` |
| [outputs/determinism-log.json](outputs/determinism-log.json) | RNG recomputation summary (6,500 primary bets verified, 0 mismatches) | `PF_EMIT=1 npm run verify` |
| [outputs/chi-squared-results.json](outputs/chi-squared-results.json) | Per-mine-count win-rate statistics (24 groups) | `PF_EMIT=1 npm run verify` |
| [outputs/payout-coverage.json](outputs/payout-coverage.json) | The 33 of 300 (mines, reveals) payout cells live play reached, and the probability mass on the 267 it did not | `PF_EMIT=1 npm run verify` |
| [outputs/simulation-results.json](outputs/simulation-results.json) | Two-pass simulation with the integer census every statistic is re-derived from (24M rounds Pass 1; 130 seeds × 10,000 nonces Pass 2, Tests A–C) | `npm run simulate` |
| [outputs/rtp-convergence.html](outputs/rtp-convergence.html) | Self-contained RTP convergence chart | `npm run simulate` |
| [outputs/rtp-claim-table.json](outputs/rtp-claim-table.json) | All 300 cells against the 99.9% base-tier claim; RTP-CLAIM 1.2.0, scored on Step 16 | `npm run rtp-claim:write` |
| `verify.js`, `test.js`, `standalone-manifest.json` | Zero-install bundles and the hashes that tie them to the TypeScript | `npm run build` |
| `tests/mutations.json`, `tests/survivors.json` | 47 must-fail mutations, each naming the result it must produce (36 a FAIL of their named step); 3 declared survivors tied to DL rows | `npm run mutate` |
| [docs/ALGORITHM.md](docs/ALGORITHM.md) | The written specification `src/rng.ts` is rebuilt from (a copy of the framework's `games/mines/ALGORITHM.md` with the spec author's workspace paths replaced by package paths or neutral wording (its header says so)), with its test vectors, open points O1–O8 and the files read to write it | written by hand; `tests/mines/RngSpecTests.ts` runs its vectors |
| [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json) | Release identity, artifact hashes, recorded score and mutation-run record | `npm run release-manifest` |

`outputs/run/diff.json`, `outputs/run/diff-simulation.json` and `outputs/run/replay.json` are gitignored run records.

## Limitations and trust

The commit-reveal records support three findings. The first rests on consistency checks together with the capture's own pre-bet observations; the other two rest on recomputation:

1. **The server seed was fixed before the bets it covers.** Two kinds of evidence bear on this, and they establish different things:
   - *Consistency.* Every revealed seed in both datasets hashes to a recorded commitment (Step 1), each epoch's active hash equals the next-seed hash recorded at the rotation before it (133/133 primary, 16/16 Phase E), and each capture's first epoch equals the hash standing as "next" before capture began (Step 2). Hash matching and forward links are consistency checks: they show the seed records fit together, not when a commitment was shown. A seed and hash constructed after settlement would pass them too.
   - *Timing.* That each commitment was shown before its epoch's bets rests on the capture's recorded pre-bet observations. The capture stored each epoch's active hash from the rotation response that opened it, and that rotation record is timestamped before the epoch's first bet record: 130/130 primary and 12/12 Phase E bet-bearing epochs (measured from the `at` fields for this release, not scored). The `at` dates the rotation-response fields; the `serverSeed` on primary `seeds[0]`, that record's own seed, was added after the capture ([Dataset and capture](#dataset-and-capture)), so `seeds[0]`'s `01:43:43.754Z` dates its commitment, not its seed. A bet record is timestamped after its round settled, so the bet request's own time is not recorded; that the rotation came before it rests on the capture script, which rotates and only then places bets (the `.reference.js` records). The capture had already recorded the same hash as "next" at the rotation before: 129/129 and 11/11 later bet-bearing epochs, and for each capture's first epoch the next-seed hash it read with `GET /api/v2/client-seed` before its first rotation. This timing holds only as far as the capture is a faithful record of what Duel served and when (premise P7, assumed).
   - E04 and E09 are illustrative only: their seeds occur nowhere in `data/`, so neither is pre-bet evidence for any recorded round.
2. **The layouts are deterministic from the inputs.** 7,050 / 7,050 mine layouts reproduce (Steps 5, 21).
3. **The win condition and payouts are applied correctly.** Zero errors across the payout, multiplier and win-condition checks (Steps 7–10, 20, 22–23).

None of this shows unbiased seed selection, and no public-randomness beacon participates.

### Declared limitations register

Each row is a limit of what this audit shows, with its measured size and the evidence that closes it or the work that would.

| ID | Limitation | Measured magnitude | Closure evidence / what would close it |
|---|---|---|---|
| DL-1 | The client seeds for Phases A–C were generated by the capture with `Math.random()` (`capture/mines-capture.reference.js` `generateClientSeed`), which is not a cryptographically secure generator. | 120 of the 130 bet-bearing epochs (all of A–C; Phase D is DL-3). | Not closable by the verifier. Each epoch's server-seed hash equals the next-seed hash recorded at the rotation before the one that submitted its client seed (step 2, a consistency check); that the hash was shown before the client seed was chosen rests on the capture's own record of that earlier rotation (P7). Every layout recomputes (step 5). Closing it needs a recapture with a CSPRNG client seed. |
| DL-2 | One Phase E nonce was consumed by the operator for a round the capture never recorded (a capture retry; inferred, not witnessed). | 1 round of 7,050: Phase E `seeds[9]` (`d6ff34bb…`), nonce 12. | Declared in `src/loader.ts` `DECLARED_CAPTURE_RETRY_GAPS` with its evidence (a 30 s clock gap, the E3 position pattern due there served 7 times not 8; the `round_id` jump across it fits but does not on its own show a lost round, as `round_id` is not a per-player counter); step 4 reports it as a capture-origin FLAG, verdict-neutral, and confirms the revealed seed yields a well-formed layout at nonce 12. What was served at that nonce is not known. |
| DL-3 | The ten Phase D client seeds are predictable: `'pfaudit' + Date.now().toString(36)` (`capture/mines-capture.reference.js:411` and `:432`). | Exposed epochs: rotation records 123–132 (500 bets). Each seed decodes to a timestamp 0.416–0.463 s before its rotation; by the capture's timestamps, the epoch's server-seed hash had been recorded as the previous rotation's next-seed hash at least 1.574 s before its client seed existed (record 123). | Step 17 decodes every Phase D seed, requires the exposed-epoch list to equal `PHASE_D_PREDICTABLE_EPOCHS`, and FAILs if this row drifts from the data. The Phase D layouts all recompute (500/500). |
| DL-4 | Duel's in-site Verify tab (evidence E03) was not probed with captured rounds. Its code panel WAS copied: Duel publishes its Mines algorithm as source on that tab (duel.com → Provably Fair → Verify → Expand → Copy); E03 shows the panel collapsed, which is why this row used to say no line of the algorithm was in reach. | Code panel copied verbatim by Paulo on 2026-09-25 to `evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js` (SHA-256 `88f5268b0b1c359eb76d43b2f14e1402e47921154c1935ae2790256c02cff592`, 3,026 bytes, E13). 0 rounds pasted into the live tab. | Narrowed 2026-09-25 (profile MINES-09 is now met). Step 5's fifth leg pins that file and EXECUTES it unmodified on all 7,050 captured rounds: its `generateMinesPositions` returns the served mine set and `src/rng.ts`'s on 7,050/7,050. Since v1.2.0 this is a second check: `src/rng.ts` is rebuilt from docs/ALGORITHM.md, not ported from this file. Still open (premise P2): that the Verify button runs exactly the code its panel shows — closing it needs captured rounds pasted into the live tab (a browser read, no bet). The ProvablyFair.org site verifiers are separate and also executed by Step 5 (MINES-24). |
| DL-5 | Served multipliers at k > 1 are not the exact rational: the operator computes them in double precision. | Worst relative deviation 9.2e-15 (k > 1), 6.4e-19 at k = 1 (18-decimal rounding), over the 7,107 served multipliers of the wins and reveal steps in both datasets (the settled multiplier field of a lost round is not compared). | Steps 8, 10, 20 and 23 compare each of the 7,107 with the exact rational at a relative 1e-12 and print the worst deviation each run: Step 8 the two settled multipliers of the 2,795 primary wins and the 39 Phase E wins settled at depth 1, Step 23 those of the 133 Phase E cash-outs at k > 1, Step 20 the 1,173 Phase E reveal steps (Step 10 again the 105 Phase C wins). Until 19 October 2026 the 39 depth-1 Phase E wins were held only to the ladder's range (Step 25). Survivor S02 records that loosening that bound to 1e-6 changes no verdict on this capture; M08 and M20 (forged values between the two bounds) show what it catches. |
| DL-6 | No maximum-odds cap is declared or published for Duel Mines, in what was checked. In the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET; E14), Duel's scaling-edge settings set a maximum profit instead: $250,000 per round, through their bet limits ([Scaling edge](#scaling-edge)). | The ladder's own maximum is 5,195,099.7× (m=12, k=13); all 7,107 served multipliers lie inside the ladder's range. Checked for a cap and none found: every key of both datasets (a walk of 161,440 keys finds no cap-like field), and the captured screens E01–E05, E07, E09–E11. NOT checked: Duel's Terms of Service, any in-game rules panel, the Zero Edge page, E06, E08, `client-seed-origin.png`, the live site other than the mines settings endpoint (E14, fetched 2026-10-05 in a logged-in session: a max-profit limit, no multiplier cap). The largest potential profit of any captured bet is $9.21, so the limit never came near binding. | Step 25 asserts monotonicity and the range. Under the proposed rule R2 (pending profile owner) the cap half is n/a with that evidence (`src/loader.ts` `DECLARED_MAX_ODDS = null`), and Step 25 re-walks both datasets every run and FLAGs if a cap-like field appears while none is declared (M25c); if a cap is declared, every served paid multiplier is held to it (M25b). A published cap found in an unchecked source would turn this into a declared cap. Duel's behaviour at the max-profit limit, including a bet accepted at the first tile whose potential profit at a later tile passes the limit, was not tested; closing it needs a probe bet (DL-10). |
| DL-7 | The simulation artifact's legacy runs statistic (median split, `runsZ` / `runsPValue`) is vacuous whenever losses are the majority. | z = 0, p = 1 on 12 of 24 configurations (every m ≥ 13). | Step 18 no longer scores it: it re-derives the runs test on the win/loss dichotomy from the census (0/24 below the Bonferroni alpha) and reports the vacuous count every run. The legacy fields are kept so every previously pinned leaf of the artifact is unchanged. |
| DL-8 | The primary capture opens tile 0 first on every bet, so the player's first pick is not a variable in it. | 6,500 of 6,500 primary bets open tile 0. | Phase E first picks span all 25 tiles (step 11); the first mine the shuffle places is fitted to the uniform lattice over all 6,500 bets (step 26). |
| DL-9 | The live-sample RTP illustrates variance only. | Empirical 100.86% over the primary bets. | RTP evidence is the exact identity (step 16) and the 24,000,000-round simulation (step 18). |
| DL-10 | No adversarial request was sent to the API: every row of the framework S5 matrix is Not tested. | 0 of 8 S5 rows executed; single test account. | The S5 matrix under [Verification results](#verification-results) states what the captured data shows for each row. Closing any row needs a deliberate probe capture. |
| DL-11 | The branch where all eight 32-bit chunks of a digest are rejected was never exercised. The spec leaves it open (docs/ALGORITHM.md O1); `src/rng.ts` stops with an error there, Duel's published Verify-tab code moves to the next cursor. Likewise unwitnessed: for ranges 2, 4, 8 and 16 Duel's code rejects the top r chunk values, which `src/rng.ts` accepts. | 0 rejected chunks in 156,000 captured draws; expected 1.9e-4 under `src/rng.ts`'s rule. | Step 5 prints the census. Survivor S01 records that making that branch return plain `v mod r` instead changes no verdict. Which rule the operator runs there is premise P1, unwitnessed. |

### Load-bearing premises

| ID | Premise | Status | Evidence |
|---|---|---|---|
| P1 | Where no captured round reaches, the operator's server draws as its published Verify-tab code does, not as `src/rng.ts` does: when all eight chunks of a digest are rejected it moves to the next cursor (`src/rng.ts` stops with an error, docs/ALGORITHM.md O1), and for ranges 2, 4, 8 and 16 it rejects the top r chunk values (`src/rng.ts` accepts them; both windows are whole multiples of the range). | **ASSUMED** — unwitnessed in play | Neither case occurs in the capture (DL-11): 0 rejected chunks in the captured draws, so every captured layout is the same under both rules. The rule is read from Duel's published code (`cursor++; // otherwise try a new cursor`, L77, and `maxFair = MAX_UINT32 - (MAX_UINT32 % range)`, L55, of `evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js`); that its server takes these branches the same way is not witnessed. |
| P2 | Duel's Verify tab computes what `src/rng.ts` computes on every captured round (the two differ only where no captured round reaches, P1). | Code witnessed; the live button **ASSUMED** | The code its panel shows (copied 2026-09-25, E13) is executed by Step 5 on all 7,050 captured rounds and equals `src/rng.ts` and the served layout on every one. Not witnessed: that the Verify button runs that code — no round was pasted into the live tab (DL-4). The ProvablyFair.org site verifiers are different pages and are witnessed too (Step 5, MINES-24). |
| P3 | The tile indices 0–24 in `mines_positions` / `revealed_positions` are the board positions the player sees. | **ASSUMED** — unwitnessed | The audit compares API fields only; no screenshot maps an index to a board cell. |
| P4 | The commitment is SHA-256 of the hex-decoded seed bytes. | Witnessed | Every revealed plaintext in both datasets hashes to a commitment under it (step 1). |
| P5 | The first nonce after a client-seed rotation is 0. | Witnessed | All 142 bet-bearing epochs of both datasets start at nonce 0 (step 4). |
| P6 | The mines are the first `mines_count` tiles of the shuffle, returned as a set. | Witnessed | 7,050 of 7,050 served layouts recompute as sets (steps 5, 21). |
| P7 | The capture is a faithful record of what Duel served and when: each rotation record's hashes are the ones Duel's rotation response carried, each record's `at` is the capture's clock when the record was written (a rotation on its response, a bet after its round settled; on primary `seeds[0]` it dates the hashes, not the `serverSeed` added after the capture), and the capture ran in the order its script gives (rotate, then bet). | **ASSUMED** — not tested by this package | The timing half of [finding 1](#limitations-and-trust) rests on it. The hash matches and forward links (Steps 1–2) are consistency checks and do not establish it; the datasets' SHA-256 pins (Step 14) fix the files as published, not that they match what Duel showed at the time. |

### Residual operator trust

| Property | Value |
|---|---|
| Entropy model | Client seed + server seed (commit-reveal) |
| External beacon | None |
| Cherry-pick risk tier | Medium — server generates seed unilaterally |
| Pass 2 Test B | 7 / 130 flags, all isolated-early (binomial p = 0.475); 0 / 130 seeds off in both windows (FLAG at 2, FAIL at 3) |
| Pass 2 Test C (served configurations) | 3 / 130 flags; 5.85 expected by chance, FAIL above 18.67 |

**Seed selection.** The operator generates server seeds before the player bets. The commitment prevents changing a seed mid-epoch, but an operator could in principle generate many seeds, evaluate their layouts across all nonces and select unfavourable ones; without an external beacon, residual trust rests on the operator. Pass 2 (Step 19) tested all 130 casino seeds at `mine_count = 3` (88% win rate) over 10,000 nonces each. Test A: 1/130 fails, binomial p = P(X ≥ 1 | n = 130, p = 0.01) = 0.729, scored against the 5σ + 1 bound 7.97. Test B: 7/130 flags, all isolated-early, binomial p = P(X ≥ 7 | n = 130, p = 0.05) = 0.475; a cherry-picked seed would show a broad flag across the full nonce range, and 0 of 130 seeds are off in both windows (FLAG at 2, FAIL at 3 under Binomial(130, 0.0025)). Test C: 3/130 seeds in the lowest 5% of their own null; if 10% of seeds had been chosen so that their served window sat in that tail, the test would fail with probability 0.46, at 25% with 0.9999. No statistical evidence of seed cherry-picking was found.

**Multi-account seed sharing.** The operator could supply identical server seeds to several accounts. This single-account audit did not test it (EC-10, S5-4).

**Client seed origin.** The client seed is generated by the player's browser ([client-seed-origin.png](evidence/client-seed-origin.png)) and only echoed by the server (the ten Phase D seeds come back in the capture's own form, Step 17); each epoch's `server_seed_hashed` was recorded as the previous rotation's `next_server_seed_hash` (for each dataset's first epoch, as the `next_server_seed_hash` that `GET /api/v2/client-seed` returned before any rotation), before the rotation that set the epoch's client seed, and that order is the capture's own record (P7), not something the hash link shows; the player can change it at any time through the rotation UI. Verdict on this check: Full Pass. Replay does not verify that the client seed is genuinely player-controlled; that rests on UI trust: the platform generates a default client seed, and the player can set a custom one at any time. The capture used its own generators (DL-1, DL-3).

**Forward commitment.** Step 2's 133 forward links plus the pre-capture link (134/134 chain assertions, 0 promotion mismatches, 0 capture-flag disagreements) show that the primary seed records form one unbroken chain: each epoch's active hash is the next-seed hash recorded at the rotation before it. That is a consistency check, not timing. Set membership alone would show only that a bet was served under some captured seed, leaving the operator free to choose, after seeing the bet, which seed it already holds to serve it under. What removes that freedom is the order in which the hashes were shown, and that order rests on the capture's recorded observations: it recorded each hash as "next" at one rotation and as active at the following one, both timestamped before the epoch's first bet record (finding 1 above), as far as the capture is faithful (P7).

### Scope boundaries and next capture

These are scope items, not findings:

- **R-1 External randomness beacon.** Binding an external public randomness beacon into the RNG would remove the theoretical seed-selection risk.
- **R-2 Multi-account audit (R-MULTI).** At least two funded accounts, comparing server seed hashes across accounts to detect reuse.
- **R-3 Extended multi-reveal coverage.** Phase E tested k=1, 2, 3 and 5 across mine counts 3, 5, 12 and 15 (plus E5 at k=1); higher k (up to 25−m) and other mine counts are not exercised, though the formula is structurally identical at all k.
- **R-4 Tile selection variation (R-TILE).** The primary capture reveals tile 0 on every bet (DL-8); varying the revealed tile across positions would add game-level evidence of shuffle uniformity beside the simulation's position tests.

Nothing in `data/` came from the following plan. The next capture's scripts, `mines-capture.js` (v6) and `mines-capture-phaseE.js` (v2), are kept in ProvablyFair.org's private workshop and are not published, because they place bets on duel.com; both pass `node --check` and neither has been run. The changes below describe those scripts and cannot be checked from this package. The versions the dataset came from are the `.reference.js` records in `capture/`. What changes, and which open item each change is for:

| Change | Open item |
|---|---|
| Every client seed, and the Phase A mine-count order and Phase D mine counts, drawn from the platform CSPRNG (`crypto.getRandomValues`; Node's `crypto.randomBytes` under Node), with rejection sampling for uniform characters; no `Math.random()` fallback — the script refuses to run without a CSPRNG. Each rotation record carries `clientSeedSource` and `clientSeedEchoMatch`. | DL-1, MINES-06 (A–C generator must be a CSPRNG) |
| Phase D custom seeds are `'pfaudit-'` + 16 CSPRNG characters instead of the wall clock. | DL-3 |
| The operator's full seed state before epoch 0 (`GET /api/v2/client-seed`) is saved verbatim as `meta.captureAnchor`. | MINES-02 pre-capture anchor, from a recorded response |
| Primary bets record `reveal_steps` — the multiplier quoted at the reveal as well as at settlement. | MINES-17 per-step multipliers on the primary corpus |
| A failed bet records the operator's nonce after the failure in `meta.captureEvents`. | DL-2 (a capture-retry gap becomes witnessed, not inferred) |
| Phase E adds E6: six (m, k) cells none of which v1 used — (1,10), (2,8), (10,4), (8,6), (20,2), (24,1) — 50 bets each, cycled bet by bet, with a per-step multiplier at every reveal (~65 cash-outs at the target depth expected). | MINES-15 / MINES-17 depth and mine-count spread |

A capture from these scripts needs the verifier's plan constants (`src/loader.ts`) and Step 17's Phase D decoding updated to the new seed format before it is scored.

## Terms

**RTP:** expected or observed return divided by stake; theoretical here unless labelled observed. **House edge:** one minus theoretical RTP; 0.1% at Duel's base tier, applied as × 0.999 on the raw combinatorial multiplier, rising to at most 1.0% with Duel's scaling edge (E14, as fetched 2026-10-05 in a logged-in session). **Scaling edge:** Duel's per-bet edge, which its settings (E14) tier by the potential profit at the current tile; only the 0.1% tier was captured ([Scaling edge](#scaling-edge)). **Anti-circularity:** deriving RTP from first principles without casino-supplied probabilities. **Backward Fisher-Yates shuffle:** iterate from index 24 down to 1, swapping each element with one at or below it. **Cursor:** the HMAC counter of a shuffle step, equal to the draw index 0–23 (docs/ALGORITHM.md §2; Duel's Verify-tab code increments it when all eight chunks are rejected, `src/rng.ts` stops with an error there). **Epoch:** bets sharing one (serverSeed, clientSeed) pair; 50 in this dataset, the capture's rotation interval. **Nonce:** per-bet counter within an epoch, from 0. **Commit-reveal:** publish a seed's SHA-256 before betting, reveal the seed after rotation. **Rejection sampling:** discard chunks at or above `floor(2^32 / r) · r` so every index is equally likely. **Mine positions:** the first `mines_count` shuffled tiles, sorted. **Revealed position:** the tile the player (or auto-bet) opens. **drand:** a public randomness beacon operated by the League of Entropy; not used here (no beacon field in either dataset).

## Release history

| Release | What changed | Verdict |
|---|---|---|
| `v1.0.0` | The original audit. | PROVABLY FAIR — Full Pass |
| `v1.1.0` | Re-certification under Framework 1.1, October 2026, below. The dataset of record is unchanged. | unchanged |
| `v1.2.0` | `src/rng.ts` rebuilt from a written specification; Duel's Verify-tab code kept as a second check, below. The dataset of record is unchanged. | unchanged |

### 21 October 2026 — final QA corrections (v1.2.0)

No code path, scored step status, figure or verdict changed; the datasets and every pinned artifact are unchanged.

- **Capture scripts.** [Dataset and capture](#dataset-and-capture) and [Scope boundaries and next capture](#scope-boundaries-and-next-capture) said the next capture's runnable scripts (`mines-capture.js` v6, `mines-capture-phaseE.js` v2) ship in the package. The release withholds every runnable capture tool, because they place bets on duel.com, and keeps them in ProvablyFair.org's private workshop; both sections now say so and name the two `.reference.js` records as the only capture files that ship.
- **Version labels.** The header, the README, `package.json`, `package-lock.json` and the release manifest named `v1.2.0-draft` / `1.1.0` and called v1.2.0 "unreleased"; they now name `v1.2.0`. The 19 October entry's wording lines are put in the past tense. The lockfile change was followed by `npm run build`: `verify.js` and `test.js` came back byte-identical, and `standalone-manifest.json` records the new lockfile hash.
- **Release wording.** At tagging, the README, this overview and the release manifest stopped describing `v1.2.0` as a draft until tagged. The release manifest records `v1.2.0`, superseding `v1.1.0`, and the fingerprint of the ProvablyFair.org signing key (`signature`, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), as tagged `v1.2.0`; it was refreshed with `npm run release-manifest`. No check, figure or verdict changed.

### v1.2.0 — RNG rebuilt from a written specification

Decision of 20 October 2026: an audit package's RNG code is rebuilt from a written specification, never ported from the casino's code; the casino's code stays only as a cross-check.

- **`src/rng.ts` is rebuilt from [docs/ALGORITHM.md](docs/ALGORITHM.md)** (a copy of the framework's `games/mines/ALGORITHM.md` with the spec author's workspace paths replaced by package paths or neutral wording (its header says so)), written from Duel's public pages, the standard provably-fair construction and the 7,050 live rounds without opening Duel's code, by an implementer who read only that spec and the module interface. Through v1.1.0 `src/rng.ts` was a port of Duel's Verify-tab code with a 16-line citation table (`OPERATOR_SOURCE_CITES`); the port, the table and its check (`checkOperatorCites`, one unit test, mutation M05h) are removed.
- **Three-way agreement, measured on all 7,050 captured rounds:** the rebuilt module against the live rounds (mine set, commitment and outcome 7,050/7,050; Phase E `is_mine` 1,173/1,173; multipliers within 1e-13 relative), against Duel's Verify-tab code (7,050/7,050) and against the provablyfair.org live verifier (7,050/7,050). Step 5 re-measures all three every run. Duel's code is run as a second check, not used as the source.
- **Where the two differ, on inputs no captured round reaches** (0 rejected chunks in the captured draws): for ranges 2, 4, 8 and 16 the spec's window `floor(2^32/r)·r` is 2^32 and accepts every chunk, where Duel's code rejects the top r values; when all eight chunks are rejected `src/rng.ts` stops with an error (spec O1), where Duel's code moves to the next cursor. DL-11 and P1 now say so; the expected rejection count of Step 5's census is 1.91×10⁻⁴ (2.36×10⁻⁴ under Duel's window).
- **The draw-bias bound moved to `src/bias.ts`**, the audit's own code, built on the rebuilt module's `drawFromChunk`, so it still measures the function the shuffle calls. Step 5's data for ranges 2, 4, 8 and 16 now records 0 rejected values; every range is still exact, bias 0.
- **[Verify a bet](#verify-a-bet) and [Commitment and shuffle](#commitment-and-shuffle)** now give the shuffle as the spec writes it (draw `i` = cursor, window `floor(2^32/r)·r`); the `verify-round.js` snippet was rerun on the worked vector and returns the served `mines_positions`, `hashMatches: true`.
- **Spec self-test:** `tests/mines/RngSpecTests.ts` runs the spec's vectors and properties (115 checks) as one unit test; with the citation test removed, the count stays 32.
- **Mutations retargeted to the rebuilt code:** M05, M06, M16, M16b (now the fair-multiplier product; `comb()` is gone) and M27; survivor S01 now makes the all-rejected branch return plain `v mod r`. M05h retired. 47 must-fail entries.
- **Records regenerated by the package's commands, each re-pinned in `src/artifact-pins.ts`:** `outputs/simulation-results.json` (`npm run simulate`; 1 of its 36,301 leaves changed, the Pass 1 description; the chart byte-identical); `outputs/payout-coverage.json` (`PF_EMIT=1 npm run verify`; the rebuilt `theoreticalMultiplier` multiplies the spec's factors (25 − t)/(25 − m − t) instead of dividing floating-point binomials, so the informational `multiplier` of 166 of its 1,099 leaves moved in the last bits, worst relative 5.9e-16); `outputs/verification-results.json` (pin set to a fixed point). The six simulation-forging mutations carry the new pin and recomputed forged hashes (the method reproduces the six previous hashes from the previous artifact). `verify.js` and `test.js` rebuilt with `npm run build`.
- **Mutation battery, 20 October 2026 (Apple M2 Max, Node 22.23.1, wall 2197 s):** 47/47 caught by their named step, 0 missed, 3 declared survivors, 26/26 scored steps killed.
- **No scored step status or verdict changed:** 25 PASS, one capture-origin FLAG, PROVABLY FAIR — Full Pass; `npm test` reproduces the committed artifacts.

### v1.1.0 — what changed

- **Scored steps: 23 in the original 4 June 2026 publication (public commit `6927bec`), 24 at the `v1.0.0` tag (public commit `a3b70c9`), 26 now.** The verdict is unchanged, PROVABLY FAIR — Full Pass. The dataset of record is byte-identical to v1.0.0. New since v1.0.0: Multiplier Monotonicity & Bounds and Live-Sample Fit (win rate & mine positions). Step 24, Artifact Integrity, was added on 14 September, before the v1.0.0 tag, and the tag's `outputs/verification-results.json` records results for steps 1–24; v1.0.0's README and MANIFEST still say 23, the count of the 4 June publication.
- **Step 4 (Nonce Audit) is now a capture-origin FLAG.** v1.0.0 checked the 130 primary epochs; this release also checks the 12 Phase E epochs, and the one nonce gap it finds there (Phase E, declared in `src/loader.ts` as a capture retry) is the FLAG. A capture-origin FLAG is disclosed and does not move the verdict; the step passed in v1.0.0.
- **RTP claim table, scored.** `outputs/rtp-claim-table.json` scores all 300 mine-count and cash-out cells, each against its own band: 1 − the house edge of the cell's first stake tier in Duel's game settings (E14), 99.9% on 294 cells (the effective_edge 0.1 served on all 6,500 bets) and 99.86–99.79% on the six full-board cash-outs; under RTP-CLAIM 1.2.0, switched on, the outcome is scored on Step 16. Outcome: pass (true minimum 99.790000%, true maximum 99.900000%; 0 of 300 cells beyond their band).
- **Pass 2 seed counts (6 October 2026):** Step 19 counts the seeds whose early and late windows are both off at p < 0.05 and scores the count against Binomial(130, 0.05 × 0.05): FLAG at 2 or more, FAIL at 3 or more. Each rule that can move Step 19 states its false-alarm rate on a fair game, at most 5% for a FLAG and 1% for a FAIL ([Verification results](#verification-results)). Measured: 0 of 130 seeds off in both windows; Step 19 PASS. No other step result, figure or verdict changed. In `outputs/verification-results.json` the Step 19 detail and data and the MINES-21 and MINES-29 notes changed; one unit test and mutations M19c (FLAG) and M19d (FAIL) were added.
- **Scaling edge (5 October 2026):** the RTP headline is scoped to Duel's 0.1% base tier, and Duel's scaling-edge settings (E14) are documented under [Scaling edge](#scaling-edge). No step result, figure or verdict changed; the RTP claim table's claim label now names the base tier and E14, the MINES-14 note in `outputs/verification-results.json` now names E14 among the sources checked (DL-6), two informational items there, not scored, check E14 and hold every captured bet to its 0.1% tier, and every captured bet was in the 0.1% tier.
- **Commitment timing (5 October 2026):** hash matches and forward links are described as consistency checks, and the pre-bet timing of each commitment is attributed to the capture's recorded observations, conditional on the new assumed premise P7 ([Limitations and trust](#limitations-and-trust)). E04 and E09 are labelled illustrative. [Verify a bet](#verify-a-bet) tells the player to save the commitment before betting and compare the revealed seed with that saved value. No step result, figure or verdict changed; in `outputs/verification-results.json` the Step 2 and Step 17 detail lines and the MINES-06, MINES-25 and MINES-30 notes were reworded.
- **Seed-record provenance, capture rotation and scaled-tier scope (6 October 2026):** [Dataset and capture](#dataset-and-capture) now says that primary `seeds[0].serverSeed`, that record's own seed, was added after the capture by a step not in the reference record, and finding 1 and P7 say its `at` dates its commitment, not its seed. The 50-bet epochs are described as the capture's rotation interval, not a Duel rule. The multiplier and RTP above the 0.1% tier are described as consistent with E14's tier boundaries, not observed: E14 holds no multiplier and no captured bet left the 0.1% tier. DL-2's attribution to the capture is marked inferred, the `round_id` jump is no longer cited as evidence on its own (`round_id` is not a per-player counter), and the README and S5-6 no longer say no operator-side gap exists. The client-seed paragraph attributes the order of commitment and client seed to the capture's records (P7). The **Added** line below no longer lists 18 Markdown report files: the 4 October consolidation folded them into README.md and this file, so the release carries two Markdown files, as v1.0.0 does. The dataset is unchanged. No step result, figure or verdict changed; in `outputs/verification-results.json` the MINES-04 note and the E14 informational item were reworded.
- **Errata (2026-09-29):** the RTP convergence chart (`outputs/rtp-convergence.html`) loaded Chart.js 4.4.7 from cdn.jsdelivr.net, so a pinned artifact depended on a third-party host. The same version is now inlined, byte for byte from the npm package pinned in package-lock.json. Every figure and data point in the chart is unchanged.
- **Screenshot captions (4 October 2026):** E05–E11 are now captioned by what each image shows. E08 is byte-identical to E05 and E11 to E09, as they were in v1.0.0; no screenshot was renamed, replaced or removed.
- **Screenshot E10:** other players' usernames in the Player column of the live-bets table are masked with a solid box; every other pixel is unchanged. The captured SHA-256 is kept under [Evidence](#evidence).
- **Added:** `LICENSE` (MIT), `.nvmrc` (Node 22), `RELEASE-MANIFEST.json` (written by `scripts/release-manifest.mjs`) and the mutation battery (`npm run mutate`, `tests/mutations.json`).

### 19 October 2026 — QA fixes before tagging

No draw check, scored step status or verdict changed: 25 PASS, one capture-origin FLAG, PROVABLY FAIR — Full Pass. The datasets are unchanged.

- **RTP claim: each cell against its own band, as in the Keno package.** The claim became kind `tiered` (RTP-CLAIM 1.2.0, decision D2): each of the 300 cells is priced at the first stake tier of its list in E14 and held to 1 − that tier's house_edge. 294 cells: 99.9%, unchanged. The six full-board cash-outs, which E14 gives no 0.1% tier, were tabled at 99.9% and held to 99.9%, the 0.1% tier Duel never prices them at; they are now 99.86% (10 and 15 mines, 0.14%), 99.82% (11 and 14, 0.18%) and 99.79% (12 and 13, 0.21%), each PASS against its own tier. Held to the old flat 99.9% at those figures, 12 and 13 mines would sit 0.11 pp below it, beyond the band. Outcome: PASS, 0 of 300 beyond their band; true minimum 99.790000%. Step 16's exact identity and float identity use the same per-cell edge (new data field `cellsAboveBaseTier`: 6). `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned; mutation MC3b now raises the stated figure of the 0.1% tier (the flat-claim line it edited is gone).
- **Step 8 also scores the 39 Phase E wins settled at depth 1.** Their two settled multiplier strings were held only to the ladder's range (Step 25), although DL-5 said every served multiplier is compared exactly. Measured: 39 of 39 equal the exact rationals at relative 1e-12; worst deviation still 6.4e-19.
- **Step 1 wording:** the three repeated reveals sit on the rotations that open Phases B, C and D (records 97, 118 and 123), not on end-of-phase rotations. **Step 3** now says that a bet's hash and client seed are the capture's copies of its rotation response, so the step binds the capture's records to each other. **The UTF-8 key claim** is now checked: the unit test computes the layouts under the UTF-8 key and requires all 7 vectors to differ (it used to recheck the hex key on one vector). The test count is unchanged, 32.
- **Wording:** the RNG was described as ported from Duel's published Verify-tab code, not as an independent reproduction (decision 1; since v1.2.0 it is rebuilt from `docs/ALGORITHM.md`, above), including the simulation artifact's Pass 1 description (`outputs/simulation-results.json` regenerated with `npm run simulate`; no figure changed); the next-capture scripts were no longer called unpublished (since 21 October the section says they are kept in the private workshop, as the release withholds them); the `drand_round` field, which neither dataset has, is no longer cited; the mines=24 p-value is 0.743; the mutation paragraph says what each of the 48 entries must produce (37 a FAIL of their named step); stale comments in `src/artifact-pins.ts` and `src/profile-map.ts` were corrected.
- **Records regenerated by the package's commands:** `outputs/rtp-claim-table.json` (`npm run rtp-claim:write`), `outputs/simulation-results.json` (`npm run simulate`; 1 of its 36,301 leaves changed, the description; the chart byte-identical), `outputs/verification-results.json` (`PF_EMIT=1 npm run verify`, pin set to a fixed point), each re-pinned; `verify.js` and `test.js` rebuilt with `npm run build`. The six simulation-forging mutations (M18, M19, M19b, M19c, M19d, M24b) carry the new artifact pin and recomputed forged hashes.
- **Mutation battery (Apple M2 Max, Node 22.23.1).** The whole registry in one `npm run mutate`: 42/48 caught by their named step and 3 declared survivors; the other 6 were the simulation-forging entries above, which could not be applied while they still named the replaced pin, so Step 19 had no killer in that run. After their re-pin, `npm run mutate -- M18 M19 M24b`: 7/7 caught by their named step. 48/48 across the two runs; MC3a and MC3b ended RTP FIGURE OVERSTATED, exit 5.

### 4 October 2026 — consolidated documentation

The 20 Markdown documents were reduced to **README.md and this MANIFEST.md**. Repeated explanations and superseded examples were removed; the datasets, evidence files, verifier copies, algorithm and settlement logic were retained. Documentation references in the profile-coverage map (`src/profile-map.ts`) and the RTP claim source (`src/rtp-settings.ts`) now point to the retained sections; the RTP claim table, the verification results, the zero-install bundles and the release manifest were regenerated by the package's own commands, with no change to any step result, figure or verdict. No new casino capture, simulation regeneration or mutation campaign is asserted for this update.

### 14 October 2026 (second pass) — an RTP miss ends RTP FIGURE OVERSTATED (FIXPASS2 class C3)

No verdict, scored step status or figure changed. `outputs/verification-results.json` was re-emitted (only the Step 16 detail line changed), re-pinned in `src/artifact-pins.ts`, and `verify.js` / `test.js` rebuilt with `npm run build` (`npm run check:build` reproduces them).

- **Step 16 no longer pre-empts the rule.** Its exact identity held the operator formula × counted survival to the claimed 999/1000 at every cell, so a cell paying less ended the run NOT PROVABLY FAIR (measured with MC3a on the 14 October tree: exit 1, `[FAIL] Step 16`). It now holds the identity to that cell's exact row in the RTP table (999/1000 at every honest cell); whether a row meets the claim is RTP-CLAIM's, on the same step.
- **Exit-5 mutations.** `tests/mutations.ts` gained `regen` (in the temp copy: the RTP table rewritten by `src/rtp-settings.ts` and re-pinned, then the committed record re-emitted with `PF_EMIT=1`, and its pin in `src/artifact-pins.ts` re-made), `expectExit` (the run must also end with that exit code), runner `test` (mocha, then the verifier) and reads the last line a step prints (a step RTP-CLAIM re-scores prints a second `[FLAG] Step N … (re-scored …)` line). New entries: MC3a (the paid multiplier of 1 mine, k = 24 lowered 1 % in `src/exact.ts`: 98.901 %) and MC3b (the claim raised to 100.1 %), each with the table and record regenerated and expected to end RTP FIGURE OVERSTATED, exit 5. MC3as and MC3bs make the same changes without regenerating the table and are expected to end exit 1: a committed RTP table that differs from the run, or from its pin, is a reproduction failure, miss or no miss.
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry (48 entries) in one `npm run mutate` on this tree, 14 October 2026 evening (baseline green): 48/48 must-fail mutations caught by their named step, 0 missed, 3 declared survivors, 26/26 scored steps covered. On 15 October `--only` (now taking several comma-separated substrings; name prefixes) reran the four C3 entries and every entry naming Step 16, the RTP-claim step (M16, M16b, MC3): 6/6 caught by their named step; MC3a and MC3b ended `VERDICT: RTP FIGURE OVERSTATED`, exit 5; MC3as and MC3bs exit 1 with the committed table reported as differing from the run.

### 14 October 2026 — Methodology v1.1

No draw check, scored step status, figure or verdict changed. The dataset is unchanged; of the hash-pinned artifacts only `outputs/verification-results.json` changed (its profile version, below) and was re-pinned.

- **Framework 1.1.** The audit is re-certified under ProvablyFair.org Framework 1.1 (decision D1); the release manifest's `framework` field and the release row above say 1.1.
- **RTP-CLAIM 1.2.0, switched on.** `src/rtp-claim.ts` is the framework's rule 1.2.0, byte-identical to `core/rtp-claim.ts` (SHA-256 `c9a9c1c4…5f131c`), and `src/rtp-claim-switch.ts` is set to true (decision D3). The outcome is scored on Step 16 (MINES-19): a house-side miss would be an operator-origin FLAG on that step and the verdict RTP FIGURE OVERSTATED, exit 5, never NOT PROVABLY FAIR. The claim source now names its place, the game settings (decision D2: "The edge in Duel's game settings counts"): house_edge 0.001, the first scaling-edge tier in E14. Outcome: pass, as before; a new [RTP claim](#rtp-claim) paragraph states it. In `outputs/rtp-claim-table.json` only `ruleVersion` and the source wording changed.
- **Profile.** The Mines profile version this suite cites is 1.0.2 (decision D6, approved as cited; the `-draft` suffix is dropped, no check changed). In `outputs/verification-results.json` only `profileCoverage.profileVersion` changed, and its pin in `src/artifact-pins.ts` was updated with it.
- **S5 level.** The adversarial matrix states the S5 level received: the fairness-integrity matrix; game-integrity testing was not commissioned (decision D5).
- **Exit 5** (RTP FIGURE OVERSTATED) is added to the exit codes.
- `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned, `outputs/verification-results.json` regenerated with `PF_EMIT=1 npm run verify` and re-pinned, `verify.js` and `test.js` rebuilt with `npm run build`, and the release manifest refreshed with `npm run release-manifest`. The mutation battery was rerun: 44/44 caught by their named step, 0 missed, 3 declared survivors, 26/26 scored steps killed.

### Where the former chapters went

| Former documentation | Consolidated location |
|---|---|
| `executive-summary.md`, `conclusion.md` | Conclusion and scope; README |
| `game-rules.md`, `system-architecture.md`, `rng-algorithm-analysis.md` | Game and algorithm |
| `game-logic-verifiability.md` | Verify a bet; Verification results; Limitations and trust |
| `live-parity-testing.md` | Dataset and capture; Verification results |
| `payout-verification.md`, `rtp-analysis.md` | Payouts and RTP; Verification results |
| `findings.md`, `exploit-testing.md`, `edge-case-analysis.md` | Verification results; Dataset and capture |
| `operator-trust-analysis.md`, `recommendations.md` | Limitations and trust |
| `reproducibility.md` | Reproduce the audit; Verify a bet |
| `evidence.md` | Evidence |
| `glossary.md` | Terms |
| `SUMMARY.md`, README table of contents | Contents; README |
