import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { MinesDataset, MinesGame, SeedEntry } from './types';

const DATASET_PATH   = path.join(__dirname, '../data/mines-master-6500bets.json');
const PHASE_E_PATH   = path.join(__dirname, '../data/mines-phaseE-550bets.json');
const EXPECTED_HASH  = '331f74ff98b88d06242d57e806186548612f13c4269eb754ebb571d8a6fc9b20';
const PHASE_E_HASH   = 'def563907949db10d584256a13b33102dfa46d33509424f642f803d74cd1b17b';

export function getDatasetPath(): string { return DATASET_PATH; }
export function getPhaseEPath(): string { return PHASE_E_PATH; }

export function loadDataset(): MinesDataset {
  const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
  return JSON.parse(raw) as MinesDataset;
}

export function loadDatasetBuffer(): Buffer {
  return fs.readFileSync(DATASET_PATH);
}

export function checkDatasetHash(): { expected: string; actual: string; match: boolean } {
  const raw = fs.readFileSync(DATASET_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { expected: EXPECTED_HASH, actual, match: actual === EXPECTED_HASH };
}

/**
 * Build O(1) map: serverSeedHashed → serverSeed (plaintext).
 *
 * In the Duel dataset, seeds[N].seed.serverSeed is the PREVIOUS epoch's
 * revealed seed. The plaintext for seeds[N].serverSeedHashed is in
 * seeds[N+1].seed.serverSeed. We verify the hash before adding.
 */
export function buildSeedMap(seeds: SeedEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < seeds.length - 1; i++) {
    const next = seeds[i + 1];
    if (next.seed.serverSeed) {
      const h = crypto.createHash('sha256')
        .update(Buffer.from(next.seed.serverSeed, 'hex'))
        .digest('hex');
      if (h === seeds[i].seed.serverSeedHashed) {
        m.set(seeds[i].seed.serverSeedHashed, next.seed.serverSeed);
      }
    }
  }
  return m;
}

/** Group bets by serverSeedHashed (epoch). */
export function groupByHash(bets: MinesGame[]): Map<string, MinesGame[]> {
  const m = new Map<string, MinesGame[]>();
  for (const b of bets) {
    const hash = b.seed.serverSeedHashed;
    const arr = m.get(hash) ?? [];
    arr.push(b);
    m.set(hash, arr);
  }
  return m;
}

/** Count how many revealed tiles avoided mines (successful picks). */
export function countRevealed(bet: MinesGame): number {
  return bet.response.revealed_positions.length;
}

/** Load Phase E supplementary dataset (multi-reveal bets). */
export function loadPhaseE(): MinesDataset | null {
  if (!fs.existsSync(PHASE_E_PATH)) return null;
  const raw = fs.readFileSync(PHASE_E_PATH, 'utf-8');
  return JSON.parse(raw) as MinesDataset;
}

/** Check Phase E dataset hash. */
export function checkPhaseEHash(): { expected: string; actual: string; match: boolean } | null {
  if (!fs.existsSync(PHASE_E_PATH)) return null;
  const raw = fs.readFileSync(PHASE_E_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { expected: PHASE_E_HASH, actual, match: actual === PHASE_E_HASH };
}

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE so a shrunken dataset cannot pass by agreeing with
// itself. Deleting rounds and doctoring the header to match leaves a file that is
// internally consistent and re-pins cleanly — and re-pinning is exactly what a forger
// does, so EXPECTED_HASH cannot see it. The counts have to be asserted from somewhere
// the dataset does not control, and a step that finds them wrong must HARD FAIL.
export const EXPECTED_BETS  = 6500;
export const EXPECTED_SEEDS = 134;
export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 4800, B: 1000, C: 200, D: 500 });
