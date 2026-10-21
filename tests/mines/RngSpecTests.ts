/**
 * Spec self-test — docs/ALGORITHM.md vectors and properties, run against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the module
 * interface alone (never from Duel's code). Integrated 20 Oct 2026: the checks are unchanged; only the
 * import path, the mocha wrapper and the reporting (failures collected instead of printed) were adapted.
 */
import * as assert from 'assert';
import { createHash, createHmac, randomBytes } from "crypto";
import {
  GRID_SIZE,
  MAX_UINT32,
  maxFairFor,
  drawFromChunk,
  newDrawCensus,
  shuffleTilesFromBuffer,
  computeMinePositionsFromBuffer,
  computeMinePositions,
  verifyHash,
  theoreticalMultiplier,
  winChance,
} from "../../src/rng";

const EXPECTED_CHECKS = 115;

function runSelftest(): { passed: number; total: number; failed: string[] } {

  let passed = 0;
  let total = 0;
  const failed: string[] = [];
  function check(name: string, ok: boolean, detail = ""): void {
    total += 1;
    if (ok) passed += 1;
    if (!ok) failed.push(`${name}${detail ? `  (${detail})` : ""}`);
  }
  const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const relClose = (got: number, want: number, tol: number): boolean => Math.abs(got - want) / Math.abs(want) <= tol;

  interface Vector {
    id: string;
    seed: string;
    commitment?: string;
    client: string;
    nonce: number;
    mines: number;
    hmac0: string;
    u32: number;
    j: number[];
    a: number[];
    mineSet: number[];
    opened: number[];
    outcome: "win" | "loss";
    stepMultipliers: string[]; // served multiplier after each opened tile (bust keeps k-1)
    edged?: string;
  }

  const S1 = "b255e0f55d255669bbd42a777b0e6b6570027b058d1db571df57325a2269a75f";
  const S5 = "1cdcd1d16090b08915c3bf8da241aa5db94605244449f8fd67cf92e7f21eb0f7";
  const nums = (s: string): number[] => s.replace("|", " ").trim().split(/\s+/).map(Number);
  const allBut = (x: number): number[] => Array.from({ length: 25 }, (_, i) => i).filter((i) => i !== x);

  const vectors: Vector[] = [
    {
      id: "V1", seed: S1, commitment: "eecc6f36cd2e55109959a19a9667bfcccf27e8a75842bd800d77ed054766ff30",
      client: "EveJlkDtA24dfvBr", nonce: 0, mines: 14,
      hmac0: "d8c82daaf242ea5ba5ca52d18e08be828e15c15fee8f51973911469f01bc4067", u32: 3636997546,
      j: nums("21 23 2 3 10 11 12 12 6 9 0 | 7 10 3 10 5 5 1 1 5 1 3 1 1"),
      a: nums("14 22 4 19 16 8 13 1 15 5 17 24 20 7 0 9 6 18 12 11 10 3 2 23 21"),
      mineSet: [1, 4, 5, 7, 8, 13, 14, 15, 16, 17, 19, 20, 22, 24],
      opened: [0], outcome: "win", stepMultipliers: ["2.272727272727272727"], edged: "2.270454545454545454",
    },
    {
      id: "V2", seed: S1, client: "EveJlkDtA24dfvBr", nonce: 1, mines: 10,
      hmac0: "5de7e7ab4cdd39936f3e058521d1f15414cc6dd2f96827cfd64a224ea1edf04c", u32: 1575479211,
      j: nums("11 2 7 5 5 12 7 14 1 5 7 4 2 9 7 | 3 3 7 3 5 4 0 0 1"),
      a: nums("19 16 6 0 13 15 8 10 24 3 17 9 23 4 18 20 1 14 22 12 21 5 7 2 11"),
      mineSet: [0, 3, 6, 8, 10, 13, 15, 16, 19, 24],
      opened: [0], outcome: "loss", stepMultipliers: ["1.000000000000000000"],
    },
    {
      id: "V3", seed: "85d82d87a05cf35f0a9f7034445116b6699b14e3d5a327bbd0621d048c1538f2",
      commitment: "d3d3dd69ce358290923fdb59bc947b9e89dfa0ea347fdce24003d2a4de7cfcb3",
      client: "MyJHJQbUNoMYs6pl", nonce: 15, mines: 24,
      hmac0: "986f71f47d18b7503a570d789fe6c73aa95dc5b7da574a7356473d94c80e86a0", u32: 2557440500,
      j: nums("0 | 20 4 7 17 7 2 15 15 3 11 5 11 9 6 6 1 5 2 0 3 0 2 0"),
      a: nums("8 22 12 19 16 24 18 13 1 10 6 9 14 5 11 3 23 15 2 21 17 7 4 20 0"),
      mineSet: allBut(0),
      opened: [0], outcome: "win", stepMultipliers: ["25"], edged: "24.975",
    },
    {
      id: "V4", seed: "81cdd7a5a05c174b67774d5fb2adddcf5d81924ee3fc14c03ac735a5e3348696",
      commitment: "76cec60726b0a093a27bae9aee6f8bc12fe0a42cd2cddcc0549f1669a9c168ee",
      client: "fwt1E7WgzgXJZXfA", nonce: 0, mines: 12,
      hmac0: "e9567f0b2a55780d47634e3e7569bc8403a5c2ea47c5c72eb3b852fe79f6a358", u32: 3914759947,
      j: nums("22 8 6 3 7 11 1 0 3 12 8 2 9 | 1 9 9 0 5 0 1 4 1 1 1"),
      a: nums("24 13 16 20 4 19 14 5 17 10 15 18 9 2 23 12 21 0 1 11 7 3 6 8 22"),
      mineSet: [4, 5, 10, 13, 14, 15, 16, 17, 18, 19, 20, 24],
      opened: [0], outcome: "win", stepMultipliers: ["1.923076923076923077"], edged: "1.921153846153846154",
    },
    {
      id: "V5", seed: S5, commitment: "f85bab9377e3e732e93d8f47b2c952f1294f1a2c7aca469ab88d90cb33728173",
      client: "Bw2ll1YE0PQa1CGz", nonce: 0, mines: 3,
      hmac0: "bd7c7c8f79a519a5a93f03d386dbcab9cd24c090460af2b5eda3364601a7db60", u32: 3179052175,
      j: nums("0 0 13 13 4 10 15 16 11 7 12 0 1 7 10 5 5 3 4 4 2 1 | 1 0"),
      a: nums("8 21 17 14 2 6 20 3 9 5 19 18 1 23 12 7 11 16 15 10 4 22 13 24 0"),
      mineSet: [8, 17, 21],
      opened: [0, 1, 2, 3, 4], outcome: "win",
      stepMultipliers: ["1.136363636363636364", "1.298701298701298702", "1.493506493506500975",
        "1.729323308270692621", "2.017543859649134666"],
      edged: "2.015526315789485531",
    },
    {
      id: "V6", seed: S5, client: "Bw2ll1YE0PQa1CGz", nonce: 2, mines: 3,
      hmac0: "158337274f2245c668e91686c6a99b7ee7a1cb6a394f69fe16bf02417797fb96", u32: 360920871,
      j: nums("21 1 21 16 7 7 15 10 3 2 1 1 6 1 4 9 1 5 5 2 0 1 | 2 0"),
      a: nums("22 17 12 8 0 18 19 5 11 9 4 13 6 14 23 2 3 10 15 20 7 16 24 1 21"),
      mineSet: [12, 17, 22],
      opened: [10, 11, 12], outcome: "loss",
      stepMultipliers: ["1.136363636363636364", "1.298701298701298702", "1.298701298701298702"],
    },
  ];

  // Tolerance from ALGORITHM.md §3.2: served vs computed multipliers agree within 1e-13 relative.
  const MULT_TOL = 1e-13;

  for (const v of vectors) {
    const key = Buffer.from(v.seed, "hex");

    // §1.2 commitment
    if (v.commitment) check(`${v.id} verifyHash(seed, commitment) is true`, verifyHash(v.seed, v.commitment));

    // §2 step 1: first digest; step 2: first chunk and its draw
    const d0 = createHmac("sha256", key).update(`${v.client}:${v.nonce}:0`, "utf8").digest();
    check(`${v.id} HMAC(c:n:0) hex`, d0.toString("hex") === v.hmac0);
    check(`${v.id} first u32 big-endian`, d0.readUInt32BE(0) === v.u32, String(d0.readUInt32BE(0)));
    check(`${v.id} j0 = drawFromChunk(u32, 25)`, drawFromChunk(v.u32, 25) === v.j[0]);

    // §2 step 2 for every draw i (cursor i, range 25-i), via the module's drawFromChunk
    const js: number[] = [];
    for (let i = 0; i < 24; i += 1) {
      const d = createHmac("sha256", key).update(`${v.client}:${v.nonce}:${i}`, "utf8").digest();
      let picked: number | null = null;
      for (let off = 0; off < 32 && picked === null; off += 4) picked = drawFromChunk(d.readUInt32BE(off), 25 - i);
      js.push(picked as number);
    }
    check(`${v.id} all 24 draws j match spec`, eq(js, v.j), js.join(" "));

    // §2 step 3: applying those j to the backward swap gives the spec's a
    const manual = Array.from({ length: 25 }, (_, i) => i);
    v.j.forEach((j, i) => {
      const r = 25 - i;
      const t = manual[r - 1] as number;
      manual[r - 1] = manual[j] as number;
      manual[j] = t;
    });
    check(`${v.id} spec j applied by hand reproduces spec a`, eq(manual, v.a));

    const census = newDrawCensus();
    const shuffled = shuffleTilesFromBuffer(key, v.client, v.nonce, GRID_SIZE, census);
    check(`${v.id} shuffleTilesFromBuffer == spec a`, eq(shuffled, v.a));
    check(`${v.id} census draws=24, chunks=24, rejected=0, advances=0`,
      census.draws === 24 && census.chunksRead === 24 && census.rejectedChunks === 0 && census.cursorAdvances === 0,
      JSON.stringify(census));

    // §2 step 4: mine set
    const minesBuf = computeMinePositionsFromBuffer(key, v.client, v.nonce, v.mines);
    const minesStr = computeMinePositions(v.seed, v.client, v.nonce, v.mines);
    check(`${v.id} computeMinePositionsFromBuffer == spec mines`, eq(minesBuf, v.mineSet));
    check(`${v.id} computeMinePositions == spec mines`, eq(minesStr, v.mineSet));
    check(`${v.id} first draw's tile a[24] is safe`, !v.mineSet.includes(v.a[24] as number));

    // §3.1 outcome from opened tiles
    const mineSet = new Set(minesBuf);
    const bustAt = v.opened.findIndex((p) => mineSet.has(p));
    const outcome = bustAt === -1 ? "win" : "loss";
    const bustIsLast = bustAt === -1 || bustAt === v.opened.length - 1;
    check(`${v.id} outcome ${v.outcome}${bustAt >= 0 ? ` on tile ${v.opened[bustAt]}` : ""}`, outcome === v.outcome && bustIsLast);

    // §3.2: each served step multiplier vs M(m, depth) within 1e-13; a bust keeps depth k-1
    v.stepMultipliers.forEach((served, s) => {
      const opened = v.opened[s] as number;
      const safeSoFar = v.opened.slice(0, s + 1).filter((p) => !mineSet.has(p)).length;
      const want = Number(served);
      const got = theoreticalMultiplier(v.mines, safeSoFar, 0);
      const rel = (want - got) / got;
      check(`${v.id} step ${s + 1} (tile ${opened}) served ${served} vs M(${v.mines},${safeSoFar})`,
        relClose(got, want, MULT_TOL), `rel ${rel.toExponential(2)}`);
    });

    // §3.4: edged multiplier vs theoreticalMultiplier default edge 0.001
    if (v.edged) {
      const k = v.opened.length;
      const got = theoreticalMultiplier(v.mines, k);
      check(`${v.id} edged ${v.edged} vs theoreticalMultiplier(${v.mines},${k})`, relClose(got, Number(v.edged), MULT_TOL),
        `rel ${((Number(v.edged) - got) / got).toExponential(2)}`);
    }
  }

  // V5 note: exact M(3,5) = 115/57
  check("V5 theoreticalMultiplier(3,5,0) ~ 115/57 (1e-15)", relClose(theoreticalMultiplier(3, 5, 0), 115 / 57, 1e-15));
  // V6 seed is V5's (pairing by hash, §1.2)
  check("V6 seed hashes to V5 commitment", verifyHash(S5, "f85bab9377e3e732e93d8f47b2c952f1294f1a2c7aca469ab88d90cb33728173"));
  check("V2 seed hashes to V1 commitment", verifyHash(S1, "eecc6f36cd2e55109959a19a9667bfcccf27e8a75842bd800d77ed054766ff30"));

  // ---- hash check: false cases ----
  const asciiHash = createHash("sha256").update(S1, "utf8").digest("hex");
  check("verifyHash false for SHA-256 over the ASCII seed (§1.2 rejected form)", !verifyHash(S1, asciiHash));
  check("verifyHash false for another pair's commitment", !verifyHash(S1, "f85bab9377e3e732e93d8f47b2c952f1294f1a2c7aca469ab88d90cb33728173"));
  const flipped = S1.slice(0, -1) + (S1.endsWith("f") ? "e" : "f");
  check("verifyHash false for a seed with one hex digit changed", !verifyHash(flipped, "eecc6f36cd2e55109959a19a9667bfcccf27e8a75842bd800d77ed054766ff30"));
  check("verifyHash false for malformed seed", !verifyHash("xyz", "eecc6f36cd2e55109959a19a9667bfcccf27e8a75842bd800d77ed054766ff30"));
  check("verifyHash true for uppercase published hash", verifyHash(S1, "EECC6F36CD2E55109959A19A9667BFCCCF27E8A75842BD800D77ED054766FF30"));

  // ---- draw window / bias report ----
  check("MAX_UINT32 == 2^32 - 1", MAX_UINT32 === 4294967295);
  check("GRID_SIZE == 25", GRID_SIZE === 25);
  let windowOk = true;
  let rejectOk = true;
  let worstRejectP = 0;
  for (let r = 2; r <= 25; r += 1) {
    const lim = maxFairFor(r);
    const rejected = 2 ** 32 - lim;
    worstRejectP = Math.max(worstRejectP, rejected / 2 ** 32);
    if (lim % r !== 0 || rejected < 0 || rejected >= r || rejected !== 2 ** 32 % r) windowOk = false;
    if (drawFromChunk(lim - 1, r) !== (lim - 1) % r) rejectOk = false;
    if (rejected > 0 && drawFromChunk(lim, r) !== null) rejectOk = false;
    if (rejected > 0 && drawFromChunk(MAX_UINT32, r) !== null) rejectOk = false;
    if (drawFromChunk(0, r) !== 0) rejectOk = false;
  }
  check("maxFairFor(r) for r=2..25 is a multiple of r and leaves 2^32 mod r rejected values", windowOk);
  check("drawFromChunk accepts lim-1, rejects lim..MAX_UINT32 for r=2..25", rejectOk);
  check("power-of-two ranges reject nothing (maxFairFor(2)=maxFairFor(16)=2^32)", maxFairFor(2) === 2 ** 32 && maxFairFor(16) === 2 ** 32 && drawFromChunk(MAX_UINT32, 16) === 15);
  check("worst per-chunk rejection probability < 6e-9 (§2 step 2)", worstRejectP < 6e-9, worstRejectP.toExponential(3));
  // Within the window every outcome has the same count: floor(2^32/r) values each
  let uniformOk = true;
  for (let r = 2; r <= 25; r += 1) {
    const per = Math.floor(2 ** 32 / r);
    if (per * r !== maxFairFor(r)) uniformOk = false;
    // value at the start of each outcome's last block maps correctly
    for (let o = 0; o < r; o += 1) if (drawFromChunk(maxFairFor(r) - r + o, r) !== o) uniformOk = false;
  }
  check("accepted window gives every outcome floor(2^32/r) values", uniformOk);
  let throwsOk = 0;
  for (const bad of [() => drawFromChunk(-1, 5), () => drawFromChunk(2 ** 32, 5), () => drawFromChunk(1.5, 5), () => maxFairFor(0)]) {
    try { bad(); } catch { throwsOk += 1; }
  }
  check("drawFromChunk/maxFairFor reject out-of-range inputs", throwsOk === 4);

  // ---- random-round properties ----
  const N = 2000;
  const bulk = newDrawCensus();
  let permOk = true, minesOk = true, firstSafeOk = true, sameWithCensus = true, sliceOk = true;
  const hits = new Array<number>(25).fill(0);
  let hitRounds = 0;
  for (let n = 0; n < N; n += 1) {
    const key = randomBytes(32);
    const client = randomBytes(8).toString("base64url");
    const nonce = n % 50;
    const m = 1 + (n % 24);
    const a = shuffleTilesFromBuffer(key, client, nonce, GRID_SIZE, bulk);
    const a2 = shuffleTilesFromBuffer(key, client, nonce);
    if (!eq(a, a2)) sameWithCensus = false;
    if (!eq([...a].sort((x, y) => x - y), Array.from({ length: 25 }, (_, i) => i))) permOk = false;
    const mines = computeMinePositionsFromBuffer(key, client, nonce, m);
    const minesC = computeMinePositionsFromBuffer(key, client, nonce, m, GRID_SIZE, newDrawCensus());
    if (!eq(mines, minesC)) sameWithCensus = false;
    if (mines.length !== m || new Set(mines).size !== m || mines.some((x, i) => x < 0 || x > 24 || (i > 0 && x <= (mines[i - 1] as number)))) minesOk = false;
    if (!eq(mines, a.slice(0, m).sort((x, y) => x - y))) sliceOk = false;
    if (mines.includes(a[24] as number)) firstSafeOk = false;
    if (m === 1) { hitRounds += 1; hits[mines[0] as number] = (hits[mines[0] as number] as number) + 1; }
    const seedHex = key.toString("hex");
    if (!eq(computeMinePositions(seedHex, client, nonce, m), mines)) minesOk = false;
    if (!verifyHash(seedHex, createHash("sha256").update(key).digest("hex"))) minesOk = false;
  }
  check(`${N} random rounds: shuffle is a permutation of 0..24`, permOk);
  check(`${N} random rounds: m distinct sorted mines in 0..24, string and buffer forms agree, own hash verifies`, minesOk);
  check(`${N} random rounds: mines == sorted(a[0..m-1])`, sliceOk);
  check(`${N} random rounds: first draw's tile a[24] never a mine`, firstSafeOk);
  check(`${N} random rounds: passing a census changes nothing`, sameWithCensus);
  check(`${N} random rounds: census draws == 24 per round`, bulk.draws === 24 * N, String(bulk.draws));
  check(`${N} random rounds: census chunksRead == draws + rejectedChunks`, bulk.chunksRead === bulk.draws + bulk.rejectedChunks,
    JSON.stringify(bulk));
  check(`${N} random rounds: cursorAdvances == 0 (spec never reads a further digest)`, bulk.cursorAdvances === 0);
  void hitRounds;
  // Deterministic m=1 histogram: fixed key, nonces 0..2499 (expected 100 per tile)
  const hist = new Array<number>(25).fill(0);
  for (let nonce = 0; nonce < 2500; nonce += 1) {
    const t = computeMinePositions(S1, "histogram", nonce, 1)[0] as number;
    hist[t] = (hist[t] as number) + 1;
  }
  check("m=1 mine tile over 2500 fixed rounds: every tile hit, each within 50..150", hist.every((h) => h >= 50 && h <= 150), hist.join(","));

  // ---- winChance / theoreticalMultiplier properties ----
  let wcOk = true, tmOk = true, monoOk = true;
  for (let m = 1; m <= 24; m += 1) {
    let p = 1;
    let prev = 0;
    for (let k = 0; k <= 25 - m; k += 1) {
      const fair = theoreticalMultiplier(m, k, 0);
      if (!relClose(fair, 1 / p, 1e-12)) tmOk = false;
      if (!relClose(theoreticalMultiplier(m, k), fair * 0.999, 1e-15)) tmOk = false;
      if (k > 0 && !(fair > prev)) monoOk = false;
      prev = fair;
      if (k < 25 - m) {
        const w = winChance(m, k);
        if (!(w > 0 && w < 1) || w !== (25 - m - k) / (25 - k)) wcOk = false;
        p *= w;
      }
    }
    if (winChance(m, 25 - m) !== 0) wcOk = false;
    if (theoreticalMultiplier(m, 0, 0) !== 1) tmOk = false;
  }
  check("winChance(m,k) = (25-m-k)/(25-k), in (0,1) before the last safe tile, 0 after", wcOk);
  check("theoreticalMultiplier(m,k,0) = 1/prod winChance; default edge = x0.999; k=0 gives 1", tmOk);
  check("theoreticalMultiplier strictly increases with depth", monoOk);
  check("theoreticalMultiplier(24,1,0) == 25 and (14,1,0) == 25/11", theoreticalMultiplier(24, 1, 0) === 25 && relClose(theoreticalMultiplier(14, 1, 0), 25 / 11, 1e-15));

  return { passed, total, failed };
}

describe('Spec self-test — src/rng.ts against docs/ALGORITHM.md (clean-room rebuild)', function () {
  this.timeout(300_000);
  it(`all ${EXPECTED_CHECKS} spec vector and property checks pass`, () => {
    const r = runSelftest();
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.total, EXPECTED_CHECKS);
    assert.strictEqual(r.passed, EXPECTED_CHECKS);
  });
});
