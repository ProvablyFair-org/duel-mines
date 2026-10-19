#!/usr/bin/env node
'use strict';
/**
 * Runs DUEL'S OWN Mines verification code — the JavaScript shown in the code panel of
 * duel.com → Provably Fair → Verify (Mines) — on a batch of rounds.
 *
 *   node run-operator-verifier.cjs <operator-file.js>        jobs as JSON on stdin → JSON on stdout
 *
 * jobs: { rounds: [{ id, serverSeed, clientSeed, nonce, gridSize, minesCount }] }
 *
 * WHAT RUNS. evidence/verify-tab/duel-verify-tab-mines-2026-09-25.js, byte for byte, never edited
 * (its SHA-256 is pinned in src/operator-verifier.ts and checked by the caller before this runner
 * starts). Not one character of it is rewritten, not even in memory: the file is plain script (no
 * import, no export), so it is evaluated with node:vm inside a function wrapper, and the wrapper
 * returns the file's own top-level function.
 *
 * WHAT IS NOT DUEL'S CODE (the whole harness surface, listed so it can be reviewed):
 *   1. the wrapper `(function (crypto, TextEncoder, console) { <file> ; return { … }; })`. `crypto`
 *      is Node's WebCrypto (globalThis.crypto — the same W3C API the browser gives the page; the file
 *      calls crypto.subtle.importKey / crypto.subtle.sign), `TextEncoder` is Node's, and `console` is
 *      a recorder: the file's own top level runs with its empty inputs and logs its "Please provide
 *      valid …" line — the recorded lines are returned so the caller can see the file ran as shipped.
 *   2. the calls: for each round, generateMinesPositions(serverSeed, clientSeed, nonce, gridSize,
 *      minesCount) — the file's own function, with the file's own argument order.
 * Exit 0 with JSON; exit 1 if the file will not evaluate or does not define that function.
 */
const vm = require('vm');
const fs = require('fs');

function fail(msg) { process.stderr.write(`operator verifier: ${msg}\n`); process.exit(1); }

const file = process.argv[2];
if (!file) fail('usage: run-operator-verifier.cjs <operator-file.js>');
const src = fs.readFileSync(file, 'utf8');
const jobs = JSON.parse(fs.readFileSync(0, 'utf8'));
if (!jobs || !Array.isArray(jobs.rounds)) fail('jobs must be { rounds: [...] }');

const logs = [];
const recorder = { log: (...a) => logs.push(a.map(String).join(' ')), error: (...a) => logs.push(a.map(String).join(' ')) };

let mod;
try {
  const wrapped = `(function (crypto, TextEncoder, console) {\n${src}\n;return { generateMinesPositions };\n})`;
  mod = vm.runInThisContext(wrapped, { filename: file })(globalThis.crypto, TextEncoder, recorder);
} catch (e) { fail(`file did not evaluate: ${e.message}`); }
if (typeof mod.generateMinesPositions !== 'function') fail('file does not define generateMinesPositions');

(async () => {
  const results = [];
  const BATCH = 200;
  for (let i = 0; i < jobs.rounds.length; i += BATCH) {
    const slice = jobs.rounds.slice(i, i + BATCH);
    const out = await Promise.all(slice.map(async r => {
      try {
        const mines = await mod.generateMinesPositions(r.serverSeed, r.clientSeed, Number(r.nonce), Number(r.gridSize), Number(r.minesCount));
        return { id: r.id, mines: Array.from(mines) };
      } catch (e) { return { id: r.id, mines: null, error: e.message }; }
    }));
    results.push(...out);
  }
  await new Promise(r => setImmediate(r));
  process.stdout.write(JSON.stringify({ logs, results }));
})().catch(e => fail(e.message));
