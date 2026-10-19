import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { MinesDataset, MinesGame, SeedEntry } from './types';

const DATASET_PATH   = path.join(__dirname, '../data/mines-master-6500bets.json');
const PHASE_E_PATH   = path.join(__dirname, '../data/mines-phaseE-550bets.json');
const EXPECTED_HASH  = '331f74ff98b88d06242d57e806186548612f13c4269eb754ebb571d8a6fc9b20';

// Phase E is a SECOND DATASET OF RECORD, not a supplement: steps 20–23 — the entire k>1
// multi-reveal case — are scored against it and nothing else. It had no pinned hash. The
// function that computed its digest returned the digest and no expected value, so there was
// nothing to compare against and no caller ever compared. Replacing this file wholesale went
// undetected, and deleting it merely downgraded four scored steps to FLAG.
const PHASE_E_EXPECTED_HASH = 'def563907949db10d584256a13b33102dfa46d33509424f642f803d74cd1b17b';

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

/**
 * One epoch = one rotation record in `seeds[]` and the bets captured while it was active.
 *
 * THE KEY IS NOT THE HASH. The old grouping keyed bets on their own `serverSeedHashed` and then
 * asserted one distinct `serverSeedHashed` per group — a tautology that could not fail on any
 * input. Membership here comes from the CAPTURE TIMELINE instead: a bet belongs to the last
 * rotation record whose `at` precedes it. That source knows nothing about the hash the bet
 * carries, so "every bet in this epoch carries the epoch's committed hash" becomes a claim the
 * data can contradict. A bet captured before any rotation record is an ORPHAN and is reported,
 * never silently dropped.
 */
export interface EpochGroup {
  /** Index into `seeds[]`. */
  index: number;
  record: SeedEntry;
  bets: MinesGame[];
}

export function groupByEpochWindow(
  bets: MinesGame[],
  seeds: SeedEntry[],
): { epochs: EpochGroup[]; orphans: MinesGame[] } {
  const epochs: EpochGroup[] = seeds.map((record, index) => ({ index, record, bets: [] }));
  const orphans: MinesGame[] = [];
  for (const b of bets) {
    // ISO-8601 UTC timestamps compare correctly as strings; a linear scan keeps it obvious.
    let idx = -1;
    for (let j = 0; j < seeds.length; j++) {
      if (seeds[j].at <= b.at) idx = j; else break;
    }
    if (idx < 0) { orphans.push(b); continue; }
    epochs[idx].bets.push(b);
  }
  return { epochs, orphans };
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

/**
 * Check the Phase E dataset against its pin.
 *
 * `present: false` is a FAILURE, not an absence to be tolerated: steps 20–23 are scored
 * against this file, so a missing one means those steps decided nothing. The previous form
 * returned the computed digest with no expected value beside it, which cannot be a check.
 */
export function checkPhaseEHash(): { present: boolean; expected: string; actual: string; match: boolean } {
  if (!fs.existsSync(PHASE_E_PATH)) {
    return { present: false, expected: PHASE_E_EXPECTED_HASH, actual: '', match: false };
  }
  const raw = fs.readFileSync(PHASE_E_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { present: true, expected: PHASE_E_EXPECTED_HASH, actual, match: actual === PHASE_E_EXPECTED_HASH };
}

// ── POPULATION OF RECORD ─────────────────────────────────────────────────────────
// The capture plan, stated as CODE, beside the dataset pins above.
//
// A dataset that agrees with its own header proves nothing: delete rounds, shrink the header
// to match, and the file is internally consistent and re-pins cleanly — and re-pinning is
// exactly what a forger does, so the hash pins cannot see it either. The counts have to be
// asserted from somewhere the dataset does not control, and a step that finds them wrong must
// FAIL rather than report.
export const EXPECTED_BETS   = 6500;
export const EXPECTED_SEEDS  = 134;
export const EXPECTED_EPOCHS = 130;
export const EPOCH_SIZE      = 50;

export const EXPECTED_PHASE_BETS: Readonly<Record<string, number>> =
  Object.freeze({ A: 4800, B: 1000, C: 200, D: 500 });
export const EXPECTED_PHASE_SEEDS: Readonly<Record<string, number>> =
  Object.freeze({ A: 97, B: 21, C: 5, D: 11 });

// Every epoch carrying bets has its plaintext revealed by the following rotation, so 100% of
// captured bets are recomputable. Binding the commitment and determinism steps to this is what
// stops "0 mismatches" passing on an empty or truncated seed list.
export const EXPECTED_REVEALED_EPOCHS = 130;

// One per phase change: the rotation that opens a phase re-reveals the previous record's seed (the
// previous phase's final bet-bearing seed, two records back), not the seed of the bet-less
// end-of-phase record just before it. A property of the capture plan, not a free skip.
export const EXPECTED_PHASE_BOUNDARY_SKIPS = 3;

// Forward commitment links: seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed.
export const EXPECTED_CHAIN_LINKS = EXPECTED_SEEDS - 1;

// The 24 mine counts are this game's only configuration dimension, and the floor is the
// smallest number of live bets one of them must carry before the audit claims to have
// exercised it.
export const MINE_COUNTS = 24;
export const MIN_BETS_PER_MINE_COUNT = 100;

// ── PHASE E POPULATION ───────────────────────────────────────────────────────────
// Steps 20–23 score the k>1 multi-reveal case against this corpus alone.
export const EXPECTED_PHASE_E_BETS  = 550;
export const EXPECTED_PHASE_E_SEEDS = 17;
export const EXPECTED_PHASE_E_BETS_BY_PHASE: Readonly<Record<string, number>> =
  Object.freeze({ E1: 100, E2: 100, E3: 200, E4: 100, E5: 50 });
/** Non-mine reveal steps carrying a multiplier, across k = 1..5. */
export const EXPECTED_PHASE_E_REVEAL_STEPS = 795;
export const EXPECTED_PHASE_E_MAX_K        = 5;
/** Phase E bets that disclose mines_positions, so the mine set can be recomputed. */
export const EXPECTED_PHASE_E_MINE_DISCLOSURES = 550;
export const EXPECTED_PHASE_E5_BETS            = 50;
/** Cash-outs at k > 1 — the payouts step 7 cannot reach. */
export const EXPECTED_PHASE_E_CASHOUTS_K_GT_1  = 133;
/** Every reveal step in the corpus, mine hits included (795 safe + 378 mine hits). */
export const EXPECTED_PHASE_E_REVEAL_STEPS_TOTAL = 1173;
/**
 * Phase E bets whose tiles were revealed in NON-ASCENDING order. Reveal-order independence —
 * the layout does not depend on the sequence the tiles are opened in — is only evidenced if
 * such bets exist, so their count is bound here rather than left to whatever the file holds.
 */
export const EXPECTED_PHASE_E_NON_ASCENDING_ORDERS = 11;

// ── AUDIT IDENTITY ───────────────────────────────────────────────────────────────
// The audit ID as a code constant, emitted into outputs/verification-results.json so the ID a
// reader sees in README.md / MANIFEST.md is the ID the verifier ran under (profile MINES-28).
export const AUDIT_ID = 'PF-2026-DL04';

/**
 * The unit-test count, as a code constant (profile MINES-28). The zero-install runner (test.js,
 * scripts/standalone-runtime.cjs) counts every passing spec and exits nonzero unless the count is
 * exactly this; scripts/unit-parity.mjs also requires MANIFEST.md and Mocha to agree. A describe
 * block that is skipped or never registered therefore cannot leave the run green.
 */
export const EXPECTED_UNIT_TESTS = 32;

// ── NONCE BASE ───────────────────────────────────────────────────────────────────
// The first nonce of every epoch, DECLARED — never the minimum observed. Duel serves nonce 0 as the
// first bet after a client-seed rotation (evidence E11, rotation response nonce 0).
export const NONCE_BASE = 0;

// ── PHASE E SEED POPULATION ─────────────────────────────────────────────────────
// The Phase E rotation records, counted the same way as the primary ones. 17 records; 16 links;
// 12 of the 16 reveals hash to the immediately preceding commitment and 4 are end-of-sub-phase
// rotations that re-reveal the previous record's seed (which hashes to the record two back).
export const EXPECTED_PHASE_E_SEEDS_BY_PHASE: Readonly<Record<string, number>> =
  Object.freeze({ E1: 3, E2: 3, E3: 6, E4: 3, E5: 2 });
export const EXPECTED_PHASE_E_CHAIN_LINKS = EXPECTED_PHASE_E_SEEDS - 1;
export const EXPECTED_PHASE_E_PHASE_BOUNDARY_SKIPS = 4;

/**
 * Phase E epochs, keyed by the capture timeline (groupByEpochWindow over the Phase E seeds), by
 * rotation-record index → the number of bets captured under it. Every record not listed carries
 * no bets. Two epochs are NOT 50: seeds[9] holds 49 (one capture-retry gap, nonce 12 — see
 * DECLARED_CAPTURE_RETRY_GAPS) and seeds[10] holds 1 (the sub-phase's 200th bet, placed after the
 * rotation the retry pushed forward). Pinned whole, so a shrink or a moved bet FAILs.
 */
export const EXPECTED_PHASE_E_EPOCH_SIZES: Readonly<Record<number, number>> = Object.freeze({
  0: 50, 1: 50, 3: 50, 4: 50, 6: 50, 7: 50, 8: 50, 9: 49, 10: 1, 12: 50, 13: 50, 15: 50,
});

/**
 * CAPTURE-RETRY NONCE GAPS — the auditor-side register (profile MINES-04, policy decided
 * 2026-09-17). A gap listed here is a nonce the OPERATOR consumed for a round the CAPTURE never
 * recorded: the capture's bet request failed after the round was placed (capture/
 * mines-capture-phaseE.reference.js:580 `bet failed` path), so the nonce advanced with no record written. Step 4
 * reports it as a FLAG with origin = capture — disclosed, verdict-neutral. A gap NOT listed here is
 * treated as operator-side and is a HARD FAIL; a listed gap that is not found is a FAIL too (the
 * register is stale). Each row names its limitation id in MANIFEST.md.
 *
 * Evidence for the one row (measured 2026-09-23): E3 epoch seeds[9] (serverSeedHashed d6ff34bb…)
 * holds nonces 0-11 and 13-49; round_id jumps 25754616 → 25754625 and the capture clock 30 s
 * across the gap (≈3 s between neighbours elsewhere); the E3 position pattern [11,12,13] — the one
 * due at nonce 12 in the pattern rotation — is served 7 times against 8 for its neighbours.
 * round_id is not a per-player counter (measured 2026-10-06: consecutive captured Phase E bets
 * differ by 1-10, median 2, with no nonce missing), so its jump does not on its own show a lost
 * round; the clock gap and the pattern count carry the attribution, which is inferred.
 */
export const DECLARED_CAPTURE_RETRY_GAPS: ReadonlyArray<{ dataset: 'primary' | 'phaseE'; seedIndex: number; nonce: number; dl: string }> =
  Object.freeze([{ dataset: 'phaseE', seedIndex: 9, nonce: 12, dl: 'DL-2' }]);

// ── CAPTURE PLAN, AS CODE (profile MINES-15) ─────────────────────────────────────
/** Phase A: every one of the 24 mine counts, 200 bets each. */
export const PHASE_A_BETS_PER_MINE_COUNT = 200;
/** The profile's floor for Phase A coverage: at least this many bets per configuration. */
export const PHASE_A_FLOOR_PER_CONFIG = 50;
/** Phase C: the profile requires >= 100 elevated-stake WINS to exercise the payout path. */
export const PHASE_C_MIN_WINS = 100;
export const PHASE_C_MINE_COUNT = 12;
export const PHASE_C_STAKE = '10';
export const BASE_STAKE = '0.01';

/**
 * The multi-reveal plan (capture/mines-capture-phaseE.reference.js:22 PHASES): mine counts, target depth and
 * bet count per sub-phase; E5 cycles four mine counts over five first-pick tiles.
 */
export const PHASE_E_PLAN: Readonly<Record<string, { mines: number[]; targetK: number; bets: number; firstPicks?: number[] }>> =
  Object.freeze({
    E1: { mines: [3],  targetK: 5, bets: 100 },
    E2: { mines: [5],  targetK: 3, bets: 100 },
    E3: { mines: [12], targetK: 3, bets: 200 },
    E4: { mines: [15], targetK: 2, bets: 100 },
    E5: { mines: [2, 4, 8, 15], targetK: 1, bets: 50, firstPicks: [3, 7, 11, 17, 23] },
  });
/** The multi-reveal phase must open every one of the 25 tiles as a FIRST pick somewhere. */
export const FIRST_PICK_TILES_REQUIRED = 25;

// ── OUTCOME POPULATION (MINES-10 / MINES-11) ─────────────────────────────────────
export const EXPECTED_PRIMARY_WINS   = 2795;
export const EXPECTED_PRIMARY_LOSSES = 3705;
export const EXPECTED_PHASE_E_WINS_K1 = 39;
export const EXPECTED_PHASE_E_LOSSES  = 378;

// ── PHASE D PREDICTABLE CLIENT SEEDS (MINES-06 disclosure) ────────────────────────
/**
 * The Phase D client seeds were generated as 'pfaudit' + Date.now().toString(36)
 * (capture/mines-capture.reference.js:411 and :432), i.e. the capture's wall clock in milliseconds. They are therefore
 * PREDICTABLE, and the epochs they seeded are the exposed ones. Pinned by rotation-record index so
 * Step 17 can prove the disclosure matches the data rather than restate it.
 */
export const PHASE_D_PREDICTABLE_EPOCHS: ReadonlyArray<number> =
  Object.freeze([123, 124, 125, 126, 127, 128, 129, 130, 131, 132]);
export const PHASE_D_SEED_PREFIX = 'pfaudit';

// ── MAX-ODDS CAP (MINES-14, under the proposed rule R2, pending profile owner) ────
/**
 * The operator's declared maximum paid multiplier for Mines, or null when it declares none. Under
 * the proposed rule R2 the cap half of MINES-14 is scored against every multiplier the operator
 * SERVED or SETTLED in the capture (a served figure above the cap FLAGs; formula cells above it
 * are counted and disclosed, not failed), and when no cap is declared that half is n/a with the
 * evidence cited — the monotonicity half is asserted either way (Step 25).
 *
 * null, and why (enumerated 2026-09-24 — what was checked AND what was not):
 *   - both datasets: a key walk over meta, every seed record, every bet and every reveal step finds
 *     no key matching CAP_FIELD_PATTERN — Duel's bet, reveal and cash-out responses carry no cap,
 *     max-payout or max-profit field (Step 25 repeats this walk on every run and FLAGs if one
 *     appears while no cap is declared);
 *   - the captured screens: the Mines game panel (evidence E01, E05, E07 — bet amount, ½ / 2x /
 *     MAX stake buttons, mine count; no payout or odds limit shown), the Provably Fair overview
 *     (E02) and Verify tab (E03), the seed panels (E04, E09, E11) and the bet feed (E10) show no
 *     maximum multiplier, payout or profit figure;
 *   - the mines settings endpoint, GET /api/v2/mines/settings?mines=N: evidence E14, the duel.com
 *     config as fetched 2026-10-05 in a logged-in session (read-only GET; evidence/settings/, pinned
 *     in src/scaling-edge.ts; MANIFEST.md "Scaling edge"): its tier lists set a $250,000 maximum profit
 *     through the bet limits and carry no multiplier cap. A profit limit is not a cap on the odds,
 *     so this stays null;
 *   - NOT checked: Duel's Terms of Service, any in-game rules / info panel, the "Zero Edge" page,
 *     E06 / E08 / client-seed-origin.png, and the rest of the live site (no network in this pass).
 */
export const DECLARED_MAX_ODDS: number | null = null;
/** Keys that would carry a cap if the operator served one. */
export const CAP_FIELD_PATTERN = /max|limit|odds|payout|profit|ceiling|(^|_)cap($|_)/i;
