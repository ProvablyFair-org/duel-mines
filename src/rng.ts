/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from Duel's code:
 *   spec      docs/ALGORITHM.md, a copy of games/mines/ALGORITHM.md in the ProvablyFair.org audit
 *             framework (pf-audit, branch clean-room-spec-2026-10-20, SHA-256 6c094b31…19ede336).
 *             Written from Duel's public pages, the standard provably-fair construction and the
 *             7,050 live rounds, without opening Duel's code (its §8 lists every file read).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file, and
 *             never opened Duel's code, its Verify-tab file, or this package's earlier src/rng.ts.
 *   self-test tests/mines/RngSpecTests.ts (the spec's vectors and properties).
 *
 * Duel's published Verify-tab code (evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js, E13) is
 * NOT the source of this module. It is run byte for byte as a SECOND CHECK, by Step 5 and the unit
 * tests (src/operator-verifier.ts), next to the ProvablyFair.org docs-site and live-site verifiers.
 * The audit's draw-bias bound is src/bias.ts, built on this module's drawFromChunk.
 *
 * Three-way agreement measured on integration (20 Oct 2026, all 7,050 captured rounds, 6,500 primary
 * + 550 Phase E): this module vs the live rounds, mine set / commitment / outcome 7,050/7,050,
 * Phase E is_mine 1,173/1,173, multipliers within 1e-13 relative on 2,967 wins, 4,083 losses and
 * 795 reveal steps; vs Duel's Verify-tab code 7,050/7,050 mine sets; vs the provablyfair.org live
 * verifier 7,050/7,050 mine sets. Step 5 of `npm run verify` re-measures all three on every run.
 *
 * Where this module and Duel's Verify-tab code differ on inputs no captured round reaches:
 *   (1) for ranges 2, 4, 8 and 16 this module accepts every 32-bit chunk (spec §2 step 2:
 *       floor(2^32/r)·r = 2^32), while Duel's code rejects the top r values (its maxFair is
 *       0xFFFFFFFF − (0xFFFFFFFF mod r)); both rules are exactly uniform;
 *   (2) when all eight chunks of a digest are rejected (spec O1, unspecified) this module throws,
 *       while Duel's code moves to the next cursor. 0 rejected chunks occur in the 169,200 captured
 *       draws, so neither difference is witnessed (MANIFEST.md DL-11, premise P1).
 */
// Duel.com Mines: mine layout derivation, written from ALGORITHM.md alone.
// Every step below names the section of ALGORITHM.md it implements.

import { createHash, createHmac } from "crypto";

/** Tiles on the board: a 5 x 5 grid, indices 0..24 (spec §1.1). */
export const GRID_SIZE: number = 25;

/** Largest value a 4-byte unsigned chunk can hold (spec §2 step 2 reads u32 values). */
export const MAX_UINT32: number = 0xffffffff;

/** 2^32: the number of distinct 4-byte chunk values. */
const TWO_POW_32 = 4294967296;

/** Bytes per chunk and chunks per digest: a SHA-256 digest is 32 bytes = 8 chunks (spec §2 step 2, offsets 0..28). */
const CHUNK_BYTES = 4;

/**
 * Exclusive upper end of the accepted window for one draw over `range` outcomes.
 * Spec §2 step 2: LIMIT = floor(2^32 / r) * r. A chunk value v is accepted when v < LIMIT,
 * so every outcome 0..r-1 is hit by exactly floor(2^32 / r) accepted values.
 * When r is a power of two this is 2^32 itself and nothing is ever rejected.
 */
export function maxFairFor(range: number): number {
  if (!Number.isInteger(range) || range < 1 || range > TWO_POW_32) {
    throw new RangeError(`range must be an integer in 1..2^32, got ${range}`);
  }
  return Math.floor(TWO_POW_32 / range) * range;
}

/**
 * One 4-byte chunk to an index in [0, range), or null when the chunk falls in the
 * rejection region (spec §2 step 2: "if v < LIMIT: return v mod r").
 * The shuffle calls this for every chunk it reads.
 */
export function drawFromChunk(value: number, range: number): number | null {
  if (!Number.isInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new RangeError(`chunk value must be an integer in 0..${MAX_UINT32}, got ${value}`);
  }
  const limit = maxFairFor(range);
  return value < limit ? value % range : null;
}

/** Optional counter; passing one changes nothing computed. */
export interface DrawCensus {
  draws: number; // shuffle steps executed (gridSize - 1 per round)
  chunksRead: number; // 4-byte chunks read, accepted or not
  rejectedChunks: number; // chunks rejected
  cursorAdvances: number; // times a draw needed a further digest beyond its first (0 if the spec never does this)
}

export function newDrawCensus(): DrawCensus {
  return { draws: 0, chunksRead: 0, rejectedChunks: 0, cursorAdvances: 0 };
}

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

function checkGridSize(gridSize: number): void {
  if (!Number.isInteger(gridSize) || gridSize < 2) {
    throw new RangeError(`gridSize must be an integer >= 2, got ${gridSize}`);
  }
}

function checkNonce(nonce: number): void {
  // Spec §1.1: nonce is an integer >= 0. Spec §2 step 1: written in plain base 10.
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new RangeError(`nonce must be a non-negative safe integer, got ${nonce}`);
  }
}

function checkKey(keyBuffer: Buffer): void {
  if (!Buffer.isBuffer(keyBuffer) || keyBuffer.length === 0) {
    throw new TypeError("keyBuffer must be a non-empty Buffer (the hex-decoded server seed)");
  }
}

/**
 * Hex-decode a published server seed (spec §1.1: 64 hex characters = 32 bytes).
 * Buffer.from(..., "hex") silently drops malformed input, so the shape is checked first.
 */
function decodeServerSeed(serverSeed: string): Buffer {
  if (typeof serverSeed !== "string" || !/^[0-9a-fA-F]{64}$/.test(serverSeed)) {
    throw new TypeError("serverSeed must be 64 hexadecimal characters");
  }
  return Buffer.from(serverSeed, "hex");
}

// ---------------------------------------------------------------------------
// Layout derivation (spec §2)
// ---------------------------------------------------------------------------

/**
 * Spec §2 step 1: draw number i has its own digest,
 * HMAC-SHA256(key = hex-decoded server seed, message = UTF-8 of "clientSeed:nonce:i"),
 * with nonce and i in plain base 10. UTF-8 for non-ASCII client seeds is the spec's assumption (O8).
 */
function digestForDraw(keyBuffer: Buffer, clientSeed: string, nonce: number, drawIndex: number): Buffer {
  const message = `${clientSeed}:${String(nonce)}:${String(drawIndex)}`;
  return createHmac("sha256", keyBuffer).update(Buffer.from(message, "utf8")).digest();
}

/**
 * Spec §2 step 2: walk the digest's eight big-endian 4-byte chunks in order and take the
 * first one drawFromChunk accepts. The spec does not say what happens when all eight are
 * rejected (O1); that has probability below (6e-9)^8 per draw, so this implementation stops
 * with an error rather than invent a continuation. It never reads a further digest, so
 * census.cursorAdvances stays 0.
 */
function drawIndexFromDigest(digest: Buffer, range: number, census: DrawCensus | undefined): number {
  for (let off = 0; off + CHUNK_BYTES <= digest.length; off += CHUNK_BYTES) {
    const value = digest.readUInt32BE(off);
    if (census) census.chunksRead += 1;
    const picked = drawFromChunk(value, range);
    if (picked !== null) return picked;
    if (census) census.rejectedChunks += 1;
  }
  throw new Error(
    `all ${digest.length / CHUNK_BYTES} chunks of the digest were rejected for range ${range}; ` +
      "ALGORITHM.md O1 leaves this case unspecified",
  );
}

/**
 * Spec §2 step 3: backward Fisher-Yates over a = [0, 1, ..., gridSize-1].
 * For i = 0 .. gridSize-2: r = gridSize - i, j = draw(i, r), swap a[r-1] and a[j].
 * All gridSize-1 draws are performed (the spec specifies the full shuffle; O2).
 * Returns the array as the shuffle leaves it.
 */
export function shuffleTilesFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  gridSize: number = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  checkKey(keyBuffer);
  checkNonce(nonce);
  checkGridSize(gridSize);
  if (typeof clientSeed !== "string") throw new TypeError("clientSeed must be a string");

  const tiles: number[] = [];
  for (let t = 0; t < gridSize; t += 1) tiles.push(t);

  for (let i = 0; i < gridSize - 1; i += 1) {
    const range = gridSize - i; // gridSize, gridSize-1, ..., 2
    const digest = digestForDraw(keyBuffer, clientSeed, nonce, i); // cursor = draw index (§2 step 1)
    const j = drawIndexFromDigest(digest, range, census); // 0 <= j < range (§2 step 2)
    const last = range - 1;
    const held = tiles[last] as number;
    tiles[last] = tiles[j] as number;
    tiles[j] = held;
    if (census) census.draws += 1;
  }
  return tiles;
}

/**
 * Spec §2 step 3: the mines are the first m entries of the shuffled array, a[0 .. m-1].
 * Spec §2 step 4: compared with the record as a sorted set, so they are returned ascending.
 */
export function computeMinePositionsFromBuffer(
  keyBuffer: Buffer,
  clientSeed: string,
  nonce: number,
  mineCount: number,
  gridSize: number = GRID_SIZE,
  census?: DrawCensus,
): number[] {
  checkGridSize(gridSize);
  // Spec §1.1: m is 1..24 on 25 tiles, i.e. at least one mine and at least one safe tile.
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > gridSize - 1) {
    throw new RangeError(`mineCount must be an integer in 1..${gridSize - 1}, got ${mineCount}`);
  }
  const tiles = shuffleTilesFromBuffer(keyBuffer, clientSeed, nonce, gridSize, census);
  return tiles.slice(0, mineCount).sort((x, y) => x - y);
}

/** Same as computeMinePositionsFromBuffer, from the server seed as published (64 hex characters, spec §1.1). */
export function computeMinePositions(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  mineCount: number,
  gridSize: number = GRID_SIZE,
): number[] {
  return computeMinePositionsFromBuffer(decodeServerSeed(serverSeed), clientSeed, nonce, mineCount, gridSize);
}

// ---------------------------------------------------------------------------
// Commitment (spec §1.2)
// ---------------------------------------------------------------------------

/**
 * Spec §1.2: commitment = lowercase hex of SHA-256 over the 32 hex-decoded bytes of the
 * server seed (not over its 64 ASCII characters). A malformed seed cannot match, so it
 * yields false. The published hash is compared case-insensitively.
 */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  if (typeof serverSeedHashed !== "string" || !/^[0-9a-fA-F]{64}$/.test(serverSeedHashed)) return false;
  let key: Buffer;
  try {
    key = decodeServerSeed(serverSeed);
  } catch {
    return false;
  }
  const commitment = createHash("sha256").update(key).digest("hex");
  return commitment === serverSeedHashed.toLowerCase();
}

// ---------------------------------------------------------------------------
// Multiplier helpers (spec §3.2, §3.4)
// ---------------------------------------------------------------------------

function checkMinesAndReveals(mineCount: number, reveals: number, name: string): void {
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > GRID_SIZE - 1) {
    throw new RangeError(`mineCount must be an integer in 1..${GRID_SIZE - 1}, got ${mineCount}`);
  }
  if (!Number.isInteger(reveals) || reveals < 0 || reveals > GRID_SIZE - mineCount) {
    throw new RangeError(`${name} must be an integer in 0..${GRID_SIZE - mineCount}, got ${reveals}`);
  }
}

/**
 * Chance the next reveal is safe after `revealsSoFar` safe reveals:
 * (25 - m - revealsSoFar) of the (25 - revealsSoFar) unopened tiles are safe.
 * Its running product is P(survive k reveals) = C(25-m, k) / C(25, k) (spec §3.2).
 */
export function winChance(mineCount: number, revealsSoFar: number): number {
  checkMinesAndReveals(mineCount, revealsSoFar, "revealsSoFar");
  return (GRID_SIZE - mineCount - revealsSoFar) / (GRID_SIZE - revealsSoFar);
}

/**
 * Reference multiplier, unrounded, in IEEE doubles: (1 - houseEdge) / P(survive `reveals` reveals).
 * 1/P is the spec's fair multiplier M(m, k) = prod_{t<k} (25 - t) / (25 - m - t) (spec §3.2);
 * the (1 - e) factor is the edge of spec §3.4. Rounding to 18 decimals and the stake-band
 * edge lookup are out of scope for this module.
 */
export function theoreticalMultiplier(mineCount: number, reveals: number, houseEdge: number = 0.001): number {
  checkMinesAndReveals(mineCount, reveals, "reveals");
  if (!Number.isFinite(houseEdge) || houseEdge < 0 || houseEdge >= 1) {
    throw new RangeError(`houseEdge must be in [0, 1), got ${houseEdge}`);
  }
  let fair = 1;
  for (let t = 0; t < reveals; t += 1) {
    fair *= (GRID_SIZE - t) / (GRID_SIZE - mineCount - t);
  }
  return fair * (1 - houseEdge);
}
