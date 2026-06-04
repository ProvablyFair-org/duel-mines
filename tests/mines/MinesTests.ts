import assert from 'assert';
import { computeMinePositions, computeMinePositionsFromBuffer, verifyHash, theoreticalMultiplier, winChance } from '../../src/rng';
import { loadDataset, buildSeedMap } from '../../src/loader';

// ── Test vectors — real bets from data/mines-master-6500bets.json ─────────────
// First 7 bets of the first revealed epoch (server seed hash eecc6f36...),
// nonces 0–6, 6 distinct mine_count values (1, 9, 10, 14, 18, 23).
// Server seed for this epoch is revealed via seeds[1].seed.serverSeed.

const SERVER_SEED       = 'b255e0f55d255669bbd42a777b0e6b6570027b058d1db571df57325a2269a75f';
const SERVER_SEED_HASH  = 'eecc6f36cd2e55109959a19a9667bfcccf27e8a75842bd800d77ed054766ff30';
const CLIENT_SEED       = 'EveJlkDtA24dfvBr';

const VECTORS = [
  {
    nonce: 0, mineCount: 14,
    expectedPositions: [1, 4, 5, 7, 8, 13, 14, 15, 16, 17, 19, 20, 22, 24],
    outcome: 'win' as const,
    apiMultiplier: '2.272727272727272727',
    noHouseEdgeMultiplier: '2.270454545454545454',
    amountWon: '0.022704545454545455',
    amountCurrency: '0.010000000000000000',
  },
  {
    nonce: 1, mineCount: 10,
    expectedPositions: [0, 3, 6, 8, 10, 13, 15, 16, 19, 24],
    outcome: 'loss' as const,
    apiMultiplier: '1.000000000000000000',
    noHouseEdgeMultiplier: null,
    amountWon: '0',
    amountCurrency: '0.010000000000000000',
  },
  {
    nonce: 2, mineCount: 14,
    expectedPositions: [0, 1, 3, 8, 9, 10, 11, 12, 13, 14, 15, 22, 23, 24],
    outcome: 'loss' as const,
    apiMultiplier: '1.000000000000000000',
    noHouseEdgeMultiplier: null,
    amountWon: '0',
    amountCurrency: '0.010000000000000000',
  },
  {
    nonce: 3, mineCount: 23,
    expectedPositions: [0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23, 24],
    outcome: 'loss' as const,
    apiMultiplier: '1.000000000000000000',
    noHouseEdgeMultiplier: null,
    amountWon: '0',
    amountCurrency: '0.010000000000000000',
  },
  {
    nonce: 4, mineCount: 1,
    expectedPositions: [5],
    outcome: 'win' as const,
    apiMultiplier: '1.041666666666666667',
    noHouseEdgeMultiplier: '1.040625',
    amountWon: '0.01040625',
    amountCurrency: '0.010000000000000000',
  },
  {
    nonce: 5, mineCount: 9,
    expectedPositions: [0, 2, 3, 7, 9, 10, 16, 17, 19],
    outcome: 'loss' as const,
    apiMultiplier: '1.000000000000000000',
    noHouseEdgeMultiplier: null,
    amountWon: '0',
    amountCurrency: '0.010000000000000000',
  },
  {
    nonce: 6, mineCount: 18,
    expectedPositions: [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 23],
    outcome: 'loss' as const,
    apiMultiplier: '1.000000000000000000',
    noHouseEdgeMultiplier: null,
    amountWon: '0',
    amountCurrency: '0.010000000000000000',
  },
] as const;

// ── Full dataset for all-bet crypto and payout tests ──────────────────────────
const ds = loadDataset();
const seedMap = buildSeedMap(ds.seeds);

// ── Cryptographic Core ─────────────────────────────────────────────────────────

describe('Cryptographic Core — Known-Answer Tests (7 bets from first epoch, 6 distinct mine counts — proves algorithm implementation is correct)', () => {

  it('computeMinePositions matches expected positions for all 7 test vectors', () => {
    for (const v of VECTORS) {
      const computed = computeMinePositions(SERVER_SEED, CLIENT_SEED, v.nonce, v.mineCount);
      assert.deepStrictEqual(
        computed, [...v.expectedPositions],
        `nonce=${v.nonce} mines=${v.mineCount}: expected ${JSON.stringify(v.expectedPositions)}, got ${JSON.stringify(computed)}`,
      );
    }
  });

  it('computeMinePositionsFromBuffer matches computeMinePositions (guards against encoding bugs)', () => {
    for (const v of VECTORS) {
      const key     = Buffer.from(SERVER_SEED, 'hex');
      const fromBuf = computeMinePositionsFromBuffer(key, CLIENT_SEED, v.nonce, v.mineCount);
      const fromStr = computeMinePositions(SERVER_SEED, CLIENT_SEED, v.nonce, v.mineCount);
      assert.deepStrictEqual(
        fromBuf, fromStr,
        `buffer/string mismatch nonce=${v.nonce} mines=${v.mineCount}`,
      );
    }
  });

  it('HMAC key is hex-decoded (not raw UTF-8) — only hex decoding produces the correct known positions', () => {
    const v = VECTORS[0];
    const computed = computeMinePositions(SERVER_SEED, CLIENT_SEED, v.nonce, v.mineCount);
    assert.deepStrictEqual(computed, [...v.expectedPositions], 'hex-decoded key must match');
  });

  it('mine positions are always in range [0, 24] for all test vectors', () => {
    for (const v of VECTORS) {
      const positions = computeMinePositions(SERVER_SEED, CLIENT_SEED, v.nonce, v.mineCount);
      for (const p of positions) {
        assert.ok(p >= 0 && p <= 24, `position ${p} out of range [0, 24] at nonce=${v.nonce}`);
      }
    }
  });

  it('mine count matches requested count for all test vectors', () => {
    for (const v of VECTORS) {
      const positions = computeMinePositions(SERVER_SEED, CLIENT_SEED, v.nonce, v.mineCount);
      assert.strictEqual(
        positions.length, v.mineCount,
        `nonce=${v.nonce}: expected ${v.mineCount} mines, got ${positions.length}`,
      );
    }
  });

  it('mine positions contain no duplicates for all test vectors', () => {
    for (const v of VECTORS) {
      const positions = computeMinePositions(SERVER_SEED, CLIENT_SEED, v.nonce, v.mineCount);
      assert.strictEqual(
        new Set(positions).size, positions.length,
        `duplicate positions at nonce=${v.nonce}: ${JSON.stringify(positions)}`,
      );
    }
  });

  it('SHA-256(serverSeed) matches the committed hash for the test epoch', () => {
    assert.strictEqual(
      verifyHash(SERVER_SEED, SERVER_SEED_HASH), true,
      `hash mismatch for seed ${SERVER_SEED.slice(0, 16)}…`,
    );
  });

  it('verifyHash rejects a tampered server seed (negative control)', () => {
    const tampered = '0000000000000000000000000000000000000000000000000000000000000000';
    assert.strictEqual(verifyHash(tampered, SERVER_SEED_HASH), false);
  });

  it('verifyHash rejects a tampered hash (negative control)', () => {
    const tamperedHash = '0000000000000000000000000000000000000000000000000000000000000000';
    assert.strictEqual(verifyHash(SERVER_SEED, tamperedHash), false);
  });

  it('different nonces produce different mine positions (confirms nonce is a genuine HMAC input)', () => {
    const pos0 = computeMinePositions(SERVER_SEED, CLIENT_SEED, 0, 3);
    const pos1 = computeMinePositions(SERVER_SEED, CLIENT_SEED, 1, 3);
    assert.notDeepStrictEqual(pos0, pos1, 'nonce 0 and 1 must produce different positions');
  });

  it('different client seeds produce different mine positions (confirms client seed is a genuine HMAC input)', () => {
    const posA = computeMinePositions(SERVER_SEED, CLIENT_SEED, 0, 3);
    const posB = computeMinePositions(SERVER_SEED, 'XXXXXXXXXXXXXXXX', 0, 3);
    assert.notDeepStrictEqual(posA, posB, 'different client seeds must produce different positions');
  });

});

// ── Payout Formulas ───────────────────────────────────────────────────────────

describe('Payout Formulas — validates multiplier and win chance calculations against live data', () => {

  it('theoreticalMultiplier (with 0.1% edge) matches API no_house_edge_multiplier for winning bets with 1 reveal', () => {
    // API field "no_house_edge_multiplier" is actually the payout multiplier WITH house edge applied
    // (confusing API naming — it means "multiplier used for payout, after edge deduction").
    // theoreticalMultiplier(m, k, 0.001) = C(25,k)/C(25-m,k) × 0.999
    for (const v of VECTORS) {
      if (v.outcome === 'loss' || !v.noHouseEdgeMultiplier) continue;
      const computed = theoreticalMultiplier(v.mineCount, 1, 0.001);
      const api      = parseFloat(v.noHouseEdgeMultiplier);
      assert.ok(
        Math.abs(computed - api) < 1e-10,
        `nonce=${v.nonce} mines=${v.mineCount}: computed=${computed}, api=${api}`,
      );
    }
  });

  it('theoreticalMultiplier (with 0% edge) matches API multiplier for winning bets with 1 reveal', () => {
    // API field "multiplier" = C(25,k)/C(25-m,k) — raw, no edge
    for (const v of VECTORS) {
      if (v.outcome === 'loss') continue;
      const computed = theoreticalMultiplier(v.mineCount, 1, 0);
      const api      = parseFloat(v.apiMultiplier);
      assert.ok(
        Math.abs(computed - api) < 1e-10,
        `nonce=${v.nonce} mines=${v.mineCount}: computed=${computed}, api=${api}`,
      );
    }
  });

  it('winChance matches the expected safe-tile probability for 1st reveal', () => {
    // winChance(m, 0) = (25 - m) / 25 — probability of first tile being safe
    const cases = [
      { mines: 2, expected: 23 / 25 },
      { mines: 3, expected: 22 / 25 },
      { mines: 4, expected: 21 / 25 },
      { mines: 8, expected: 17 / 25 },
      { mines: 17, expected: 8 / 25 },
    ];
    for (const c of cases) {
      const computed = winChance(c.mines, 0);
      assert.ok(
        Math.abs(computed - c.expected) < 1e-15,
        `mines=${c.mines}: expected=${c.expected}, got=${computed}`,
      );
    }
  });

  it('house edge is exactly 0.1% — theoreticalMultiplier(m,k,0.001) / theoreticalMultiplier(m,k,0) === 0.999', () => {
    const mineConfigs = [1, 2, 3, 4, 5, 8, 10, 15, 17, 20, 24];
    for (const m of mineConfigs) {
      const withEdge    = theoreticalMultiplier(m, 1, 0.001);
      const withoutEdge = theoreticalMultiplier(m, 1, 0);
      const ratio       = withEdge / withoutEdge;
      assert.ok(
        Math.abs(ratio - 0.999) < 1e-15,
        `mines=${m}: edge ratio=${ratio}, expected 0.999`,
      );
    }
  });

  it('loss bets have multiplier 1.0 and amount_won 0', () => {
    for (const v of VECTORS) {
      if (v.outcome !== 'loss') continue;
      assert.strictEqual(parseFloat(v.apiMultiplier), 1, `loss bet nonce=${v.nonce} should have multiplier=1`);
      assert.strictEqual(v.amountWon, '0', `loss bet nonce=${v.nonce} should have amount_won=0`);
    }
  });

});

// ── Full Dataset Verification ─────────────────────────────────────────────────

describe('Full Dataset Verification — recomputes every bet and verifies all revealed seeds', () => {

  it(`recomputes mine positions for every bet with a revealed seed (${ds.bets.length} bets) and confirms 0 mismatches`, () => {
    let checked    = 0;
    let mismatches = 0;
    for (const b of ds.bets) {
      const ss = seedMap.get(b.seed.serverSeedHashed);
      if (!ss) continue;
      const key      = Buffer.from(ss, 'hex');
      const computed = computeMinePositionsFromBuffer(key, b.seed.clientSeed, b.seed.nonce, b.request.mines_count);
      const expected = [...b.response.mines_positions].sort((a, c) => a - c);
      if (JSON.stringify(computed) !== JSON.stringify(expected)) mismatches++;
      checked++;
    }
    assert.strictEqual(mismatches, 0, `${mismatches} mine position mismatches out of ${checked}`);
    assert.ok(checked > 0, 'must have at least one bet to check');
  });

  it(`verifies SHA-256(serverSeed) === committedHash for all revealed seeds via seed map (commit-reveal integrity)`, () => {
    let mismatches = 0;
    let checked    = 0;
    for (const [hash, serverSeed] of seedMap) {
      if (!verifyHash(serverSeed, hash)) mismatches++;
      checked++;
    }
    assert.strictEqual(mismatches, 0, `${mismatches} hash mismatches out of ${checked}`);
    assert.ok(checked > 0, 'must have revealed seeds');
  });

});

// ── Payout Accuracy ───────────────────────────────────────────────────────────

describe('Payout Accuracy — confirms the platform paid the correct amount for every bet in the dataset', () => {

  it(`win_amount = bet_amount × payout_multiplier for all winning bets (tolerance ±1e-10)`, () => {
    let checked = 0;
    for (const b of ds.bets) {
      if (b.response.outcome === 'loss') continue;
      if (!b.response.no_house_edge_multiplier) continue;
      const expected = parseFloat(b.response.amount_currency) * parseFloat(b.response.no_house_edge_multiplier);
      const actual   = parseFloat(b.response.amount_won);
      assert.ok(
        Math.abs(expected - actual) < 1e-10,
        `Payout mismatch bet ${b.response.round_id}: ${b.response.amount_currency} × ${b.response.no_house_edge_multiplier} = ${expected}, recorded ${b.response.amount_won}`,
      );
      checked++;
    }
    assert.ok(checked > 0, 'must have at least one winning bet to check');
  });

  it('loss bets always record amount_won = 0', () => {
    let losses = 0;
    for (const b of ds.bets) {
      if (b.response.outcome !== 'loss') continue;
      assert.strictEqual(
        b.response.amount_won, '0',
        `Loss bet ${b.response.round_id} has non-zero amount_won: ${b.response.amount_won}`,
      );
      losses++;
    }
    assert.ok(losses > 0, 'must have at least one loss bet');
  });

});
