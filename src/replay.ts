/**
 * FULL REPLAY of the committed simulation experiment — `npm run replay` (~20 minutes: 1,144 s measured).
 *
 * The verifier replays the first PASS1_CHECKPOINT_ROUNDS rounds of every Pass-1 config and every
 * captured early window of Pass 2 on each run (tests/steps/simulation.ts). This script replays ALL
 * of it from the pinned seeds (src/sim-plan.ts) and the revealed casino seeds, and compares every
 * INTEGER census field of outputs/simulation-results.json exactly — the profile's "census
 * byte-for-byte" (MINES-20). It writes outputs/run/replay.json and exits 1 on any difference. It
 * never writes the committed artifact.
 */

import * as fs from 'fs';
import * as path from 'path';

import { computeMinePositionsFromBuffer } from './rng';
import { loadDataset, buildSeedMap } from './loader';
import { encodeWinBits } from './sim-census';
import {
  SIM_SEEDS, SIM_CONFIGS, SIM_ROUNDS_PER_CONFIG, SIM_NONCES_PER_SEED, SIM_EPOCH_LENGTH, SIM_PASS2_MINE_COUNT,
} from './sim-plan';

const OUT = path.join(__dirname, '..', 'outputs');
const sim = JSON.parse(fs.readFileSync(path.join(OUT, 'simulation-results.json'), 'utf8'));
const diffs: string[] = [];
const t0 = Date.now();

// ── Pass 1: every census field of every config ──────────────────────────────
SIM_CONFIGS.forEach((m, i) => {
  const row = sim.pass1_fresh_seeds.results[i];
  const key = Buffer.from(SIM_SEEDS[i].server, 'hex');
  const counts = new Array(25).fill(0);
  let wins = 0, adj = 0, transitions = 0, prev = -1, first = -1, last = -1;
  for (let nonce = 0; nonce < SIM_ROUNDS_PER_CONFIG; nonce++) {
    const mines = computeMinePositionsFromBuffer(key, SIM_SEEDS[i].client, nonce, m);
    for (const t of mines) counts[t]++;
    const w = mines.includes(nonce % 25) ? 0 : 1;
    wins += w;
    if (prev >= 0) { if (w !== prev) transitions++; if (w === 1 && prev === 1) adj++; }
    if (nonce === 0) first = w;
    last = w;
    prev = w;
  }
  const c = row?.census ?? {};
  const want: Record<string, unknown> = { rounds: SIM_ROUNDS_PER_CONFIG, wins, adjacentWinPairs: adj, transitions, firstOutcome: first, lastOutcome: last };
  for (const [k, v] of Object.entries(want)) if (c[k] !== v) diffs.push(`pass1 m=${m} census.${k}: artifact ${c[k]} vs replay ${v}`);
  if (JSON.stringify(c.positionCounts) !== JSON.stringify(counts)) diffs.push(`pass1 m=${m} census.positionCounts differ`);
  process.stdout.write(`\r  Pass 1 replayed m=${m} (${((Date.now() - t0) / 1000).toFixed(0)} s)   `);
});
process.stdout.write('\n');

// ── Pass 2: every row's win counts and every Test C window ───────────────────
const ds = loadDataset();
const seedMap = buildSeedMap(ds.seeds);
for (const row of sim.pass2_casino_seeds.results) {
  const ss = seedMap.get(row.serverSeedHashed);
  if (!ss) { diffs.push(`pass2 ${row.serverSeedHashed.slice(0, 16)}: seed not revealed in the dataset`); continue; }
  const key = Buffer.from(ss, 'hex');
  let early = 0, late = 0;
  const windows: number[][] = Array.from({ length: SIM_NONCES_PER_SEED / SIM_EPOCH_LENGTH }, () => []);
  for (let n = 0; n < SIM_NONCES_PER_SEED; n++) {
    const won = !computeMinePositionsFromBuffer(key, row.clientSeed, n, SIM_PASS2_MINE_COUNT).includes(n % 25);
    if (won) { if (n < SIM_EPOCH_LENGTH) early++; else late++; }
    const served = row.servedConfigs[n % SIM_EPOCH_LENGTH];
    windows[Math.floor(n / SIM_EPOCH_LENGTH)].push(computeMinePositionsFromBuffer(key, row.clientSeed, n, served).includes(0) ? 0 : 1);
  }
  if (row.earlyWins !== early || row.lateWins !== late) diffs.push(`pass2 ${row.serverSeedHashed.slice(0, 16)}: wins ${row.earlyWins}/${row.lateWins} vs replay ${early}/${late}`);
  const bits = windows.map(encodeWinBits);
  if (JSON.stringify(bits) !== JSON.stringify(row.windowWinBits)) diffs.push(`pass2 ${row.serverSeedHashed.slice(0, 16)}: Test C window bits differ`);
}

fs.mkdirSync(path.join(OUT, 'run'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'run', 'replay.json'), JSON.stringify({
  runtime: process.versions.node,
  pass1Configs: SIM_CONFIGS.length, roundsPerConfig: SIM_ROUNDS_PER_CONFIG,
  pass2Seeds: sim.pass2_casino_seeds.results.length, noncesPerSeed: SIM_NONCES_PER_SEED,
  reproduced: diffs.length === 0, differences: diffs,
}, null, 2));
console.log(`  Replay of the committed simulation: ${diffs.length === 0 ? 'every census field REPRODUCED' : `${diffs.length} DIFFERENCE(S)`}`
  + ` (${((Date.now() - t0) / 1000).toFixed(0)} s, Node ${process.versions.node}) — outputs/run/replay.json`);
for (const d of diffs.slice(0, 10)) console.log(`    ${d}`);
if (diffs.length) process.exit(1);
