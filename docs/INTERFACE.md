# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.
Tiles are 0-based indices 0..gridSize-1, numbered as the spec numbers them.

```ts
export const GRID_SIZE: number;     // 25
export const MAX_UINT32: number;    // largest 32-bit unsigned value
// Exclusive upper end of the accepted 32-bit window for one draw over `range` outcomes.
export function maxFairFor(range: number): number;
// THE single-chunk draw the shuffle uses: index in [0, range) for a 32-bit chunk value, or null if rejected.
// The shuffle must call this function for every draw.
export function drawFromChunk(value: number, range: number): number | null;

// Optional counter; passing one changes nothing computed.
export interface DrawCensus {
  draws: number;           // shuffle steps executed (gridSize - 1 per round)
  chunksRead: number;      // 4-byte chunks read, accepted or not
  rejectedChunks: number;  // chunks rejected
  cursorAdvances: number;  // times a draw needed a further digest beyond its first (0 if the spec never does this)
}
export function newDrawCensus(): DrawCensus;   // all zeros

// The full shuffled tile order (a permutation of 0..gridSize-1) as the spec's shuffle leaves it.
export function shuffleTilesFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number, gridSize?: number, census?: DrawCensus): number[];
// The mine tiles: the spec's selection from that permutation, returned SORTED ascending.
export function computeMinePositionsFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number, mineCount: number, gridSize?: number, census?: DrawCensus): number[];
// Same, taking the server seed as the casino publishes it.
export function computeMinePositions(serverSeed: string, clientSeed: string, nonce: number, mineCount: number, gridSize?: number): number[];
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean;

// Reference (unrounded) multiplier after `reveals` safe reveals with `mineCount` mines on 25 tiles:
// (1 - houseEdge) / P(all `reveals` tiles safe). Default houseEdge 0.001.
export function theoreticalMultiplier(mineCount: number, reveals: number, houseEdge?: number): number;
// Chance the next reveal is safe after `revealsSoFar` safe reveals: (25 - mineCount - revealsSoFar) / (25 - revealsSoFar).
export function winChance(mineCount: number, revealsSoFar: number): number;
```
Payout rounding and edge-band lookup are NOT part of this module; implement only the above.
