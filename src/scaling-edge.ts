/**
 * SCALING EDGE — Duel's mines settings (evidence E14) and the captured bets held against them.
 *
 * INFORMATIONAL, NOT SCORED. The scored count stays at 26. The two items below are printed in the
 * informational block and emitted under `info` in outputs/verification-results.json, so the
 * reproduction gate holds their text to the committed record. Every figure in them is exact
 * (integers, decimal strings from the files, BigInt rationals tested against a constant bound);
 * no measured float enters a string (see StepResult.data in src/types.ts for why).
 *
 * PROVENANCE. evidence/settings/mines-settings-m01.json … m24.json are the response bodies of
 * GET https://duel.com/api/v2/mines/settings?mines=N, N = 1 … 24: the duel.com config as fetched
 * 2026-10-05 in a logged-in session (read-only GET), 12:16:48–12:18:45 UTC, every response HTTP 200;
 * a logged-out request is not part of E14. Each
 * .meta.json beside its file records the path, status, response headers and fetch time. The bodies
 * are pinned here by SHA-256 and listed in evidence/settings/SHA256SUMS.
 *
 * WHAT IT DOES NOT ESTABLISH: that these settings were in force during the April 2026 capture (no
 * captured bet came near a scaled tier, so the capture cannot tell), or what the server does with a
 * bet whose potential profit at a later tile has no tier (MANIFEST.md DL-6).
 *
 * WHAT IT CHECKS, every run.
 *   1. The 24 bodies hash to their pins, and SHA256SUMS lists the same hash for each.
 *   2. Shape: one tier list per (mines m, depth d), d = 1 … 25 − m (300 lists). Each list starts at
 *      min_bet 0, each tier's min_bet is the previous tier's max_bet (string-equal), the edge rises
 *      by 0.0001 (0.01 %) per tier, and the last tier is 0.01 (1.0 %). The first tier's edge is
 *      reported per list, so a list that does not start at 0.001 is named.
 *   3. The rule the tiers encode: max_bet × (multiplier − 1) = $25,000,000 × edge on every tier,
 *      taking multiplier = C(25,d)/C(25−m,d) × (1 − edge), to relative 1e-12; and on the last tier
 *      that profit is $250,000, to relative 1e-12. E14 holds no multiplier: the formula is the one
 *      served at the 0.1% tier, so this shows it is consistent with the tier boundaries, not what
 *      the server pays at a scaled tier.
 *   4. Every captured bet (6,500 primary + 550 Phase E), at every depth it reached (1 … the number
 *      of revealed tiles, a losing tile included), has its stake inside the 0.001 tier of its
 *      (mines, depth) list, and was served effective_edge 0.1.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { InfoItem, MinesGame } from './types';
import { GRID, binomialBig, parseDecimal } from './exact';

export const SETTINGS_DIR = path.join(__dirname, '..', 'evidence', 'settings');
export const SETTINGS_SOURCE = 'the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET)';

/** SHA-256 of each response body, as fetched (byte-identical to the capture's raw files). */
export const SETTINGS_PINS: Readonly<Record<string, string>> = Object.freeze({
  'mines-settings-m01.json': '48c112fc60b7df87377fcef0c2deb0bbd53ca1007e8ed17fdfd8221b498ee27c',
  'mines-settings-m02.json': 'ea467283a8d46cffe594d5546e84262ee0d63a4e2a1f3fc42c91c2337a7fde1d',
  'mines-settings-m03.json': '6cd5de7daf4fdc12fad7ae8b497b794aa86377cedd9489d451a5f32a1b6c65a0',
  'mines-settings-m04.json': '05fb30a8eb11e3666b62638357af07925f492cb14f593baf3aa516c7d6c44582',
  'mines-settings-m05.json': '45453742a98dc6aef92cc224b03bf2f229c8384c9c2894b66a192c8863b269e8',
  'mines-settings-m06.json': 'd95d0613b11ee0ce005844bc8d116048dcd774a9f278c57badd958968a4eb003',
  'mines-settings-m07.json': '196a38b0a1178c7172cbe032e47530379ad68e8fe0b7d87f6365bafd21a4f157',
  'mines-settings-m08.json': 'cfdcc7585495c04513012a41889df073496fe98f0175a9d2f4a473446f895f06',
  'mines-settings-m09.json': '58f7a0979014d95b6ca00892d3a182ac5da59ecfc49b69561fa167d534b11dd4',
  'mines-settings-m10.json': '762694bb4280af40e49ea0de1ea533073f86b5e7174d22c4284a06fa4fe4868a',
  'mines-settings-m11.json': 'f440d5a24d0e2f0c9d2e330b8111b1384a10c601e65953ebc133876e9627859d',
  'mines-settings-m12.json': '1201b14c1d6e8889fb39a023a16faf3bf358beef70334f3485af842dbd564591',
  'mines-settings-m13.json': '5b39a960564a1098d129a1c9e923eb57669ee681c623bc6dce2629ef3552625d',
  'mines-settings-m14.json': '470dfac37e1fb9a0618fb94854ea46a54dba6dea6a225eceb9ba5d3ae29c9f1b',
  'mines-settings-m15.json': 'de34fc96f49c8cf0ffa4ff51d87d7e96549006a0d49308425ac6c45b2c2bd8fb',
  'mines-settings-m16.json': '388acb2c74c7a3c9a388d62d35f6a139343134e7013e930ee4d99f06c907b82a',
  'mines-settings-m17.json': 'dce46c28afad24a0c62ec419d679a3c70cd38a1c633c07fbc34e4b7de854ec5c',
  'mines-settings-m18.json': '8f5c6f01b0f4693c3c69173a8f578f3de5d9763ba1c671c03318a31c5a9edc18',
  'mines-settings-m19.json': '60eae3cc73c6c6732583566d47d2e890311c13a40b70e65ddb84d08793aaa5ea',
  'mines-settings-m20.json': '998c976a351cf45c2f7b56eb7bdefcee1d9d1b0804ec9cd9ebdc82c9ae5ece52',
  'mines-settings-m21.json': '7c807ad171a55d726a2ec12b0bc7d36b78bd43124939a13fe3b13a8ff1c77628',
  'mines-settings-m22.json': 'ab11bc620d9975a9623aacb8107f3f09e48a2ce1137d1a6cb5891a5c526eafc4',
  'mines-settings-m23.json': 'bbc65ddae64c7276cf2b220caf7829c3c5c7638a386660eb4feeb4a5f7476a33',
  'mines-settings-m24.json': 'a734f090a0eabf94760a39a0a1ba5eb4783326f1029ee82449dc180951cbcc89',
});

const BANKROLL = 25_000_000n;
const MAX_PROFIT = 250_000n;
const REL_BOUND = 10n ** 12n;          // relative 1e-12
const BASE_EDGE = '0.001';
const TOP_EDGE = '0.01';
const EDGE_STEP = { int: 1n, scale: 4 }; // 0.0001

interface Tier { mines: number; depth: number; min_bet: string; max_bet: string; house_edge: string }
type Lists = Map<string, Tier[]>;      // key `${m}:${d}`

const fileFor = (m: number) => `mines-settings-m${String(m).padStart(2, '0')}.json`;
const sha256 = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const pow10 = (n: number) => 10n ** BigInt(n);
/** 27254 → '27,254' without depending on the runtime's locale data. */
const grp = (n: number | bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** a − b for two plain decimals, as { int, scale }. */
function decSub(a: string, b: string): { int: bigint; scale: number } {
  const x = parseDecimal(a), y = parseDecimal(b);
  const s = Math.max(x.scale, y.scale);
  return { int: x.int * pow10(s - x.scale) - y.int * pow10(s - y.scale), scale: s };
}
/** Exact comparison of two plain decimals: −1, 0, 1. */
function decCmp(a: string, b: string): number {
  const d = decSub(a, b);
  return d.int < 0n ? -1 : d.int > 0n ? 1 : 0;
}
/** Round a non-negative rational to cents and print it as $1,234.56 (half-up). */
function dollars(num: bigint, den: bigint): string {
  const cents = (num * 100n * 2n + den) / (den * 2n);
  const whole = grp(cents / 100n);
  return `$${whole}.${(cents % 100n).toString().padStart(2, '0')}`;
}
const pct = (edge: string) => {               // '0.0014' → '0.14%'
  const d = parseDecimal(edge);
  const v = d.int * 100n;                     // value × 100 at the same scale
  const s = d.scale;
  const whole = v / pow10(s), frac = (v % pow10(s)).toString().padStart(s, '0').replace(/0+$/, '');
  return `${whole}${frac ? '.' + frac : ''}%`;
};

/**
 * Profit at stake `bet` on cell (m, d) at edge `edge`: bet × (C(25,d)/C(25−m,d) × (1 − edge) − 1),
 * as an exact rational { num, den }.
 */
function profit(m: number, d: number, bet: string, edge: string): { num: bigint; den: bigint } {
  const b = parseDecimal(bet), e = parseDecimal(edge);
  const top = binomialBig(GRID, d), bot = binomialBig(GRID - m, d);
  const E = pow10(e.scale);
  // paid − 1 = (top·(E − e) − bot·E) / (bot·E)
  return { num: b.int * (top * (E - e.int) - bot * E), den: pow10(b.scale) * bot * E };
}
/** |num/den − target| ≤ target / 1e12 */
const withinRel = (num: bigint, den: bigint, target: bigint) => {
  const diff = num - target * den;
  return (diff < 0n ? -diff : diff) * REL_BOUND <= target * den;
};

export interface SettingsLoad { ok: true; lists: Lists }
export interface SettingsFail { ok: false; reason: string }

/** Read the 24 bodies, check them against their pins and SHA256SUMS, and index the tier lists. */
export function loadSettings(dir = SETTINGS_DIR): SettingsLoad | SettingsFail {
  let sums: Map<string, string>;
  try {
    sums = new Map(fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').split('\n').filter(Boolean)
      .map(l => { const [h, f] = l.split(/\s+/); return [f, h] as [string, string]; }));
  } catch { return { ok: false, reason: 'evidence/settings/SHA256SUMS is missing' }; }
  const lists: Lists = new Map();
  for (let m = 1; m <= GRID - 1; m++) {
    const f = fileFor(m);
    let body: Buffer;
    try { body = fs.readFileSync(path.join(dir, f)); } catch { return { ok: false, reason: `evidence/settings/${f} is missing` }; }
    const h = sha256(body);
    if (h !== SETTINGS_PINS[f]) return { ok: false, reason: `evidence/settings/${f} does not match its pin (sha256 ${h.slice(0, 16)}…)` };
    if (sums.get(f) !== h) return { ok: false, reason: `evidence/settings/SHA256SUMS does not list ${f} at its pinned hash` };
    const se = JSON.parse(body.toString('utf8'))?.data?.scaling_edge;
    if (!se || typeof se !== 'object') return { ok: false, reason: `${f} has no data.scaling_edge` };
    for (const [k, v] of Object.entries(se)) lists.set(`${m}:${k}`, v as Tier[]);
  }
  return { ok: true, lists };
}

export function scalingEdgeInfo(primary: MinesGame[], phaseE: MinesGame[]): InfoItem[] {
  const LABEL_SETTINGS = `Scaling-edge settings, E14: ${SETTINGS_SOURCE}`;
  const LABEL_BETS = 'Captured bets against the E14 0.1% tier';
  const load = loadSettings();
  if (!load.ok) {
    return [
      { label: LABEL_SETTINGS, detail: `not checked: ${load.reason}` },
      { label: LABEL_BETS, detail: 'not checked: the settings did not load' },
    ];
  }
  const { lists } = load;

  // ── 2–3. Shape and rule ────────────────────────────────────────────────────
  let nLists = 0, nTiers = 0, contiguous = 0, stepped = 0, topped = 0, ruleTiers = 0, capped = 0, labelled = 0;
  const floors = new Map<string, string[]>();   // first edge → cells
  let extraKeys = 0;
  for (let m = 1; m <= GRID - 1; m++) {
    for (let d = 1; d <= GRID - m; d++) {
      const L = lists.get(`${m}:${d}`);
      if (!L || !L.length) continue;
      nLists++; nTiers += L.length;
      if (L.every(t => t.mines === m && t.depth === d)) labelled++;
      let cont = decCmp(L[0].min_bet, '0') === 0, step = true;
      for (let i = 1; i < L.length; i++) {
        if (L[i].min_bet !== L[i - 1].max_bet) cont = false;
        const s = decSub(L[i].house_edge, L[i - 1].house_edge);
        if (s.int * pow10(EDGE_STEP.scale) !== EDGE_STEP.int * pow10(s.scale)) step = false;
      }
      if (cont) contiguous++;
      if (step) stepped++;
      const last = L[L.length - 1];
      if (decCmp(last.house_edge, TOP_EDGE) === 0) topped++;
      for (const t of L) {
        const p = profit(m, d, t.max_bet, t.house_edge), e = parseDecimal(t.house_edge);
        // profit / edge = $25m  ⇔  profit · 10^es / e.int = 25m
        if (withinRel(p.num * pow10(e.scale), p.den * e.int, BANKROLL)) ruleTiers++;
      }
      const pl = profit(m, d, last.max_bet, last.house_edge);
      if (withinRel(pl.num, pl.den, MAX_PROFIT)) capped++;
      const f = L[0].house_edge;
      floors.set(f, [...(floors.get(f) ?? []), `m=${m} d=${d}`]);
    }
  }
  extraKeys = lists.size - nLists;
  const atBase = [...floors].filter(([f]) => decCmp(f, BASE_EDGE) === 0).reduce((n, [, c]) => n + c.length, 0);
  const others = [...floors].filter(([f]) => decCmp(f, BASE_EDGE) !== 0)
    .flatMap(([f, cells]) => cells.map(c => `${c} ${pct(f)}`))
    .sort((a, b) => {
      const ma = Number(/m=(\d+)/.exec(a)![1]), mb = Number(/m=(\d+)/.exec(b)![1]);
      return ma - mb;
    });
  const settingsDetail =
    `24/24 bodies match their SHA-256 pins and evidence/settings/SHA256SUMS; `
    + `${nLists} tier lists for the 300 (mines 1–24, depth 1 … 25 − m) cells${extraKeys ? ` plus ${extraKeys} other keys` : ''}, `
    + `${grp(nTiers)} tiers; every tier carries its own list's mines and depth on ${labelled}; `
    + `contiguous (first min_bet 0, each min_bet = the previous max_bet) on ${contiguous}; `
    + `edge +0.01% per tier on ${stepped}; last tier 1.0% on ${topped}; `
    + `first tier 0.1% on ${atBase}${others.length ? `, higher on ${others.length} (${others.join(', ')})` : ''}; `
    + `max_bet × (C(25,d)/C(25−m,d) × (1 − edge) − 1) = $25,000,000 × edge on ${grp(ruleTiers)} of ${grp(nTiers)} tiers `
    + `and the last tier's profit = $250,000 on ${capped} of ${nLists} lists (relative 1e-12)`;

  // ── 4. The captured bets ───────────────────────────────────────────────────
  let pairs = 0, inside = 0, outside = 0, ee = 0;
  const cells = new Set<string>();
  // closest approach: max stake / base-tier limit, compared exactly by cross-multiplication
  let close: { bet: string; lim: string; m: number; d: number } | null = null;
  let best: { num: bigint; den: bigint; m: number; d: number; bet: string } | null = null;
  const all = [...primary, ...phaseE];
  for (const b of all) {
    if (b.response.effective_edge === 0.1) ee++;
    const m = b.request.mines_count, bet = b.request.amount;
    const depth = b.response.revealed_positions.length;
    for (let d = 1; d <= depth; d++) {
      pairs++; cells.add(`${m}:${d}`);
      const base = (lists.get(`${m}:${d}`) ?? []).find(t => decCmp(t.house_edge, BASE_EDGE) === 0);
      if (base && decCmp(bet, base.min_bet) >= 0 && decCmp(bet, base.max_bet) <= 0) inside++; else outside++;
      if (base) {
        const r = parseDecimal(bet), l = parseDecimal(base.max_bet);
        // bet/lim > close.bet/close.lim ?
        if (!close) close = { bet, lim: base.max_bet, m, d };
        else {
          const c = parseDecimal(close.bet), cl = parseDecimal(close.lim);
          const lhs = r.int * cl.int * pow10(l.scale + c.scale);
          const rhs = c.int * l.int * pow10(cl.scale + r.scale);
          if (lhs > rhs) close = { bet, lim: base.max_bet, m, d };
        }
      }
      const p = profit(m, d, bet, BASE_EDGE);
      if (!best || p.num * best.den > best.num * p.den) best = { ...p, m, d, bet };
    }
  }
  const usd = (s: string) => { const x = parseDecimal(s); return dollars(x.int, pow10(x.scale)); };
  const betsDetail =
    `${grp(all.length)} bets (${grp(primary.length)} primary + ${phaseE.length} Phase E), `
    + `${grp(pairs)} (bet, depth) pairs over ${cells.size} (mines, depth) cells: `
    + `${grp(inside)} inside the 0.1% tier, ${outside} outside; `
    + `effective_edge 0.1 served on ${grp(ee)} of ${grp(all.length)}`
    + (close ? `; closest to the tier limit: ${usd(close.bet)} against ${usd(close.lim)} (${close.m} mines, depth ${close.d})` : '')
    + (best ? `; largest potential profit at the 0.1% edge ${dollars(best.num, best.den)} (${best.m} mines, depth ${best.d}, ${usd(best.bet)} stake)` : '');

  return [
    { label: LABEL_SETTINGS, detail: settingsDetail },
    { label: LABEL_BETS, detail: betsDetail },
  ];
}
