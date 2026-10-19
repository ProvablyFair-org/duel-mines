/**
 * RTP-CLAIM wiring — Duel Mines: the per-setting exact RTP table and the claim it is held to.
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), version 1.2.0 (Methodology v1.1, agreed 2026-10-14;
 * 1.0.0 agreed on Slack 2026-09-29). The enforcement switch RTP_CLAIM_RULE_ENFORCED is the
 * package's own src/rtp-claim-switch.ts, set to true (decision D3): the outcome is scored on the
 * step carrying MINES-19, and a house-side miss makes the verdict RTP FIGURE OVERSTATED (exit 5),
 * never NOT PROVABLY FAIR. The claim names one of the rule's six places: the game settings.
 *
 * CLAIM. Kind 'tiered' (rule 1.2.0, decision D2: "The edge in Duel's game settings counts"), as in
 * the Keno package: each cell is held to its own band. Duel's mines settings (E14, GET
 * /api/v2/mines/settings?mines=1…24 as fetched 2026-10-05 in a logged-in session, read-only; pinned
 * in src/scaling-edge.ts) state a house_edge for every stake tier of every (mines, depth) cell. Each
 * row carries the tier it is priced at, keyed by that stated edge ("house_edge=0.0021"), and is held
 * to 1 − that edge within the band. Every edge E14 states is listed as a tier of the claim.
 * Until 19 October 2026 the claim was flat 99.9 % (the 0.1 % base tier) on all 300 cells, although
 * E14 gives six of them no 0.1 % tier (Mike's QA, 19 Oct 2026: "Score each cell against its own band,
 * as Keno does").
 *
 * SETTINGS. Every (mines m, cash-out after k reveals) cell: m = 1–24, k = 1 … 25 − m — 300 cells, one
 * row each, priced at the FIRST tier of that cell's E14 list (the tier from a $0 stake, the one a
 * minimum stake falls in): house_edge 0.001 on 294 cells; on the six full-board cash-outs (10–15
 * mines, all safe tiles revealed) E14 has no 0.1 % tier and the first tier is 0.0014 (10, 15 mines),
 * 0.0018 (11, 14) or 0.0021 (12, 13). The higher stake tiers are not tabled: E14 holds no multiplier,
 * so a row there would be the formula at the tier's edge held to that same edge.
 * EXACT RTP. survival C(25−m, k)/C(25, k) × the operator multiplier at the row's edge,
 * C(25, k)·(1 − edge)/C(25−m, k) (src/exact.ts exactMultiplierAtEdge, which goes through
 * exactMultiplier). At 0.001 the served 18-dp multiplier matches it at relative 1e-12 (Steps 8, 10,
 * 23); at the six cells' higher first-tier edges settlement was not captured: the formula there is
 * consistent with E14's tier boundaries (src/scaling-edge.ts), not observed. Step 16 anchors the
 * survival closed form on all 2^25 tile subsets.
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate } from './rtp-claim';
import { GRID, binomialBig, exactMultiplierAtEdge } from './exact';
import { loadSettings } from './scaling-edge';

/** The stake tier a row is priced at, keyed by the house_edge the game settings state for it. */
export const tierOf = (houseEdge: string): string => `house_edge=${houseEdge}`;
/** "house_edge=0.0021" → "0.0021". */
export const edgeOfTier = (tier: string): string => {
  const m = /^house_edge=(0\.\d+)$/.exec(tier);
  if (!m) throw new Error(`rtp-settings: ${tier} is not a house_edge tier`);
  return m[1] as string;
};
/** The base tier: every captured bet (effective_edge 0.1). */
const BASE_EDGE = '0.001';

/** "0.0021" → "0.9979": 1 − a decimal edge, exact, as a decimal string. */
function oneMinus(edge: string): string {
  const m = /^0\.(\d+)$/.exec(edge);
  if (!m) throw new Error(`rtp-settings: house_edge ${edge} is not a decimal below 1`);
  const places = (m[1] as string).length;
  const scale = 10n ** BigInt(places);
  const rest = (scale - BigInt(m[1] as string)).toString().padStart(places, '0');
  return `0.${rest}`;
}

/** E14's tier lists, keyed `${m}:${d}`; throws if a body does not match its pin. */
function settingsLists() {
  const load = loadSettings();
  if (!load.ok) throw new Error(`rtp-settings: E14 did not load: ${load.reason}`);
  return load.lists;
}

/** Every house_edge E14 states, ascending, each as a tier held to 1 − that edge. */
function statedTiers(): { tier: string; rtp: string; source: string }[] {
  const edges = new Set<string>();
  for (const tiers of settingsLists().values()) for (const t of tiers) edges.add(t.house_edge);
  if (!edges.has(BASE_EDGE)) throw new Error('rtp-settings: E14 states no 0.1% tier');
  return [...edges].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map(e => ({ tier: tierOf(e), rtp: oneMinus(e), source: `game settings: house_edge ${e} in scaling_edge (E14)` }));
}

export const RTP_CLAIM: RtpClaim = {
  kind: 'tiered',
  tiers: statedTiers(),
  source: 'game settings: the house_edge Duel\'s mines settings state for each stake tier of each (mines, depth) cell (scaling_edge in GET https://duel.com/api/v2/mines/settings?mines=1…24 as fetched 2026-10-05 in a logged-in session, read-only; E14, evidence/settings/); each cell is held to 1 − the edge of the first tier of its list (the tier from a $0 stake): 0.1 % on 294 cells, the edge served on all 6,500 captured bets as effective_edge 0.1 (Step 12); 0.14–0.21 % on the six full-board cash-outs (10–15 mines), which have no 0.1 % tier (MANIFEST.md#rtp-claim; declaration gameModel.edge.claimed 0.001)',
};

/** The scored step that carries the derived half of MINES-19 (src/profile-map.ts). */
export const RTP_CLAIM_STEP = 16;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = '499c4f3dd1167550ae1a66f0b385b88e7191283e4cc001f96de01ff1e596e7c5';

export function computeRtpClaim(): RtpClaimResult {
  const lists = settingsLists();
  const acc = new RtpClaimAccumulator(RTP_CLAIM);
  for (let m = 1; m <= GRID - 1; m++) {
    for (let k = 1; k <= GRID - m; k++) {
      const first = lists.get(`${m}:${k}`)?.[0];
      if (!first) throw new Error(`rtp-settings: E14 has no tier list for mines=${m} depth=${k}`);
      const edge = first.house_edge;
      const pay = exactMultiplierAtEdge(m, k, edge);
      acc.add(`mines=${m} k=${k}`, binomialBig(GRID - m, k) * pay.num, binomialBig(GRID, k) * pay.den,
        edge === BASE_EDGE ? 'first tier 0.1% (E14)' : 'first tier above 0.1% (E14): full-board cash-outs', tierOf(edge));
    }
  }
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'duel/mines', game: 'mines',
    settingSpace: 'mines 1–24 × cash-out after k = 1 … 25 − m reveals (300 cells), each priced at the first stake tier of its list in Duel\'s mines settings (E14, as fetched 2026-10-05 in a logged-in session): 0.1 % on 294 cells, 0.14–0.21 % on the six full-board cash-outs (10–15 mines). Each row carries that tier, keyed by the house_edge E14 states for it. The higher stake tiers are not tabled (E14 holds no multiplier)',
    rtpMethod: 'exact rational: C(25−m,k)/C(25,k) × C(25,k)·(1 − edge)/C(25−m,k), the operator multiplier at the row\'s first-tier edge; settlement captured at edge 0.001 only (the six full-board rows: the formula, consistent with E14\'s tier boundaries, not observed)',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
