/**
 * LIVE-SITE PLAYER-VERIFIER PARITY (profile MINES-24).
 *
 * The public ProvablyFair.org verifier a player actually uses is the Next.js page
 * https://www.provablyfair.org/verify-bets. Its verification code ships in the page's JavaScript
 * chunks: chunk 34934e0e762aa37e.js carries the page module (Turbopack module 7721), whose verifier
 * class dispatches `VERIFY({ casinoName, ... })` to verifyHouseBetsGame (HouseBets) or
 * verifyDuelsGame (Duel.com). A player who pastes a round into that page is trusting THAT code, not
 * this package's src/rng.ts. Its source repository is not available to this audit; the deployed bundle is.
 *
 * WHAT THIS FILE DOES.
 *   1. PINS the SHA-256 of the three site files the Mines derivation needs (LIVE_SITE_PINS): the
 *      site's Turbopack runtime chunk, the chunk carrying the page module and its crypto
 *      dependencies, and the chunk carrying the `process` shim those dependencies require — plus
 *      the package's own runner (verifier-parity/live-site/run-live-verifier.cjs), so an edit to the
 *      harness is as visible as an edit to the site bytes.
 *   2. Holds byte-exact copies under verifier-parity/live-site/chunks/, as downloaded (URLs in
 *      LIVE_SITE_PROVENANCE). The copies must hash to the pins or the parity leg FAILs before
 *      anything runs.
 *   3. EXECUTES them — not a re-typing — in a child Node process (the runner), which evaluates the
 *      chunks with the site's own Turbopack runtime, instantiates the page module, and makes on every
 *      round the call the page's "Verify Result" button makes. The runner's header lists every line
 *      of harness surface (browser globals, inert stand-ins for the page's React/UI modules, a
 *      one-shot bind observer). The child process is used because the Duel path awaits WebCrypto
 *      (crypto.subtle) and the suite is synchronous; spawnSync keeps it synchronous and needs no
 *      install — `node` itself is the only dependency.
 *
 * scripts/check-site-verifier.mjs re-downloads the live page and each pinned chunk (GET only) and
 * compares the bytes with these pins (exit 1 on any difference), so a site deploy that changed the
 * verifier is caught at release time.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const LIVE_SITE_DIR = path.join(__dirname, '../verifier-parity/live-site');
export const LIVE_SITE_RUNNER = 'run-live-verifier.cjs';

/** Path under verifier-parity/live-site → SHA-256 of the exact bytes. */
export const LIVE_SITE_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chunks/turbopack-828b80f561e7c968.js': '6e8629f444df945f8fecfdfe05e24f4fa6c63b6b1ecc8f39fc45e9c4f4ecc903',
  'chunks/34934e0e762aa37e.js':           '9fb319dec0d79f9bf5851ec8e0052b6b2125e603be03d12b78a0fe99eed817d1',
  'chunks/4f34301b2f166201.js':           '8111e3f3e9a137888558f69547a19b0238d1c50a339b4c51095f9481785df0f5',
  'run-live-verifier.cjs':                'b06a01332a26a931c73c58c1399b956958e3cf552741a925939d331c2a7f9488',
});

/** Where the pinned site bytes came from. Read-only GETs of our own public site, 2026-09-24. */
export const LIVE_SITE_PROVENANCE = Object.freeze({
  page: 'https://www.provablyfair.org/verify-bets',
  chunkBase: 'https://www.provablyfair.org/_next/static/chunks/',
  fetchedOn: '2026-09-24',
  /** SHA-256 of the page HTML as served at fetch time (it lists 18 chunk URLs; the three pinned are among them). */
  pageSha256AtFetch: 'ab20af5a6157c914e7d448a98d711851366f5a5f374335f45f0afbf852fddecd',
  pageEtagAtFetch: '"q4121ltuup261t"',
  /** Vercel deployment id written into the runtime chunk. */
  deploymentId: 'dpl_CxkerpJA9YjmxnP8qfA4d2jqFdti',
  pageModule: 7721,
});

export type LiveSiteCasino = 'HouseBets' | 'Duel.com';
export interface LiveSiteRound { id: string | number; serverSeed: string; clientSeed: string; nonce: number; minesCount: number }

export interface LiveSiteRun {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** id → the mine positions the site printed (null if the site returned no integer list). */
  mines: Map<string, number[] | null> | null;
  /** Module ids the runner replaced with inert stand-ins (the page's rendering stack). */
  standIns: number[];
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/**
 * Hash the vendored files against the pins and, only if every one matches, run the site's verifier
 * on `rounds`. Never throws: a failure is returned as `error` so the calling step reports a FAIL.
 */
export function runLiveSiteVerifier(casinoName: LiveSiteCasino, rounds: LiveSiteRound[], dir = LIVE_SITE_DIR): LiveSiteRun {
  const files = Object.entries(LIVE_SITE_PINS).map(([file, pinned]) => {
    const p = path.join(dir, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) {
    return { files, hashesMatch, mines: null, standIns: [], error: 'vendored live-site verifier does not match its pinned SHA-256' };
  }
  const r = spawnSync(process.execPath, [path.join(dir, LIVE_SITE_RUNNER), path.join(dir, 'chunks')], {
    input: JSON.stringify({ casinoName, rounds }),
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
  if (r.status !== 0) {
    return { files, hashesMatch, mines: null, standIns: [],
      error: `live-site verifier runner exited ${r.status}: ${(r.stderr || String(r.error || '')).trim().slice(0, 400)}` };
  }
  try {
    const out = JSON.parse(r.stdout) as { standIns: number[]; results: Array<{ id: string | number; mines: number[] | null }> };
    const mines = new Map<string, number[] | null>();
    for (const x of out.results) mines.set(String(x.id), x.mines);
    return { files, hashesMatch, mines, standIns: out.standIns, error: null };
  } catch (e) {
    return { files, hashesMatch, mines: null, standIns: [], error: `live-site verifier output unreadable: ${(e as Error).message}` };
  }
}
