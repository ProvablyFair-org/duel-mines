#!/usr/bin/env node
/** Detect stale compiled code without requiring the development dependencies. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => {
  console.error(`[standalone] FAIL: ${message}`);
  console.error('After an intentional source edit, run npm ci --include=dev and npm run build.');
  process.exit(1);
};
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const rel = dir + '/' + entry.name;
    return entry.isDirectory() ? walk(rel) : [rel];
  }).sort();
}
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'standalone-manifest.json'), 'utf8'));
  if (manifest.format !== 1 || !manifest.inputs || !manifest.outputs) fail('Invalid build manifest.');
  const sourcePaths = ['src', 'tests'].flatMap(walk).filter(p => p.endsWith('.ts')).sort();
  const expectedInputs = [...sourcePaths, 'tsconfig.json', '.mocharc.yml', 'package-lock.json',
    'scripts/build-standalone.mjs', 'scripts/check-standalone.mjs', 'scripts/standalone-runtime.cjs'].sort();
  if (JSON.stringify(Object.keys(manifest.inputs).sort()) !== JSON.stringify(expectedInputs)) {
    fail('Source inventory differs from the bundled build.');
  }
  if (JSON.stringify(manifest.unitEntries) !== JSON.stringify(sourcePaths.filter(p => p.endsWith('Tests.ts')))) {
    fail('Unit-test inventory differs from the bundled build.');
  }
  if (JSON.stringify(Object.keys(manifest.outputs).sort()) !== JSON.stringify(['test.js', 'verify.js'])) {
    fail('Bundled entry-point inventory is incomplete.');
  }
  for (const files of [manifest.inputs, manifest.outputs]) {
    for (const [name, expected] of Object.entries(files)) {
      const actual = createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex');
      if (actual !== expected) fail(`${name} differs from the bundled build.`);
    }
  }
  console.log('[standalone] Source inventory, unit-test inventory and both compiled entry points match the build manifest.');

  // RELEASE-GATE PARITY (MINES-28; the shape follows the sibling LIQD Mines package). The numbers the
  // report states about the suite must be the suite's own: the audit ID MANIFEST.md and README.md
  // carry is the AUDIT_ID constant in src/loader.ts and the one the committed run record emits, and
  // the scored-step count they quote is the number of steps in that record. The unit-test count is
  // enforced separately by scripts/unit-parity.mjs, which has to run the suite to know it.
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const auditId = (/export const AUDIT_ID = '([^']+)'/.exec(read('src/loader.ts')) ?? [])[1];
  if (!auditId) fail('src/loader.ts declares no AUDIT_ID.');
  const manifestMd = read('MANIFEST.md');
  const readme = read('README.md');
  if (!manifestMd.includes(`**Audit ID:** ${auditId}`)) fail(`MANIFEST.md does not carry the audit ID ${auditId} declared in src/loader.ts.`);
  if (!readme.includes(`**Audit ID:** ${auditId}`)) fail(`README.md does not carry the audit ID ${auditId} declared in src/loader.ts.`);
  const record = JSON.parse(read('outputs/verification-results.json'));
  if (record.auditId !== auditId) fail(`outputs/verification-results.json carries audit ID ${record.auditId}, src/loader.ts declares ${auditId}.`);
  const scored = Array.isArray(record.steps) ? record.steps.length : NaN;
  const quotedSteps = [...manifestMd.matchAll(/\*\*Verification steps:\*\* (\d+) scored steps/g), ...readme.matchAll(/(\d+) scored verification steps/g)]
    .map(m => Number(m[1]));
  if (quotedSteps.length < 2 || quotedSteps.some(n => n !== scored)) fail(`scored-step count quoted in MANIFEST.md/README.md (${quotedSteps.join(', ') || 'none'}) != ${scored} steps in outputs/verification-results.json.`);
  console.log(`[standalone] Audit ID ${auditId} and ${scored} scored steps: MANIFEST.md, README.md and outputs/verification-results.json agree with src/loader.ts.`);
} catch (error) {
  fail(error.message);
}
