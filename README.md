# Duel Mines — Verifier

Independent verifier for the ProvablyFair.org audit of **Duel.com Mines**.

- **Audit report:** https://audit.provablyfair.org/casino/duel/games/mines/overview
- **Audit ID:** PF-2026-DL04
- **Audited:** April 2026
- **Algorithm:** HMAC-SHA256 (Fisher-Yates shuffle of 25 tiles via HMAC-driven indices; mines placed at first `mineCount` positions)

## What's in this repo

This is the verification codebase. It re-derives every audited Mines game from the captured dataset and the published algorithm. The full audit report — methodology, evidence, findings, recommendations — lives on the docusaurus page linked above.

## Reproduce

```sh
git clone git@github.com:ProvablyFair-org/duel-mines.git
cd duel-mines
npm install
npm test
```

`npm test` runs the full pipeline: unit tests + 24M-round simulation + 7,050-bet dataset verification. Expected: 23/23 PASS, **PROVABLY FAIR — Full Pass**.

Individual scripts:

```sh
npm run simulate   # 24M-round simulation across 24 mine-count configurations
npm run verify     # 23-step verification (including Phase E multi-reveal)
```

## Dataset

- **Master file:** `data/mines-master-6500bets.json`
  - **SHA-256:** `331f74ff98b88d06242d57e806186548612f13c4269eb754ebb571d8a6fc9b20`
  - 6,500 bets (Phase A: 4,800 · B: 1,000 · C: 200 · D: 500)
- **Phase E file:** `data/mines-phaseE-550bets.json` — 550 multi-reveal bets verifying intermediate game states
- **Total bets:** 7,050 across 5 phases
- **Configurations:** 24 (mine counts 1–24)
- **Multiplier formula:** `C(25,k) / C(25-mines,k) × 0.999` where `k` = tiles revealed

The verifier confirms the master dataset hash before running any checks. Tampering causes `npm test` to fail at startup.

## License

MIT
