/**
 * Compare a REGENERATED simulation (outputs/run/simulation-results.json, written by
 * `npm run simulate:run`) with the committed artifact of record, field by field, under the
 * reproduction rule (src/diff.ts: integers and strings exact, non-integers within
 * 1e-14 + 1e-12·max). `npm run test:full` runs it after re-simulating, so a regeneration is never
 * written and then left unexamined (profile MINES-28). Writes outputs/run/diff-simulation.json;
 * exits 1 on anything beyond tolerance or a missing file. Never writes the committed artifact.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from './diff';

const OUT = path.join(__dirname, '..', 'outputs');
const files = ['simulation-results.json'];
let beyond = 0;
const report: unknown[] = [];
for (const f of files) {
  const committedPath = path.join(OUT, f), runPath = path.join(OUT, 'run', f);
  if (!fs.existsSync(committedPath) || !fs.existsSync(runPath)) {
    console.log(`  ${f}: ${fs.existsSync(runPath) ? 'committed copy' : 'regeneration'} ABSENT — nothing to compare`);
    beyond++;
    continue;
  }
  const diffs = fieldDiff(JSON.parse(fs.readFileSync(committedPath, 'utf8')), JSON.parse(fs.readFileSync(runPath, 'utf8')), []);
  const real = beyondTolerance(diffs);
  beyond += real.length;
  const gap = maxima(diffs);
  report.push({ file: `outputs/${f}`, differences: diffs, beyondTolerance: real.length, largestGap: gap });
  console.log(`  ${f}: ${real.length === 0 ? 'REPRODUCED' : `${real.length} field(s) BEYOND TOLERANCE`}`
    + ` (${diffs.length - real.length} within tolerance${gap ? `, largest ${gap.absDiff.toExponential(2)} at ${gap.path}` : ''})`);
  for (const d of real.slice(0, 5)) console.log(`      ${d.path}: committed ${JSON.stringify(d.committed)} vs regenerated ${JSON.stringify(d.thisRun)}`);
}
fs.mkdirSync(path.join(OUT, 'run'), { recursive: true });
fs.writeFileSync(path.join(OUT, 'run', 'diff-simulation.json'), JSON.stringify({
  runtime: process.versions.node, tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL }, reproduced: beyond === 0, files: report,
}, null, 2));
if (beyond > 0) process.exit(1);
