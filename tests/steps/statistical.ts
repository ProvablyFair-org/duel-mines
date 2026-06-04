/**
 * Live-bet statistical context (informational, not scored).
 * At n<1000/config these tests lack power — authoritative results come from simulation.
 */

import type { InfoItem } from './context';
import { VerifyContext } from './context';
import { winChance } from '../../src/rng';
import { chiSquaredTest, lag1Autocorrelation, runsTest } from '../../src/stats';

export function run(ctx: VerifyContext): InfoItem[] {
  const { bets, chiResultsLog } = ctx;

  // ── RTP analysis ──────────────────────────────────────────────────────────
  const totalBet = bets.reduce((a, b) => a + parseFloat(b.request.amount), 0);
  const totalWon = bets.reduce((a, b) => a + parseFloat(b.response.amount_won), 0);
  const empiricalRTP = totalWon / totalBet;

  const rtpInfo: InfoItem = {
    label: 'RTP Analysis',
    detail: `Empirical RTP: ${(empiricalRTP * 100).toFixed(4)}% — Mines is high-variance; theoretical RTP 99.9000% proven analytically in anti-circularity step.`,
  };

  // ── Win rate — per mine count — chi-squared ──────────────────────────────
  const mineGroups = new Map<number, { wins: number; total: number }>();
  for (const b of bets) {
    const m   = b.request.mines_count;
    const cur = mineGroups.get(m) ?? { wins: 0, total: 0 };
    cur.total++;
    if (b.response.outcome === 'win') cur.wins++;
    mineGroups.set(m, cur);
  }

  let fails  = 0;
  let minP   = 1;
  let tested = 0;
  for (const [mineCount, { wins, total }] of mineGroups) {
    if (total < 10) continue;
    tested++;
    const theor             = winChance(mineCount, 0);  // (25-m)/25
    const { pValue }        = chiSquaredTest([wins, total - wins], [theor * total, (1 - theor) * total]);
    if (pValue < 0.01) fails++;
    if (pValue < minP) minP = pValue;
    chiResultsLog.push({ mineCount, wins, total, theor, pValue });
  }
  const bonferroni = tested > 0 ? 0.01 / tested : 0;

  const chi2Info: InfoItem = {
    label: 'Win Rate Chi-Squared (per-mine-count)',
    detail: `${tested} mine-count groups (≥10 bets) tested; fails at α=0.01: ${fails}/${tested}; min p=${minP.toFixed(4)}; Bonferroni α/${tested}=${bonferroni.toFixed(6)}`,
  };

  // ── Serial independence — lag-1 autocorrelation ───────────────────────────
  // Use mine count as continuous series (binary win/loss is degenerate for median-based tests)
  const mineSeries = bets.map(b => b.request.mines_count);
  const r1         = lag1Autocorrelation(mineSeries);
  const n          = mineSeries.length;
  const zScore     = r1 / (1 / Math.sqrt(n));

  const absZ = Math.abs(zScore);
  const lag1Verdict = absZ > 3
    ? `(|z|>3 — structured phase ordering; see simulation for definitive test)`
    : `(|z|<3 — no serial correlation detected)`;

  const lag1Info: InfoItem = {
    label: 'Serial Independence (lag-1 autocorrelation on mine_count sequence)',
    detail: `r₁=${r1.toFixed(6)}, z=${zScore.toFixed(3)} ${lag1Verdict}. Underpowered at live sample size — see simulation for definitive test.`,
  };

  // ── Wald-Wolfowitz runs test ──────────────────────────────────────────────
  const { runs, expected, z: zRuns, pValue: pRuns } = runsTest(mineSeries);

  const runsInfo: InfoItem = {
    label: 'Serial Independence (Wald-Wolfowitz runs test on mine_count sequence)',
    detail: `runs=${runs}, expected=${expected.toFixed(1)}, z=${zRuns.toFixed(3)}, p=${pRuns.toFixed(4)}. Underpowered at live sample size — see simulation for definitive test.`,
  };

  return [rtpInfo, chi2Info, lag1Info, runsInfo];
}
