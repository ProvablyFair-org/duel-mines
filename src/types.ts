/**
 * Duel.com Mines — type definitions.
 * Matches the actual capture output from mines-capture.js.
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
  status: 'PASS' | 'FLAG' | 'FAIL';
  detail: string;
}

export interface InfoItem {
  label: string;
  detail: string;
}
