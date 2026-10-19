import assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { binomialBig, exactMultiplier, relativeDeviation, enumerateSurvivalCounts, MULT_REL_TOL } from '../../src/exact';
import {
  positionChi2WithoutReplacement, positionChi2Pearson, lag1FromCensus, runsFromCensus,
  encodeWinBits, decodeWinBits, binomialUpperTail, binomialTailAtLeast, countRuleThreshold, windowRejectProbability,
} from '../../src/sim-census';
import { lag1Autocorrelation, chiSquaredTest } from '../../src/stats';
import { validateDomains, DOMAIN_RULES } from '../../src/domains';
import { ARTIFACT_PINS } from '../../src/artifact-pins';

// ── Exact arithmetic (src/exact.ts) ────────────────────────────────────────────

describe('Exact multiplier arithmetic — the rational the served strings are compared with', () => {

  it('binomialBig reproduces known binomials, including the ladder maximum C(25,12) = 5,200,300', () => {
    assert.strictEqual(binomialBig(25, 1), 25n);
    assert.strictEqual(binomialBig(25, 12), 5_200_300n);
    assert.strictEqual(binomialBig(24, 5), 42_504n);
    assert.strictEqual(binomialBig(5, 6), 0n);
  });

  it('relativeDeviation is 0 on the exact value, rejects malformed strings, and sees a 1e-7 shift', () => {
    // 25/11 is 2.27 recurring; the served k = 1 string rounds it at the 18th decimal.
    const exact = exactMultiplier(14, 1, false);
    assert.strictEqual(relativeDeviation('2.272727272727272727', exact) <= MULT_REL_TOL, true);
    assert.strictEqual(relativeDeviation('2.2727275', exact) > MULT_REL_TOL, true);
    assert.strictEqual(relativeDeviation('not-a-number', exact), Infinity);
    assert.strictEqual(relativeDeviation(null, exact), Infinity);
    assert.strictEqual(relativeDeviation('25', exactMultiplier(24, 1, false)), 0);
  });

  it('the subset enumeration counts C(25-m, k) survivals for a sample of cells', () => {
    const { survive, total } = enumerateSurvivalCounts();
    for (const [m, k] of [[1, 1], [3, 5], [12, 3], [24, 1], [5, 20]]) {
      assert.strictEqual(BigInt(survive[m][k]), binomialBig(25 - m, k), `m=${m}, k=${k}`);
      assert.strictEqual(BigInt(total[k]), binomialBig(25, k), `k=${k}`);
    }
  });
});

// ── Simulation census (src/sim-census.ts) ──────────────────────────────────────

describe('Simulation census — the statistics the verifier re-derives', () => {

  it('the without-replacement statistic is Pearson × 24/(25 − m)', () => {
    const counts = [799, 787, 796, 791, 794, 775, 811, 774, 808, 775, 788, 770, 817, 824, 787, 807, 827, 799, 804, 805, 819, 816, 829, 819, 779];
    const m = 1, n = 20_000;
    const wr = positionChi2WithoutReplacement(counts, m, n).positionChi2WR;
    assert.ok(Math.abs(wr - positionChi2Pearson(counts, m, n) * 24 / (25 - m)) < 1e-9);
  });

  it('lag-1 and runs from the census equal the series forms on a fixed 0/1 sequence', () => {
    let x = 12345;
    const series: number[] = Array.from({ length: 5000 }, () => { x = (x * 1103515245 + 12345) % 2147483648; return x % 3 === 0 ? 0 : 1; });
    let adj = 0, tr = 0;
    for (let i = 1; i < series.length; i++) { if (series[i] !== series[i - 1]) tr++; if (series[i] && series[i - 1]) adj++; }
    const c = { rounds: series.length, wins: series.reduce((a, b) => a + b, 0), adjacentWinPairs: adj, transitions: tr,
      firstOutcome: series[0], lastOutcome: series[series.length - 1] };
    assert.ok(Math.abs(lag1FromCensus(c).r1 - lag1Autocorrelation(series)) < 1e-12);
    assert.strictEqual(runsFromCensus(c).runs, tr + 1);
  });

  it('win bitmasks round-trip and the binomial upper tail is a probability', () => {
    const o = Array.from({ length: 50 }, (_, i) => (i * 7) % 3 === 0 ? 1 : 0);
    assert.deepStrictEqual(decodeWinBits(encodeWinBits(o), 50), o);
    assert.throws(() => decodeWinBits('zz', 50));
    const p = binomialUpperTail(130, 0.045, 18.67);
    assert.ok(p >= 0 && p <= 1e-3, `null tail ${p}`);
    assert.ok(binomialUpperTail(130, 0.5, 18.67) > 0.999);
  });

  it('the Step 19 count rule: Binomial(N, 0.0025) tails at N = 121 and 130, FLAG at k = 2, FAIL at k = 3', () => {
    // 1 in 400 per seed (0.05 × 0.05). Reference figures at N = 121: 26%, 3.7%, 0.36%.
    assert.ok(Math.abs(binomialTailAtLeast(121, 0.0025, 1) - 0.2613) < 5e-5);
    assert.ok(Math.abs(binomialTailAtLeast(121, 0.0025, 2) - 0.0373) < 5e-5);
    assert.ok(Math.abs(binomialTailAtLeast(121, 0.0025, 3) - 0.0036) < 5e-5);
    assert.ok(Math.abs(binomialTailAtLeast(130, 0.0025, 1) - (1 - 0.9975 ** 130)) < 1e-12);
    for (const n of [121, 130]) {
      assert.strictEqual(countRuleThreshold(n, 0.0025, 0.05), 2, `FLAG k at N = ${n}`);
      assert.strictEqual(countRuleThreshold(n, 0.0025, 0.01), 3, `FAIL k at N = ${n}`);
    }
    // the exact rejection probability of the 50-round chi-squared window at win chance 0.88 is the
    // binomial mass of its rejection region, w <= 39 or w >= 49 (|w − 44| > 1.96 × √5.28)
    const pmf = (n: number, p: number, w: number) => {
      let c = 1; for (let i = 0; i < w; i++) c = c * (n - i) / (i + 1);
      return c * p ** w * (1 - p) ** (n - w);
    };
    let region = 0;
    for (let w = 0; w <= 50; w++) if (w <= 39 || w >= 49) region += pmf(50, 0.88, w);
    const exact = windowRejectProbability(50, 0.88, 0.05, w => chiSquaredTest([w, 50 - w], [44, 6]).pValue);
    assert.ok(Math.abs(exact - region) < 1e-12, `exact ${exact} vs region ${region}`);
  });
});

// ── Value domains (src/domains.ts) over the committed artifacts ───────────────

describe('Value domains — every numeric leaf of every committed JSON artifact of record', () => {

  it('every pinned JSON artifact has a domain table, and every numeric leaf is declared and possible', () => {
    const outputs = path.join(__dirname, '../../outputs');
    for (const file of Object.keys(ARTIFACT_PINS).filter(f => f.endsWith('.json'))) {
      assert.ok(file in DOMAIN_RULES, `${file} has no domain table`);
      const r = validateDomains(file, JSON.parse(fs.readFileSync(path.join(outputs, file), 'utf8')));
      assert.deepStrictEqual(r.uncovered, [], `${file}: undeclared numeric leaves`);
      assert.deepStrictEqual(r.violations, [], `${file}: impossible values`);
      assert.ok(r.checked > 0, `${file}: no numeric leaves checked`);
    }
  });
});
