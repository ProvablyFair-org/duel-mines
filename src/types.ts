/**
 * Duel.com Mines — type definitions.
 * Matches the capture output the dataset was produced by (capture/mines-capture.reference.js, v5).
 */

export type Phase = 'A' | 'B' | 'C' | 'D' | 'E1' | 'E2' | 'E3' | 'E4' | 'E5';

export interface RevealStep {
  step: number;
  position: number;
  multiplier: string | null;
  no_house_edge_multiplier?: string | null;
  revealed_positions: number[];
  status: number;
  is_mine: boolean;
}

export interface MinesGame {
  at: string;
  phase: Phase;
  request: {
    mines_count: number;
    amount: string;
    target_k?: number;
    positions_attempted?: number[];
  };
  response: {
    round_id: number;
    outcome: 'win' | 'loss';
    mines_count: number;
    revealed_positions: number[];
    mines_positions: number[];
    multiplier: string;
    no_house_edge_multiplier?: string;
    amount_won: string;
    amount_currency: string;
    transaction_id: number;
    effective_edge: number;
    cashed_out?: boolean;
    reached_k?: number;
  };
  reveal_steps?: RevealStep[];
  seed: {
    serverSeedHashed: string;
    clientSeed: string;
    nonce: number;
  };
}

export interface NextSeedPromotion {
  previousNextHash: string;
  newActiveHash: string;
  newNextHash: string;
  match: boolean;
}

export interface SeedEntry {
  at: string;
  context: string;
  phase: string;
  seed: {
    clientSeed: string;
    serverSeedHashed: string;
    nextServerSeedHash: string;
    serverSeed: string | null;
  };
  nonce: number;
  nextSeedPromotion?: NextSeedPromotion;
  revealedFrom?: { transactionId: number };
}

export interface MinesDataset {
  meta: Record<string, unknown>;
  seeds: SeedEntry[];
  bets: MinesGame[];
}

export interface StepResult {
  step: number;
  name: string;
  /** INFO: an informational step's deviation (profile policy INFORMATIONAL — the live-sample fit, Mike
   *  2026-09-29): reported, never counted as a flag, never affects the verdict. */
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO';
  detail: string;
  /**
   * The step's measurements, as numbers.
   *
   * A MEASURED FLOAT MUST NEVER BE EMBEDDED IN `detail`. A string leaf cannot be
   * tolerance-compared: the reproduction gate in tests/verify.ts can only ask whether two
   * strings are identical, so an RTP or a deviation printed into the sentence turns ordinary
   * last-place drift on another machine into a permanent, unfixable disagreement — and the
   * first thing a reader does with a diff that always fails is stop reading it.
   *
   * The split: `detail` states the BOUND the step tested against, which is a constant and
   * compares exactly. The measurement goes here, where the tolerance applies.
   */
  data?: Record<string, unknown>;
  /**
   * 'capture' marks a FLAG raised by the AUDITOR'S capture (a retried request that left a nonce
   * gap), not by anything the operator served. It is disclosed on every run but verdict-neutral:
   * the verdict stays Full Pass and the exit status 0. Only an operator-origin FLAG downgrades to
   * Conditional Pass (profile policies.FLAG, decided 2026-09-17; same mechanism as Duel Video Poker).
   */
  origin?: 'capture';
}

export interface InfoItem {
  label: string;
  detail: string;
}
