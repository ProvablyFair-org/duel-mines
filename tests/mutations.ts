/**
 * Mutation gate (falsifiability) — run: npm run mutate
 *
 * Ported from the sibling LIQD Mines package (tests/mutations.ts), with two extensions:
 * multi-file `edits` (a forged artifact AND the re-pin a forger would make) and the
 * `[FLAG:capture]` step tag.
 *
 * Reads `tests/mutations.json`. Each entry names one or more source/data edits that SHOULD break
 * the verdict, the exact `VERDICT:` line the mutated run must print (`expect`), and — the part that
 * matters — the SPECIFIC STEP that must fire (`expectStep` + `expectStatus`). Matching only the
 * global verdict cannot tell a live guard from a dead one: a mutation can flip the verdict through
 * some other step while the step the registry names has quietly stopped guarding. So the named
 * step must print [FAIL] or [FLAG], or the entry is a MISS even when the verdict flipped.
 *
 * C3 (14 Oct 2026): `regen: ["rtp-table", "record"]` regenerates the RTP table (re-pinned) and the
 * record in the temp copy after the edits; `expectExit: N` also requires that exit (5 = RTP FIGURE
 * OVERSTATED); runner "test" = mocha, then verify only when mocha passed (what `npm test` checks).
 *
 * Entry shapes:
 *   { name, file, find, replace, [find2, replace2], runner, expect, expectStep, expectStatus, guard }
 *   { name, edits: [{ file, find, replace } | { file, delete: true }], runner, expect, expectStep, ... }
 *
 * SURVIVORS ARE DECLARED, NOT HIDDEN: `tests/survivors.json` holds the mutations this suite does
 * NOT catch, each with a `why` naming the limitation (MANIFEST.md DL-n). They are run and printed
 * but do not fail the gate; one that starts being caught is reported so the registry is updated.
 *
 * Every mutation runs in a fresh temp copy of src/ tests/ data/ outputs/ (+ config files) with
 * node_modules symlinked; the working tree is NEVER touched.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

const repoRoot = path.resolve(__dirname, '..');

interface Edit { file: string; find?: string; replace?: string; delete?: boolean }
interface Mutation {
  name: string;
  file?: string; find?: string; replace?: string; find2?: string; replace2?: string;
  edits?: Edit[];
  runner: 'verify' | 'mocha' | 'test';
  regen?: string[];
  expectExit?: number;
  expect: string;
  expectStep?: number;
  expectStatus?: 'FAIL' | 'FLAG' | 'INFO';
  guard?: string;
  survivor?: boolean;
  why?: string;
}

const mustFail: Mutation[] = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests', 'mutations.json'), 'utf-8'));
const survivorsPath = path.join(repoRoot, 'tests', 'survivors.json');
const declaredSurvivors: Mutation[] = fs.existsSync(survivorsPath)
  ? JSON.parse(fs.readFileSync(survivorsPath, 'utf-8')).map((m: Mutation) => ({ ...m, survivor: true }))
  : [];
const manifest: Mutation[] = [...mustFail, ...declaredSurvivors];
const COPY = ['src', 'tests', 'data', 'outputs', 'verifier-parity', 'evidence', 'tsconfig.json', 'package.json', '.mocharc.yml'];
const only = process.argv.slice(2);   // optional name prefixes, e.g. `npm run mutate -- M03`

console.log('\n══════════════════════════════════════════════════════════');
console.log('  DUEL MINES — MUTATION GATE (falsifiability)');
console.log('══════════════════════════════════════════════════════════');

let misses = 0, caught = 0, survivors = 0, ran = 0;
const stepsKilled = new Set<number>();

function applyEdits(tmp: string, mut: Mutation): string | null {
  const edits: Edit[] = mut.edits ?? [
    { file: mut.file!, find: mut.find, replace: mut.replace },
    ...(mut.find2 !== undefined ? [{ file: mut.file!, find: mut.find2, replace: mut.replace2 }] : []),
  ];
  for (const e of edits) {
    const target = path.join(tmp, e.file);
    if (!fs.existsSync(target)) return `file ${e.file} not present`;
    if (e.delete) { fs.rmSync(target, { recursive: true, force: true }); continue; }
    const text = fs.readFileSync(target, 'utf-8');
    if (e.find === undefined || !text.includes(e.find)) return `find string not present in ${e.file}`;
    const next = text.replace(e.find, e.replace ?? '');
    if (next === text) return `find === replace in ${e.file}, nothing was mutated`;
    fs.writeFileSync(target, next);
  }
  return null;
}

// ── C3 route (FIXPASS2 class C3, 14 Oct 2026) ───────────────────────────────────
// An RTP miss reaches the verdict only when the committed RTP table and the committed verification
// record are consistent with the mutated package; with either stale the run is a reproduction
// failure (exit 1), a different guard. `regen` regenerates them in the temp copy, in order:
//   "rtp-table"  outputs/rtp-claim-table.json by the package's own writer (src/rtp-settings.ts, the
//                script behind `npm run rtp-claim:write`), RTP_CLAIM_TABLE_SHA256 re-pinned to it
//   "record"     the committed record re-emitted (PF_EMIT=1 tests/verify.ts); where src/artifact-pins.ts
//                pins the committed record, that pin is re-made too
// `expectExit` then requires the run's exit code (5 = RTP FIGURE OVERSTATED) on top of the verdict and
// the named step, and runner "test" runs mocha first and the verifier only when mocha passed, as
// `npm test` does in a package that runs both.
function regenerate(tmp: string, what: string[]): string | null {
  const tsNode = ['-r', 'ts-node/register/transpile-only'];
  for (const w of what) {
    if (w === 'rtp-table') {
      let out = '';
      try { out = execFileSync('node', [...tsNode, 'src/rtp-settings.ts'], { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (e: any) { return `regen rtp-table: exit ${e.status} ${String(e.stderr ?? '').slice(-300)}`; }
      const sha = /sha256 ([0-9a-f]{64})/.exec(out)?.[1];
      if (!sha) return 'regen rtp-table: the writer printed no sha256';
      const p = path.join(tmp, 'src', 'rtp-settings.ts');
      const text = fs.readFileSync(p, 'utf-8');
      const pin = /(export const RTP_CLAIM_TABLE_SHA256 = ')[0-9a-f]{64}(')/;
      if (!pin.test(text)) return 'regen rtp-table: RTP_CLAIM_TABLE_SHA256 pin not found';
      fs.writeFileSync(p, text.replace(pin, `$1${sha}$2`));
    } else if (w === 'record') {
      const rec = path.join('outputs', 'verification-results.json');
      const before = fs.existsSync(path.join(tmp, rec)) ? createHash('sha256').update(fs.readFileSync(path.join(tmp, rec))).digest('hex') : null;
      try { execFileSync('node', [...tsNode, 'tests/verify.ts'], { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PF_EMIT: '1' }, maxBuffer: 64 * 1024 * 1024 }); }
      catch (e: any) { if (e.status === null || e.status === undefined) return `regen record: no exit status (${e.signal})`; }
      const after = createHash('sha256').update(fs.readFileSync(path.join(tmp, rec))).digest('hex');
      const pins = path.join(tmp, 'src', 'artifact-pins.ts');
      if (before && fs.existsSync(pins)) {
        const text = fs.readFileSync(pins, 'utf-8');
        if (text.includes(before)) fs.writeFileSync(pins, text.split(before).join(after));
      }
    } else {
      return `unknown regen "${w}"`;
    }
  }
  return null;
}

for (const mut of manifest) {
  if (only.length && !only.some(p => mut.name.startsWith(p))) continue;
  ran++;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duel-mines-mut-'));
  try {
    for (const item of COPY) {
      const src = path.join(repoRoot, item);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(tmp, item), { recursive: true });
    }
    fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');
    const problem = applyEdits(tmp, mut) ?? (mut.regen ? regenerate(tmp, mut.regen) : null);
    if (problem) {
      if (mut.survivor) { survivors++; console.log(`  SURVIVOR (could not apply) ${mut.name} — ${problem}`); }
      else { misses++; console.log(`  MISS   ${mut.name} — ${problem} (mutation could not be applied)`); }
      continue;
    }

    let out = '', rc = 0;
    const runOne = (argv: string[]): { out: string; rc: number } => {
      try {
        return { out: execFileSync('node', argv, { cwd: tmp, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }), rc: 0 };
      } catch (e: any) {
        return { out: `${e.stdout ?? ''}${e.stderr ?? ''}`, rc: e.status ?? 1 };
      }
    };
    const MOCHA = ['node_modules/.bin/mocha'];
    const VERIFY = ['-r', 'ts-node/register/transpile-only', 'tests/verify.ts'];
    if (mut.runner === 'test') {
      const unit = runOne(MOCHA);
      ({ out, rc } = unit.rc !== 0 ? { out: `[runner test: mocha exit ${unit.rc}]\n${unit.out}`, rc: unit.rc } : runOne(VERIFY));
      if (unit.rc === 0) out = `[runner test: mocha exit 0]\n${out}`;
    } else {
      ({ out, rc } = runOne(mut.runner === 'mocha' ? MOCHA : VERIFY));
    }

    let ok: boolean, note: string;
    if (mut.runner === 'mocha') {
      const failing = /(\d+) failing/.exec(out);
      ok = rc !== 0 && out.includes(mut.expect) && failing !== null && Number(failing[1]) > 0;
      note = `mocha exit ${rc}, ${failing?.[1] ?? 0} failing, marker '${mut.expect}' ${out.includes(mut.expect) ? 'present' : 'ABSENT'}`;
    } else {
      const line = out.split('\n').find(l => l.includes('VERDICT:')) ?? '';
      const aborted = /ABORT:/.test(out);
      const verdict = line.replace(/^.*VERDICT:\s*/, '').trim() || (aborted ? '(pre-flight ABORT)' : '(no VERDICT line)');
      const verdictOk = verdict === mut.expect;
      let stepOk = true, stepSeen = '(not declared)';
      if (mut.expectStep !== undefined) {
        const re = new RegExp(`\\[(PASS|FLAG|FLAG:capture|FAIL|INFO)\\] Step ${mut.expectStep} `);
        // The LAST line naming the step: a step RTP-CLAIM re-scores prints its original line and then a
        // "[FLAG] Step N — … (re-scored: …)" line after it (C3, 14 Oct 2026).
        stepSeen = [...out.matchAll(new RegExp(re.source, 'g'))].map(m => m[1]).pop() ?? '(step line absent)';
        stepOk = stepSeen === (mut.expectStatus ?? 'FAIL');
      }
      const exitOk = mut.expectExit === undefined || rc === mut.expectExit;
      ok = verdictOk && stepOk && exitOk;
      note = `VERDICT: ${verdict} (expected ${mut.expect})`
        + (mut.expectStep !== undefined ? `; Step ${mut.expectStep}: ${stepSeen} (expected ${mut.expectStatus ?? 'FAIL'})` : '')
        + (mut.expectExit !== undefined ? `; exit ${rc} (expected ${mut.expectExit})` : '');
      if (verdictOk && !stepOk) note += ' — DECLARED GUARD IS DECORATION: the verdict flipped through some OTHER step';
      // The named step's own detail line, so the evidence is the step's words, not only its tag.
      if (mut.expectStep !== undefined) {
        const lines = out.split('\n');
        const at = lines.findIndex(l => new RegExp(`\\] Step ${mut.expectStep} `).test(l));
        const detail = at >= 0 ? (lines[at + 1] ?? '').trim() : '';
        if (detail && !/^\[/.test(detail)) note += `\n           ${detail.slice(0, 240)}`;
      }
      if (ok && mut.expectStep !== undefined && !mut.survivor) stepsKilled.add(mut.expectStep);
    }

    if (mut.survivor) {
      survivors++;
      console.log(`  ${ok ? 'SURVIVOR-NOW-CAUGHT' : 'SURVIVOR (declared)'} ${mut.name}`);
      console.log(`         → ${note}`);
      console.log(`         → why: ${mut.why ?? '(no reason declared — that is a registry defect)'}`);
    } else if (ok) {
      caught++;
      console.log(`  CAUGHT ${mut.name}`);
      console.log(`         → ${note}`);
    } else {
      misses++;
      console.log(`  MISS   ${mut.name}`);
      console.log(`         → ${note}`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const scored = ran - survivors;
const SCORED_STEPS = 26;
const unkilled = only.length ? [] : Array.from({ length: SCORED_STEPS }, (_, i) => i + 1).filter(s => !stepsKilled.has(s));
console.log('──────────────────────────────────────────────────────────');
console.log(`  ${caught}/${scored} must-fail mutations caught by their NAMED step; ${misses} missed; ${survivors} declared survivor(s)`);
if (!only.length) {
  console.log(`  Scored steps with at least one killing mutation: ${SCORED_STEPS - unkilled.length}/${SCORED_STEPS}`
    + (unkilled.length ? ` — NO KILLER for step(s) ${unkilled.join(', ')}` : ''));
}
console.log('══════════════════════════════════════════════════════════\n');
if (misses > 0 || unkilled.length > 0) process.exit(1);
