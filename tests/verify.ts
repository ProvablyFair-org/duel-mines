/**
 * Mines audit verification suite — 23 scored steps + informational items.
 * Run: npm run verify
 * Expected: 23/23 PASS, verdict PROVABLY FAIR — Full Pass
 */

import * as fs   from 'fs';
import * as path from 'path';

import { loadDataset, checkDatasetHash, checkPhaseEHash, buildSeedMap, groupByHash, loadPhaseE } from '../src/loader';
import type { VerifyContext, InfoItem }                 from './steps/context';

import * as commitment   from './steps/commitment';
import * as determinism  from './steps/determinism';
import * as payouts      from './steps/payouts';
import * as statistical  from './steps/statistical';
import * as dataset      from './steps/dataset';
import * as simulation   from './steps/simulation';
import * as multireveal  from './steps/multireveal';

// ── Pre-flight: dataset hash ───────────────────────────────────────────────────

const hashCheck = checkDatasetHash();
console.log('\n  Dataset hash check (master):');
console.log(`    Expected: ${hashCheck.expected || '(not set)'}`);
console.log(`    Actual:   ${hashCheck.actual}`);
console.log(`    Status:   ${hashCheck.match ? 'MATCH ✓' : hashCheck.expected ? 'MISMATCH ✗ — abort' : 'HASH NOT SET — continuing'}\n`);
if (hashCheck.expected && !hashCheck.match) { process.exit(1); }

const phaseEHashCheck = checkPhaseEHash();
if (phaseEHashCheck) {
  console.log('  Dataset hash check (Phase E):');
  console.log(`    Expected: ${phaseEHashCheck.expected}`);
  console.log(`    Actual:   ${phaseEHashCheck.actual}`);
  console.log(`    Status:   ${phaseEHashCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — abort'}\n`);
  if (!phaseEHashCheck.match) { process.exit(1); }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const ds      = loadDataset();
const phaseE  = loadPhaseE();
const allSeeds = phaseE ? [...ds.seeds, ...phaseE.seeds] : ds.seeds;
const seedMap  = buildSeedMap(allSeeds);

const bets   = ds.bets;
const seeds  = ds.seeds;
const phaseA = bets.filter(b => b.phase === 'A');
const phaseB = bets.filter(b => b.phase === 'B');
const phaseC = bets.filter(b => b.phase === 'C');
const phaseD = bets.filter(b => b.phase === 'D');
const phaseEBets = phaseE ? phaseE.bets : [];

const outputsDir = path.join(__dirname, '../outputs');

console.log('══════════════════════════════════════════════════════════');
console.log('  MINES AUDIT — VERIFICATION SUITE');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Primary dataset: ${bets.length} bets  |  Seeds: ${seeds.length}`);
console.log(`  Phase A: ${phaseA.length}  Phase B: ${phaseB.length}  Phase C: ${phaseC.length}  Phase D: ${phaseD.length}`);
console.log(`  Phase E (multi-reveal): ${phaseEBets.length} bets  |  Seeds: ${phaseE ? phaseE.seeds.length : 0}\n`);

// ── Build context ─────────────────────────────────────────────────────────────

const byHash = groupByHash(bets);

const ctx: VerifyContext = {
  bets, seeds, seedMap, byHash,
  phaseA, phaseB, phaseC, phaseD,
  outputsDir,
  step5Mismatches: 0,
  step5Skipped:    0,
  chiResultsLog:   [],
};

// ── Run scored steps ─────────────────────────────────────────────────────────

const results = [
  ...commitment.run(ctx),                    // Steps  1– 4
  ...determinism.run(ctx),                   // Steps  5– 6
  ...payouts.run(ctx),                       // Steps  7–12
  ...dataset.run(ctx),                       // Steps 13–17
  ...simulation.run(ctx),                    // Steps 18–19
  ...multireveal.run(phaseEBets, seedMap),   // Steps 20–23
];

// ── Run informational items (live-bet stats — underpowered, not scored) ──────

const infoItems: InfoItem[] = statistical.run(ctx);

// ── Summary ───────────────────────────────────────────────────────────────────

const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
const verdict  = hardFail > 0
  ? 'NOT PROVABLY FAIR'
  : flags > 0
    ? 'PROVABLY FAIR — Conditional Pass'
    : 'PROVABLY FAIR — Full Pass';

// Display informational items
if (infoItems.length > 0) {
  console.log('');
  console.log('  ┌── Informational Context (not scored) ──');
  for (const item of infoItems) console.log(`  │ ${item.label}: ${item.detail}`);
  console.log('  └──');
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
console.log(`  Flags:      ${flags}`);
console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Write output ──────────────────────────────────────────────────────────────

if (!fs.existsSync(outputsDir)) fs.mkdirSync(outputsDir, { recursive: true });

fs.writeFileSync(path.join(outputsDir, 'verification-results.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalBets:   bets.length + phaseEBets.length,
  totalSeeds:  allSeeds.length,
  steps:       results,
  info:        infoItems,
  summary:     { passed, flags, hardFail, verdict },
}, null, 2));

fs.writeFileSync(path.join(outputsDir, 'determinism-log.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  verified:    bets.length - ctx.step5Skipped,
  mismatches:  ctx.step5Mismatches,
  skipped:     ctx.step5Skipped,
}, null, 2));

fs.writeFileSync(path.join(outputsDir, 'chi-squared-results.json'), JSON.stringify({
  generatedAt: new Date().toISOString(),
  groups:      ctx.chiResultsLog,
}, null, 2));

console.log(`  Outputs written to: outputs/verification-results.json`);
console.log(`  Outputs written to: outputs/determinism-log.json`);
console.log(`  Outputs written to: outputs/chi-squared-results.json`);

if (hardFail > 0) process.exit(1);
