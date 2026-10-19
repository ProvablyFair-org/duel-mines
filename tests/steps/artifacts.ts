/**
 * Step 24 — Artifact Integrity.
 *
 * Recompute the SHA-256 of every artifact of record and compare it with the pin in
 * src/artifact-pins.ts. A missing or altered artifact is a HARD FAIL, not a flag: the figures in
 * these files are published, and a flag exits 2 rather than 1.
 *
 * The step reads the COMMITTED copies in outputs/ — never outputs/run/ — so it asks whether the
 * evidence the repository ships is the evidence that was pinned, independently of whatever this
 * run computes. Under PF_EMIT=1 the verifier rewrites those copies AFTER this step has read them,
 * so a regeneration that changes a figure fails here on the NEXT run until it is re-pinned.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { validateDomains, DOMAIN_RULES } from '../../src/domains';

export function run(ctx: VerifyContext): StepResult[] {
  const { outputsDir } = ctx;

  const notes: string[] = [];
  const checked: Record<string, string> = {};
  let bad = 0;

  for (const [file, expected] of Object.entries(ARTIFACT_PINS)) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) {
      bad++;
      checked[file] = 'ABSENT';
      notes.push(`${file} ABSENT — a pinned artifact of record is missing`);
      continue;
    }
    const actual = createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    checked[file] = actual === expected ? 'match' : 'MISMATCH';
    if (actual !== expected) {
      bad++;
      notes.push(`${file} sha256 ${actual.slice(0, 16)}… != pin ${expected.slice(0, 16)}… — the shipped artifact is not the pinned one`);
    } else {
      notes.push(`${file} matches its pin`);
    }
  }

  // VALUE DOMAINS (src/domains.ts). A pin proves the bytes did not change since pinning; it cannot
  // prove the value was ever possible — re-pinning a forgery satisfies it. Every numeric leaf of
  // every JSON artifact of record is therefore held to the domain it physically admits, with bounds
  // from code, and an UNDECLARED numeric leaf fails exactly like an impossible one.
  let leaves = 0;
  const domainProblems: string[] = [];
  const jsonArtifacts = Object.keys(ARTIFACT_PINS).filter(f => f.endsWith('.json'));
  for (const file of jsonArtifacts) {
    const fp = path.join(outputsDir, file);
    if (!fs.existsSync(fp)) continue;                      // already counted as ABSENT above
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(fp, 'utf8')); }
    catch { domainProblems.push(`${file} is not valid JSON`); continue; }
    const r = validateDomains(file, parsed);
    leaves += r.checked;
    domainProblems.push(...r.violations, ...r.uncovered.map(u => `${file} ${u}: numeric leaf with NO declared domain`));
  }
  const undeclaredArtifacts = jsonArtifacts.filter(f => !(f in DOMAIN_RULES));
  for (const f of undeclaredArtifacts) domainProblems.push(`${f}: no domain table in src/domains.ts`);

  const total = Object.keys(ARTIFACT_PINS).length;
  const ok = bad === 0 && domainProblems.length === 0;
  return [step(24, 'Artifact Integrity (pinned artifacts of record)',
    ok ? 'PASS' : 'FAIL',
    bad > 0
      ? `${bad} of ${total} pinned artifact(s) do not match src/artifact-pins.ts: ${notes.filter(n => !n.endsWith('matches its pin')).join('; ')}`
        + (domainProblems.length ? ` | VALUE DOMAINS: ${domainProblems.slice(0, 4).join('; ')}` : '')
      : domainProblems.length > 0
        ? `VALUE DOMAINS: ${domainProblems.length} numeric leaf problem(s): ${domainProblems.slice(0, 4).join('; ')}`
        : `${total} artifacts of record in outputs/ (${Object.keys(ARTIFACT_PINS).join(', ')}) match their SHA-256 pins `
          + `in src/artifact-pins.ts byte for byte, none carries run metadata, and every numeric leaf of the `
          + `${jsonArtifacts.length} JSON artifacts lies in the value domain src/domains.ts declares for it (bounds from code).`,
    { artifactsPinned: total, mismatches: bad, artifacts: checked, domainLeavesChecked: leaves, domainProblems: domainProblems.length },
  )];
}
