import type { MinesGame, SeedEntry, StepResult, InfoItem } from '../../src/types';
import type { EpochGroup } from '../../src/loader';

export type { StepResult, InfoItem };

export interface VerifyContext {
  bets:       MinesGame[];
  seeds:      SeedEntry[];
  seedMap:    Map<string, string>;
  /** Epochs keyed by the capture timeline (src/loader.ts groupByEpochWindow), NOT by hash. */
  epochs:     EpochGroup[];
  /** Bets captured before any rotation record — must be empty. */
  orphanBets: MinesGame[];
  phaseA:     MinesGame[];
  phaseB:     MinesGame[];
  phaseC:     MinesGame[];
  phaseD:     MinesGame[];
  /** The Phase E multi-reveal corpus — the only evidence behind the k>1 steps 20–23. */
  phaseEBets: MinesGame[];
  /** The Phase E rotation records, and its bets grouped by the capture timeline over them. */
  phaseESeeds:   SeedEntry[];
  phaseEEpochs:  EpochGroup[];
  phaseEOrphans: MinesGame[];
  outputsDir: string;
  // Mutable accumulators
  step5Mismatches: number;
  step5Skipped:    number;
  chiResultsLog:   Record<string, unknown>[];
  /** Filled by step 11; written to outputs/payout-coverage.json and scored by the reproduction gate. */
  payoutCoverage:  Record<string, unknown> | null;
}

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO',
  detail: string,
  data?:  Record<string, unknown>,
  origin?: 'capture',
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'INFO' ? '[INFO]' : status === 'FLAG' ? (origin === 'capture' ? '[FLAG:capture]' : '[FLAG]') : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  const r: StepResult = data === undefined
    ? { step: num, name, status, detail }
    : { step: num, name, status, detail, data };
  if (status === 'FLAG' && origin === 'capture') r.origin = 'capture';
  return r;
}
