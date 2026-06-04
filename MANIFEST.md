# Manifest — Duel Mines Audit

- **Audit ID:** PF-2026-DL04
- **Publication date:** 4 June 2026
- **Audit report:** https://audit.provablyfair.org/casino/duel/games/mines/overview
- **Auditor:** ProvablyFair.org
- **Audit date:** April 2026

## Algorithm

Backward Fisher-Yates shuffle of the 25-tile grid with per-step rejection sampling. After the shuffle, the first `mineCount` positions in the shuffled order are mines; the rest are safe.

```
key       = hexDecode(serverSeed)
positions = [0, 1, ..., 24]

for i from 24 downto 1:
    cursor  = 24 - i
    range   = i + 1
    maxFair = 0xFFFFFFFF - (0xFFFFFFFF % range)
    loop:
        message = clientSeed + ":" + nonce + ":" + cursor
        hmac    = HMAC-SHA256(key, message)
        scan 4-byte chunks of hmac:
            value = parseInt(chunk, 16)
            if value < maxFair:
                j = value % range
                swap positions[i], positions[j]
                break
        if no chunk accepted: cursor += 1; retry

mines = positions[0..mineCount-1] sorted
safe  = positions[mineCount..24]
```

The rejection-sampling guard (`value < maxFair`) eliminates modulo bias when the 32-bit chunk does not divide evenly by `range`.

The multiplier for revealing `k` safe tiles with `mines` mines on the board is:

```
multiplier = C(25,k) / C(25-mines,k) × 0.999    // flat 0.1% house edge
```

No operator-supplied table — the formula is derived from the combinatorics of safe-tile selection.

## Dataset

- **Master file:** `data/mines-master-6500bets.json`
- **Master SHA-256:** `331f74ff98b88d06242d57e806186548612f13c4269eb754ebb571d8a6fc9b20`
- **Phase E file:** `data/mines-phaseE-550bets.json` (multi-reveal validation)
- **Total bets:** 7,050
- **Phases:**
  - A — 4,800 bets — baseline configuration coverage
  - B — 1,000 bets — high-variance sampling
  - C — 200 bets — bet-size invariance ($10 vs $0.01)
  - D — 500 bets — client seed verification
  - E — 550 bets — multi-reveal intermediate-state verification

## Verification

- **Verification steps:** 23 scored steps in `tests/verify.ts` (includes Phase E multi-reveal check)
- **Unit tests:** Mocha (`tests/**/*Tests.ts`)
- **Simulation:** 24,000,000 rounds across 24 mine-count configurations
- **Anti-circularity:** theoretical RTP independently derived from `C(25,k)/C(25-mines,k) × 0.999` for every (mineCount, tilesRevealed) combination — flat 0.1% house edge confirmed
- **Expected `npm test` result:** 23/23 PASS · PROVABLY FAIR — Full Pass

## Reproducibility

Cloning this repo at the publication commit and running `npm install && npm test` reproduces the entire audit pipeline. Both datasets are hash-verified at startup; the verifier recomputes every mine placement from `(serverSeed, clientSeed, nonce)`; the simulation re-derives RTP from independent combinatorics (not casino-supplied data).
