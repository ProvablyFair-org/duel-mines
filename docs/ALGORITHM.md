# Duel.com Mines: clean-room algorithm specification

> Package copy of the ProvablyFair.org audit framework's `games/mines/ALGORITHM.md`.
> It differs from that file only where the file named locations or tracking items
> in the spec author's workspace: those now read as paths inside this package or as
> neutral wording. No rule, number, vector or source note was changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of Duel.com Mines.

This document is the only input an implementer needs to rebuild Duel Mines'
mine layout and settlement. It was written without opening any Duel source
code, any port of it, or any copy of Duel's in-site verifier code (see §8 for
the files and URLs read, and the ones deliberately not read). Every step names
where it came from:

- **PAGE**: Duel's public pages, quoted with location and date.
- **STANDARD**: the standard provably-fair construction used across the
  industry (SHA-256 commitment to a server seed; HMAC-SHA256 keyed by the server
  seed over `clientSeed:nonce:cursor`; 4 bytes to an integer; Fisher–Yates
  shuffle).
- **DATA**: fixed by testing the standard candidates against all 7,050 live
  rounds in `data/mines-master-6500bets.json`
  (6,500 single-reveal rounds, captured 16 Apr 2026, phases A–D) and
  `mines-phaseE-550bets.json` (550 multi-reveal rounds, captured 21 Apr 2026,
  phases E1–E5). The data chose; Duel's code did not.
- **CONFIG**: Duel's public mines settings, `GET /api/v2/mines/settings?mines=<m>`
  for m = 1…24, captured 5 Oct 2026 as
  `evidence/settings/mines-settings-m01.json` …
  `m24.json` (with `.meta.json` recording path, status 200 and fetch time).

The pages say what goes in. They do not say how it is combined, so all of §2
and most of §3 was settled by DATA.

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 64 lowercase hex characters (32 bytes); secret until the pair is rotated | PAGE: "Server seed - a random string provided by us" (E02; live page 20 Oct 2026). Form: DATA (all 142 revealed seeds are 64 hex) |
| `clientSeed` | text string | PAGE: "Client seed - a random string provided by you" (E02). Default: 16 characters from `A–Z a–z 0–9 _`, generated in the browser (client-seed-origin.png; E04/E09 show such values, e.g. `mCM_r4DEB_HNt5OM`). Phase D used player-set seeds such as `pfauditmo125o3q` |
| `nonce` | integer ≥ 0; 0 on the first round after a rotation, +1 per round | PAGE: "Nonce - a number that increases with each bet" (E02); "Nonce 0" on a fresh pair (E04, E09). DATA: nonces 0–49 |
| `mines` (m) | integer 1…24 | PAGE: "Number of Mines" selector (E01, E05–E07 show 3, 24, 12). DATA: all 24 values captured. CONFIG: one settings file per m = 1…24 |
| `amount` | stake, decimal | DATA (`request.amount`: 0.01 and 10) |
| revealed tiles | ordered list of distinct tile indices 0…24 chosen by the player | DATA (`revealed_positions`, `reveal_steps[].position`) |

The board has 25 tiles (PAGE: 5 × 5 grid in E01, E05–E07). Tiles are indexed
0…24 in every record (DATA). How an index maps to a grid cell is not settled
(O5).

### 1.2 Commitment

PAGE (duel.com/provably-fair, Overview; E02, and rendered live 20 Oct 2026 with
the same text):

> "We then send you the hex-encoded SHA-256 hash of our server seed before you
> place your bets, to prove we won't change our minds."
>
> "After the game, we reveal the unhashed Server Seed. You can verify that: The
> server seed matches the original hash. The combined seeds generated the exact
> result you played."

The page does not say which bytes are hashed. Spec:

```
commitment = lowercase_hex( SHA-256( hex_decode(serverSeed) ) )
```

i.e. hash the **32 raw bytes**, not the 64 ASCII characters.

- SOURCE: STANDARD + DATA. Candidates: SHA-256 over the ASCII hex string →
  **0 of 142** round commitments resolve; over the hex-decoded bytes →
  **142 of 142** resolve, covering **7,050 / 7,050** rounds.
- Pairing seeds to rounds: **by hashing, never by record position.** A rotation
  record carries the *new* pair's hash next to the *old* seed it reveals (e.g.
  in Phase E the first record has `serverSeed: null` and hash `f85bab93…`; the
  seed `1cdcd1d1…` that hashes to `f85bab93…` appears in the *next* record).
  Build `{commitment(seed): seed}` over all revealed seeds and look each round's
  `serverSeedHashed` up in it.
- Forward chain: each rotation also shows the next-seed hash in advance (E04/E09
  "Next server seed (Hashed)"; dataset field `nextServerSeedHash`), which must
  equal the active hash after the rotation.

---

## 2. Mine layout derivation

PAGE gives only the inputs:

> "Then we combine all of these values to generate a random result for each
> round: Fair result = Server seed + Client seed + Nonce" (E02; live page
> 20 Oct 2026)

### Step 1: one HMAC per draw (cursor = draw index)

```
key        = hex_decode(serverSeed)                                   # 32 bytes
digest(i)  = HMAC-SHA256(key, UTF-8(clientSeed + ":" + dec(nonce) + ":" + dec(i)))
```

`dec(x)` is plain base-10, no padding (`0`, `15`, `49`). Draw number `i`
(i = 0, 1, …, 23) uses its own digest, with cursor `i`.

- SOURCE: STANDARD (HMAC-SHA256, server seed as key, `client:nonce:cursor` as
  message) + DATA for the key form, separator and cursor rule.
- Candidates tried (all on 7,050 rounds unless noted): key = hex-decoded bytes
  or the ASCII string; message `c:n:i`, `c:n-i`, `c-n-i`; one digest per draw
  (cursor = draw index) versus one continuous byte stream (`c:n:0` digest, then
  `c:n:1`, … consumed 4 bytes at a time), versus `c:n` followed by `c:n:1…`,
  versus a re-hash chain. Only **key = hex bytes, message `c:n:i`, one digest per
  draw** reproduces the data: **7,050 / 7,050**. The continuous-stream form
  scored 53 / 307 on a sample (it agrees only when m = 24, where a single draw
  decides the layout; all 52 sampled m = 24 rounds matched and 1 of 255 others).
  The other per-draw combinations scored ≤ 285 / 7,050; the other stream
  combinations (210 in all) scored ≤ 53 / 307 on the sample.

### Step 2: bytes to an index in [0, r)

```
draw(i, r):
    LIMIT = floor(2^32 / r) * r
    for off in 0, 4, 8, …, 28:
        v = digest(i)[off .. off+3] read as unsigned 32-bit BIG-ENDIAN
        if v < LIMIT: return v mod r
    # all 8 chunks rejected: see O1
```

- SOURCE: DATA for "first 4 bytes, big-endian, mod r"; STANDARD for the
  rejection loop. The rejection region has 2^32 mod r < 25 values, so a chunk is
  rejected with probability < 6 × 10⁻⁹; **0 rejections in 169,200 draws**
  (7,050 rounds × 24). The data therefore cannot tell rejection from plain
  `v mod r`; both give 7,050 / 7,050 (O1).
- Candidates tried: u32 big-endian with rejection (7,050), u32 big-endian plain
  mod (7,050), u32 little-endian with rejection (285), float from 4 bytes
  `Σ bₜ/256^(t+1)` × r floored (≤ 72), `(v × r) >> 32` (≤ 72).

### Step 3: Fisher–Yates shuffle, from the end

```
a = [0, 1, 2, …, 24]
for i in 0 … 23:
    r = 25 − i                 # 25, 24, …, 2
    j = draw(i, r)             # 0 ≤ j < r
    swap a[r − 1], a[j]
mines = set( a[0 .. m−1] )     # the first m entries
safe  = the other 25 − m tiles
```

- SOURCE: STANDARD (Fisher–Yates, backward form) + DATA for direction and which
  end holds the mines.
- Only the first `25 − m` draws affect the mine *set* (after them `a[m..24]` are
  fixed). The full 24-draw shuffle is specified because it is the standard form;
  whether Duel performs draws beyond `25 − m` cannot be seen, because the capture
  records the mine set sorted, not in draw order (O2).
- Consequence worth knowing: the first draw, `draw(0, 25)`, is always a **safe**
  tile (it is swapped into `a[24]`). Checked: 7,050 / 7,050.
- Candidates tried (with each stream/mapping above): backward Fisher–Yates with
  mines = first m (**7,050**), backward with mines = last m (≤ 72), forward
  Fisher–Yates (≤ 72), "pick from a shrinking list" (splice) with mines = first
  m picks (≤ 73), draw-until-m-distinct (sample only, ≤ 5 / 307).

### Step 4: what the round record must equal

`mines_positions` (served, sorted ascending) must equal `sorted(mines)`, with
exactly m distinct indices in 0…24. DATA: **7,050 / 7,050**.

The layout depends only on (serverSeed, clientSeed, nonce, m). It does not
depend on the stake or on the tiles the player opens.

---

## 3. Win condition and payout

### 3.1 Win condition

Let `rev = [p₁, …, p_k]` be the opened tiles, in order, all distinct.

```
loss ⇔ some pₜ ∈ mines; the round ends on that tile (it is the last one, and no earlier pₜ is a mine)
win  ⇔ no pₜ ∈ mines; the player cashed out after k safe reveals (k ≥ 1)
```

- SOURCE: PAGE for the game shape only (grid + "Number of Mines", E01; no rules
  text exists on the game page, rendered 20 Oct 2026). DATA for the rule:
  `outcome` agrees and every bust ends on exactly the first mine opened,
  **7,050 / 7,050**; in Phase E `reveal_steps[].is_mine` equals
  `position ∈ mines` on **1,173 / 1,173** steps.
- Depth `k` = number of safe reveals at cash-out (`len(revealed_positions)` on a
  win). Phases A–D always open one tile (k = 1); Phase E opens 1–5.

### 3.2 Fair multiplier (no edge)

```
M(m, k) = C(25, k) / C(25 − m, k) = ∏_{t=0}^{k−1} (25 − t) / (25 − m − t)        (exact rational)
```

This is 1 / P(survive k reveals), with P = C(25−m, k)/C(25, k).

- SOURCE: STANDARD (multiplier = 1/probability) + DATA.
- The served field holding this value is **`multiplier`**. Note the naming: the
  field `no_house_edge_multiplier` holds the value **with** the edge (§3.4).
  DATA: `multiplier = 25/11 = 2.272727…` and `no_house_edge_multiplier =
  2.270454…` (= 0.999 × 25/11) on round 25075325.
- Depth 1: served `multiplier` = `M(m,1) = 25/(25−m)` rounded half-up to 18
  decimals on **2,834 / 2,834** depth-1 wins (all 24 mine counts).
- Depth ≥ 2: the served value is a fixed number per (m, k) cell (one distinct
  value per cell in the data) that is **not** always the 18-decimal rounding of
  the exact rational. Measured on the 795 safe reveal steps of Phase E:
  424 / 795 equal exact-at-18-dp. The deviating cells and their relative
  deviation `(served − exact)/exact`:

  | m, k | served | relative deviation |
  |---|---|---|
  | 3, 2 | 1.298701298701298702 | +1 × 10⁻¹⁸ (last digit only) |
  | 3, 3 | 1.493506493506500975 | +5.00 × 10⁻¹⁵ |
  | 3, 4 | 1.729323308270692621 | +9.21 × 10⁻¹⁵ |
  | 3, 5 | 2.017543859649134666 | +5.88 × 10⁻¹⁵ |
  | 5, 2 | 1.578947368421045983 | −4.21 × 10⁻¹⁵ |
  | 5, 3 | 2.017543859649124399 | +7.89 × 10⁻¹⁶ |
  | 12, 3 | 8.041958041957998093 | −5.45 × 10⁻¹⁵ |

  Exact at 18 dp in the data: (12,2), (15,2) and all depth-1 cells. Maximum
  |relative deviation| on any served multiplier: **9.21 × 10⁻¹⁵**. Note that
  (3,5) and (5,3) have the *same* exact value (2.0175438596491228…) but
  different served values, so the deviation depends on the path, not only on
  the exact probability. Candidates tried to reproduce the deviation, none of
  which matched all cells: exact rational at 18 dp (26 / 33 distinct winning
  cells); iterative `round18(previous served × (26−k)/(26−m−k))` (146 / 443
  steps at k ≥ 2); 1 / P with P computed in IEEE doubles by product, by
  comb ratio, by factorials, by exp-of-logs or by lgamma, then rounded to 15,
  16 or 17 significant digits (≤ 26 / 33). Not settled (O3).
- Implementation rule: compute `M(m,k)` exactly; compare a served value with
  a relative tolerance of **1 × 10⁻¹³** (10× the worst observed deviation) and
  report the cell and its deviation. For settlement (§3.5) use the **served**
  value, because that is what the data shows Duel credits.

### 3.3 House edge

```
tier = the entry in CONFIG(m).scaling_edge[str(k)] with  min_bet ≤ amount < max_bet
e    = Decimal(tier.house_edge)                   # "0.001" = 0.1 %
```

- SOURCE: CONFIG (a table keyed by mine count m, then by depth `k` = 1…25−m,
  then by stake band; 80–91 contiguous bands per cell, `min_bet` of band 1 = 0,
  each band's `max_bet` = the next band's `min_bet`, last band edge 0.01). The
  first band's edge is 0.001 in every cell except six deep cells where it starts
  higher: (10,15) 0.0014, (11,14) 0.0018, (12,13) 0.0021, (13,12) 0.0021,
  (14,11) 0.0018, (15,10) 0.0014. Band limits shrink with depth (smallest
  first-band `max_bet`: 0.0101 at (11,14); 62 cells have a first-band
  `max_bet` ≤ 10), so the band must be looked up per cell, never assumed.
  DATA: served `effective_edge` (a percentage, `0.1`) equals `100 × e` from this
  lookup on **2,967 / 2,967** wins. Every captured win landed in a 0.001 band,
  including the Phase C wins at stake 10 (k = 1; the smallest k = 1 first-band
  `max_bet` is 1042.75, at m = 24).
- Higher bands and the band boundary rule are not witnessed (O4).
- The game UI labels the game "Zero Edge" (E01, E05–E07, E10; live game page
  20 Oct 2026). The edge actually applied on every captured win was 0.1 %.
- PAGE (duel.com/economics-changelog, rendered 20 Oct 2026): "The current edge
  is shown on-screen while betting." The page's only entry (16/07/2026) concerns
  Blackjack, not Mines.

### 3.4 Edged multiplier

```
M_e = round18_half_up( M_served × (1 − e) )
```

Served in the field **`no_house_edge_multiplier`** (misnamed; see §3.2). DATA:
**2,967 / 2,967** wins (half-up and half-even agree on every captured value;
truncation 1,876, ceiling 1,714). `M_e` computed from the exact rational
instead matches only 1,978 / 2,967.

### 3.5 Payout

```
win : amount_won = round18_half_up( amount × M_served × (1 − e) )     # one rounding, from the served 18-dp M
loss: amount_won = 0
```

- DATA: **2,967 / 2,967** wins; using the exact rational instead of the served
  multiplier gives 2,743 / 2,967, and `amount × M_e` (double rounding) gives
  2,862 / 2,967. Losses pay 0 on **4,083 / 4,083**.
- `amount_won` and the multipliers are served sometimes with trailing zeros
  removed (`"25"`, `"0.24975"`, `"6.66"`). Compare numerically.
- On a loss, the served `multiplier` is the multiplier of the last safe depth
  (`1.000000000000000000` when the first tile is a mine), and
  `no_house_edge_multiplier` is null: **4,083 / 4,083** (checked within
  relative 10⁻¹³ against depth k−1).
- Rounding tie mode (half-up vs half-even) is not distinguishable (O6).

### 3.6 Fields an implementation must not read

`mines_positions`, `outcome`, `multiplier`, `no_house_edge_multiplier`,
`effective_edge`, `amount_won`, `reveal_steps[].is_mine` and
`reveal_steps[].multiplier` are the operator's claims, to be checked. The
derivation reads only `serverSeed`, `clientSeed`, `nonce`, `mines`, `amount`,
the opened tiles in order, and the CONFIG table.

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE | E02; live overview page 20 Oct 2026 |
| Commitment = SHA-256, hex output | PAGE + STANDARD | E02 "hex-encoded SHA-256 hash of our server seed" |
| Hash input = hex-decoded 32 bytes | DATA | 142/142 commitments (ASCII form 0/142) |
| Seed↔round pairing by hash | DATA | rotation records reveal the old seed next to the new hash |
| HMAC-SHA256, key = hex-decoded seed | STANDARD + DATA | 7,050/7,050 |
| Message `clientSeed:nonce:i`, one digest per draw, cursor = draw index | STANDARD + DATA | 7,050/7,050; continuous stream 53/307 sample; other formats ≤ 285 |
| First 4 bytes, big-endian u32, mod r | DATA | 7,050/7,050; LE ≤ 285, float ≤ 72 |
| Rejection ≥ floor(2³²/r)·r, next chunk | STANDARD | 0 rejections in 169,200 draws; O1 |
| Backward Fisher–Yates, mines = a[0..m−1] | STANDARD + DATA | 7,050/7,050; other selections ≤ 73 |
| Win ⇔ no opened tile is a mine; bust on first mine | DATA | 7,050/7,050 rounds; 1,173/1,173 reveal steps |
| Fair multiplier C(25,k)/C(25−m,k) | STANDARD + DATA | depth 1: 2,834/2,834 at 18 dp; depth ≥ 2: ≤ 9.21e-15 relative off; O3 |
| Edge = CONFIG[m][k][amount band] | CONFIG + DATA | 2,967/2,967 (0.001 bands only); O4 |
| Edged multiplier = round18(M_served × (1−e)) | DATA | 2,967/2,967 |
| Payout = round18(amount × M_served × (1−e)) | STANDARD + DATA | 2,967/2,967 wins; 4,083/4,083 losses = 0 |

---

## 5. Test vectors (from the dataset)

Each vector is copied from the dataset with the server seed found by hashing.
`j` lists `draw(i, 25−i)` for i = 0, 1, …; only the first `25 − m` matter for
the mine set, and all 24 are given so the full shuffle can be checked. `a` is
the array after all 24 swaps. Edge e = 0.001 for all.

**V1: round 25075325** (master, Phase A, m = 14, win)
```
serverSeed  b255e0f55d255669bbd42a777b0e6b6570027b058d1db571df57325a2269a75f
commitment  eecc6f36cd2e55109959a19a9667bfcccf27e8a75842bd800d77ed054766ff30
clientSeed  EveJlkDtA24dfvBr   nonce 0   mines 14   amount 0.01
HMAC(c:n:0) d8c82daaf242ea5ba5ca52d18e08be828e15c15fee8f51973911469f01bc4067   u32 3636997546 → j0 = 21
j   21 23 2 3 10 11 12 12 6 9 0 | 7 10 3 10 5 5 1 1 5 1 3 1 1
a   14 22 4 19 16 8 13 1 15 5 17 24 20 7 0 9 6 18 12 11 10 3 2 23 21
mines [1,4,5,7,8,13,14,15,16,17,19,20,22,24]
opened [0] → win, k = 1
multiplier 2.272727272727272727   edged 2.270454545454545454   amount_won 0.022704545454545455
```

**V2: round 25075327** (master, Phase A, m = 10, loss on the first tile)
```
serverSeed  b255e0f55d255669bbd42a777b0e6b6570027b058d1db571df57325a2269a75f   (same pair as V1)
clientSeed  EveJlkDtA24dfvBr   nonce 1   mines 10   amount 0.01
HMAC(c:n:0) 5de7e7ab4cdd39936f3e058521d1f15414cc6dd2f96827cfd64a224ea1edf04c   u32 1575479211 → j0 = 11
j   11 2 7 5 5 12 7 14 1 5 7 4 2 9 7 | 3 3 7 3 5 4 0 0 1
a   19 16 6 0 13 15 8 10 24 3 17 9 23 4 18 20 1 14 22 12 21 5 7 2 11
mines [0,3,6,8,10,13,15,16,19,24]
opened [0] → 0 is a mine → loss
multiplier 1.000000000000000000   edged null   amount_won 0
```

**V3: round 25093502** (master, Phase B, m = 24, win: one draw decides it)
```
serverSeed  85d82d87a05cf35f0a9f7034445116b6699b14e3d5a327bbd0621d048c1538f2
commitment  d3d3dd69ce358290923fdb59bc947b9e89dfa0ea347fdce24003d2a4de7cfcb3
clientSeed  MyJHJQbUNoMYs6pl   nonce 15   mines 24   amount 0.01
HMAC(c:n:0) 986f71f47d18b7503a570d789fe6c73aa95dc5b7da574a7356473d94c80e86a0   u32 2557440500 → j0 = 0
j   0 | 20 4 7 17 7 2 15 15 3 11 5 11 9 6 6 1 5 2 0 3 0 2 0
a   8 22 12 19 16 24 18 13 1 10 6 9 14 5 11 3 23 15 2 21 17 7 4 20 0
mines = every tile except 0
opened [0] → win, k = 1
multiplier 25   edged 24.975   amount_won 0.24975
```

**V4: round 25096590** (master, Phase C, m = 12, stake 10, win)
```
serverSeed  81cdd7a5a05c174b67774d5fb2adddcf5d81924ee3fc14c03ac735a5e3348696
commitment  76cec60726b0a093a27bae9aee6f8bc12fe0a42cd2cddcc0549f1669a9c168ee
clientSeed  fwt1E7WgzgXJZXfA   nonce 0   mines 12   amount 10
HMAC(c:n:0) e9567f0b2a55780d47634e3e7569bc8403a5c2ea47c5c72eb3b852fe79f6a358   u32 3914759947 → j0 = 22
j   22 8 6 3 7 11 1 0 3 12 8 2 9 | 1 9 9 0 5 0 1 4 1 1 1
a   24 13 16 20 4 19 14 5 17 10 15 18 9 2 23 12 21 0 1 11 7 3 6 8 22
mines [4,5,10,13,14,15,16,17,18,19,20,24]
opened [0] → win, k = 1
multiplier 1.923076923076923077   edged 1.921153846153846154   amount_won 19.211538461538461539
```

**V5: round 25753723** (Phase E1, m = 3, five reveals then cash-out; a deviating cell)
```
serverSeed  1cdcd1d16090b08915c3bf8da241aa5db94605244449f8fd67cf92e7f21eb0f7
commitment  f85bab9377e3e732e93d8f47b2c952f1294f1a2c7aca469ab88d90cb33728173
clientSeed  Bw2ll1YE0PQa1CGz   nonce 0   mines 3   amount 0.01
HMAC(c:n:0) bd7c7c8f79a519a5a93f03d386dbcab9cd24c090460af2b5eda3364601a7db60   u32 3179052175 → j0 = 0
j   0 0 13 13 4 10 15 16 11 7 12 0 1 7 10 5 5 3 4 4 2 1 | 1 0
a   8 21 17 14 2 6 20 3 9 5 19 18 1 23 12 7 11 16 15 10 4 22 13 24 0
mines [8,17,21]
opened 0,1,2,3,4 → all safe → win, k = 5
step multipliers (served) 1.136363636363636364, 1.298701298701298702, 1.493506493506500975,
                          1.729323308270692621, 2.017543859649134666
exact M(3,5) = 115/57 = 2.017543859649122807…   (served is +5.88e-15 relative)
edged 2.015526315789485531 (= round18(2.017543859649134666 × 0.999))
amount_won 0.020155263157894855 (= round18(0.01 × 2.017543859649134666 × 0.999))
```

**V6: round 25753730** (Phase E1, m = 3, bust on the third reveal)
```
serverSeed  1cdcd1d1…eb0f7 (as V5)   clientSeed Bw2ll1YE0PQa1CGz   nonce 2   mines 3   amount 0.01
HMAC(c:n:0) 158337274f2245c668e91686c6a99b7ee7a1cb6a394f69fe16bf02417797fb96   u32 360920871 → j0 = 21
j   21 1 21 16 7 7 15 10 3 2 1 1 6 1 4 9 1 5 5 2 0 1 | 2 0
a   22 17 12 8 0 18 19 5 11 9 4 13 6 14 23 2 3 10 15 20 7 16 24 1 21
mines [12,17,22]
opened 10 (safe), 11 (safe), 12 (mine) → loss
step multipliers 1.136363636363636364, 1.298701298701298702, 1.298701298701298702 (bust keeps the k−1 value)
amount_won 0
```

---

## 6. Open points the public sources do not settle

- **O1: rejection continuation.** This spec rejects a 4-byte chunk ≥
  floor(2³²/r)·r and moves to the next chunk of the same digest. The data has no
  rejection (0 in 169,200 draws; probability < 6 × 10⁻⁹ per draw), so it cannot
  tell this from plain `v mod r`, nor say what happens if all 8 chunks are
  rejected. Plain `mod r` would skew each index's probability by at most about
  r/2³² (≤ 5.8 × 10⁻⁹), which exceeds the profile's 2⁻³² floor unless r is a
  power of 2; so for MINES-08 which form Duel uses matters, and it is
  unwitnessed. To settle: Duel's written rules, or a nonce found by
  search on a revealed seed whose chunk is rejected, checked on Duel's Verify
  page.
- **O2: draw order and draw count.** Captures store the mine set sorted, so the
  order in which mines were placed, and whether Duel performs the draws beyond
  `25 − m`, are not observable. The set is unaffected either way.
- **O3: multi-reveal multiplier digits.** At depth ≥ 2, 6 of the cells seen
  deviate from the exact rational by up to 9.21 × 10⁻¹⁵ relative (house side in
  (5,2) and (12,3), player side in the others), and one more by 1 in the 18th
  decimal. The deviation is fixed per (m, k) cell, depends on the path ((3,5) ≠
  (5,3) although the exact values are equal), and no tested formula reproduces
  it. Effect on a payout is below 10⁻¹⁴ of the stake. Phase E covers mine
  counts 2, 3, 4, 5, 8, 12, 15 and depths ≤ 5; depth ≥ 2 cells are witnessed
  only for m = 3, 5, 12, 15. All other depth ≥ 2 cells are unwitnessed.
- **O4: edge bands and timing.** Only the 0.1 % band was exercised. The band
  boundary (`min_bet ≤ amount < max_bet`), the currency basis of `amount` for
  band selection, and the edge applied at a deeper depth than the stake band
  was chosen for (is the band picked at cash-out depth k, as assumed?) are not
  witnessed. The CONFIG was captured 5 Oct 2026; the rounds on 16 and 21 Apr
  2026. It agrees with every captured round, but the April config was not
  captured.
- **O5: tile numbering.** Records use indices 0…24. Which grid cell is index 0
  and whether numbering runs by row or by column is not stated on any public
  page read and is not observable in the data (a player-facing README needs it,
  MINES-25). E03 (`E03-fairness-verify-mines.png`) was deliberately not opened;
  see §8.
- **O6: rounding tie mode.** Half-up and half-even agree on every captured
  value; the tie mode is unsettled.
- **O7: the public page names no algorithm.** "Fair result = Server seed +
  Client seed + Nonce" does not say HMAC, the key form, the cursor or the
  shuffle. Everything in §2 beyond the inputs rests on STANDARD + DATA, not on a
  written Duel rule. Mines has no rules text on its game page (rendered
  20 Oct 2026 logged out: bet amount, number of mines, "Zero Edge", "Provably
  Fair", bet tables).
- **O8: client-seed encoding beyond ASCII.** UTF-8 is assumed; all captured
  client seeds are ASCII.

---

## 7. Reproduction of this spec

Implemented independently in throwaway scripts outside the repo
(`spec_check.py`, `steps.py`, `perdraw.py`, `search.py`, `mult.py`,
`vectors.py`: the spec author's check scripts) and run on every round. Output of
`python3 -I spec_check.py`, 20 Oct 2026:

```
commitments (hex-decoded) resolved: 142
commitments (ascii) resolved: 0
commitments total: 142
bets: 7050
layout match: 7050
structure ok: 7050
outcome match: 7050
wins: 2967
served multiplier == exact @18dp half-up: 2848
wins depth1: 2834
depth1 served==exact@18dp: 2834
effective_edge == 100*config edge: 2967
edged mult == round18(served*(1-e)): 2967
amount_won == round18(amt*served*(1-e)): 2967
amount_won == round18(amt*exact*(1-e)): 2743
losses: 4083
loss pays 0: 4083
loss multiplier == depth k-1 value (served): 4083
reveal steps: 1173
reveal step is_mine match: 1173
rejection census: {'rejected chunk': 0} over 169200 draws
max |served-exact|/exact over wins: 5.878e-15
cells where served != exact@18dp: {(3, 5): ('2.017543859649134666', '2.017543859649122807', '5.878e-15'), (5, 3): ('2.017543859649124399', '2.017543859649122807', '7.891e-16'), (12, 3): ('8.041958041957998093', '8.041958041958041958', '-5.455e-15')}
```

Output of `python3 -I steps.py` (Phase E reveal steps):

```
safe reveal steps: 795
step == exact@18dp: 424
steps k>=2: 443
step == round18(prev_served * (26-k)/(26-m-k)): 146
max rel dev 9.211e-15
{(3, 3): ['+5.00e-15'], (3, 4): ['+9.21e-15'], (3, 5): ['+5.88e-15'], (5, 2): ['-4.21e-15'], (5, 3): ['+7.89e-16'], (12, 3): ['-5.45e-15']}
```

Top of the candidate search, `python3 perdraw.py` (all 7,050 rounds):

```
(7050, 'hex', '{c}:{n}:{i}', 'u32be_rej', 'fy_back_firstm')
(7050, 'hex', '{c}:{n}:{i}', 'u32be_mod', 'fy_back_firstm')
(285, 'hex', '{c}:{n}:{i}', 'u32le_rej', 'fy_back_firstm')
(73, 'hex', '{c}:{n}-{i}', 'u32be_rej', 'splice')
```

---

## 8. Files and URLs read while writing this spec

Read: `evidence/` E01, E02, E04, E05, E06, E07,
E09, E10 (PNG; E08 and E11 are byte-identical to E05 and E09 by SHA-256 and were
not opened separately), `client-seed-origin.png` (Duel's client-seed
*generator*, not the mines derivation); `evidence/settings/mines-settings-m01…m24.json`
(m01, m03, m24 inspected by eye, all 24 loaded by the check script) and
`mines-settings-m03.json.meta.json`; `data/mines-master-6500bets.json`,
`data/mines-phaseE-550bets.json`; the audit framework's `games/mines/profile.json`;
the audit framework's `games/dice/ALGORITHM.md` (model of shape).
Live pages, GET, logged out, 20 Oct 2026: `https://duel.com/provably-fair`
(Overview text), `https://duel.com/economics-changelog`, `https://duel.com/mines`
(game page text). A plain `curl` of `/provably-fair` and `/mines` returned only
the SPA shell.

Not opened: `evidence/E03-fairness-verify-mines.png` (a capture of Duel's Verify
tab for Mines, which may show verifier code; skipped to keep the clean room —
it was only hashed with `shasum`), anything under `evidence/verify-tab/`, any
`verifier-parity`, `src/`, `tests/`, `scripts/`, `capture/`, `verify.js`,
`test.js`, `MANIFEST.md` or `README.md` of any Duel or verifier package, any
saved Duel JS bundle, and Duel's Verify tab. When the browser was closed, the
tool reported the tab's URL as `https://duel.com/provably-fair/verify`; no
content of that page was read (the last read was the `/mines` page text).
