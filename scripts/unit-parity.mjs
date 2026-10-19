#!/usr/bin/env node
/**
 * UNIT-TEST COUNT PARITY (profile MINES-28). The unit-test count used to be prose in MANIFEST.md
 * and asserted nowhere, so a silently skipped describe block stayed green. This runs the
 * zero-install bundle (node test.js), reads its pass/fail/skip counts, and requires the pass count
 * to equal (a) the count MANIFEST.md states and (b) the Mocha count when Mocha is installed. Any
 * failing, skipped or cancelled test, or any disagreement, exits 1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = m => { console.error(`[unit-parity] FAIL: ${m}`); process.exit(1); };

const t = spawnSync(process.execPath, ['test.js'], { cwd: root, encoding: 'utf8' });
const out = `${t.stdout}${t.stderr}`;
const num = key => { const m = new RegExp(`^[#ℹ]\\s*${key}\\s+(\\d+)`, 'm').exec(out); return m ? Number(m[1]) : null; };
const pass = num('pass'), failed = num('fail'), skipped = num('skipped'), todo = num('todo'), cancelled = num('cancelled');
if (t.status !== 0 || pass === null) fail(`node test.js exited ${t.status}; pass count ${pass}`);
if (failed || skipped || todo || cancelled) fail(`node test.js: fail ${failed}, skipped ${skipped}, todo ${todo}, cancelled ${cancelled}`);

const manifest = fs.readFileSync(path.join(root, 'MANIFEST.md'), 'utf8');
const declared = /\*\*Unit tests:\*\*[^\n]*?(\d+) tests/.exec(manifest);
if (!declared) fail('MANIFEST.md states no unit-test count ("**Unit tests:** … N tests")');
if (Number(declared[1]) !== pass) fail(`node test.js passed ${pass}, MANIFEST.md states ${declared[1]}`);

const mochaBin = path.join(root, 'node_modules', '.bin', 'mocha');
let mochaNote = 'Mocha not installed — zero-install count only';
if (fs.existsSync(mochaBin)) {
  const m = spawnSync(mochaBin, [], { cwd: root, encoding: 'utf8' });
  const mp = /(\d+) passing/.exec(m.stdout ?? '');
  if (m.status !== 0 || !mp) fail(`mocha exited ${m.status}`);
  if (Number(mp[1]) !== pass) fail(`mocha passed ${mp[1]}, node test.js passed ${pass}`);
  mochaNote = `mocha ${mp[1]}`;
}
console.log(`[unit-parity] ${pass} unit tests pass in the zero-install bundle = MANIFEST.md (${declared[1]}) = ${mochaNote}.`);
