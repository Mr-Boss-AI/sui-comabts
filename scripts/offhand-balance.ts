/**
 * Offhand-style balance tuner (v5.3).
 *
 *   $ cd server && SUI_PACKAGE_ID=0x1 ADMIN_CAP_ID=0x1 PLATFORM_TREASURY=0x1 \
 *       SUI_TREASURY_PRIVATE_KEY=dummy npx tsx ../scripts/offhand-balance.ts
 *
 * Three builds with the SAME rarity of gear (from docs/ITEM_DESIGN_GUIDE.md):
 *   shield  — 1-hand weapon + shield        (1 attack, 3 blocks, blocks leak)
 *   dual    — 1-hand weapon + 1-hand weapon (2 attacks, 2 blocks)
 *   twoHand — 2-hand weapon                  (1 attack, 2 blocks, damage mult)
 * Grid-searches OFFHAND_WEAPON_DAMAGE_FACTOR / SHIELD_BLOCK_LEAK /
 * TWO_HAND_DAMAGE_MULT for pairwise win rates closest to 50%, then prints the
 * matchup table for the chosen values (and the values in config.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import { GAME_CONSTANTS } from '../server/src/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createFighterState, resolveTurn, checkFightEnd, generateRandomAction, getOffhandType, judgeByHp } = require('../server/src/game/combat');

const G = GAME_CONSTANTS as any;
const FIGHTS = Number(process.env.FIGHTS ?? 800);
const LEVELS = [3, 8, 12, 18];
const RARITY = process.env.RARITY ?? 'Rare';
const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
  ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null };

// ---- parse the guide tables ----
const guide = fs.readFileSync(path.resolve(__dirname, '../docs/ITEM_DESIGN_GUIDE.md'), 'utf8');
const KEYMAP: Record<string, string> = { HP: 'hp', ARM: 'armor', DEF: 'defense', ATK: 'damage', STR: 'strength', DEX: 'dexterity',
  END: 'endurance', 'CRIT%': 'critBonus', 'EVA%': 'evasion', 'ANTICRIT%': 'antiCrit', 'ANTIEVA%': 'antiEvasion' };
const SLOTMAP: Record<string, string> = { 'Weapon (1-hand)': 'weapon', Shield: 'offhand', Helmet: 'helmet', Chest: 'chest', Gloves: 'gloves',
  Boots: 'boots', Belt: 'belt', Legs: 'pants', Bracers: 'bracelets', Necklace: 'necklace', 'Ring (Strength)': 'ring1',
  'Ring (Endurance)': 'ring2', 'Ring (Dexterity)': 'ring3', 'Weapon (2-hand, no shield)': 'twoHand' };

function parseCell(cell: string, type: number, slotType: number) {
  const bonus: Record<string, number> = {}; let min = 0, max = 0;
  for (const part of cell.replace('⚠️ over budget', '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const d = part.match(/^DMG (\d+)-(\d+)$/);
    if (d) { min = Number(d[1]); max = Number(d[2]); continue; }
    const m = part.match(/^(\S+) \+(\d+)$/);
    if (m && KEYMAP[m[1]]) bonus[KEYMAP[m[1]]] = Number(m[2]);
  }
  return { statBonuses: bonus, minDamage: min, maxDamage: max, itemType: type, slotType };
}

function gear(level: number): Record<string, any> {
  const block = guide.split(`### Level ${level} items`)[1];
  if (!block) throw new Error(`no table for level ${level} in guide`);
  const lines = block.split('\n').filter((l) => l.startsWith('| ')).slice(0);
  const header = lines[0].split('|').map((x) => x.trim()).filter(Boolean);
  const col = header.indexOf(RARITY);
  const out: Record<string, any> = {};
  for (const l of lines.slice(1)) {
    const cells = l.split('|').map((x) => x.trim()).filter((x, i, a) => i > 0 && i < a.length - 1);
    const slot = SLOTMAP[cells[0]];
    if (!slot) continue;
    const type = slot === 'weapon' || slot === 'twoHand' ? 1 : slot === 'offhand' ? 2 : 3;
    const slotType = slot === 'twoHand' ? 2 : slot === 'offhand' ? 1 : 0;
    out[slot] = parseCell(cells[col], type, slotType);
  }
  return out;
}

function baseStats(level: number) {
  const pts = 20 + 3 * (level - 1); const each = Math.floor(pts / 4); const rem = pts - each * 4;
  return { strength: each + (rem > 0 ? 1 : 0), dexterity: each + (rem > 1 ? 1 : 0), intuition: each + (rem > 2 ? 1 : 0), endurance: each };
}

function build(id: string, level: number, style: 'shield' | 'dual' | 'twoHand') {
  const g = gear(level);
  const equipment: any = { ...EMPTY };
  for (const k of Object.keys(EMPTY)) if (g[k]) equipment[k] = g[k];
  if (style === 'dual') equipment.offhand = { ...g.weapon };
  if (style === 'twoHand') { equipment.weapon = g.twoHand; equipment.offhand = null; }
  return { id, walletAddress: id, level, stats: baseStats(level), equipment };
}

function fight(a: any, b: any, n: number): number {
  let score = 0;
  for (let i = 0; i < n; i++) {
    const fa = createFighterState(a, b); const fb = createFighterState(b, a);
    let turn = 0; let end: any = { finished: false };
    while (!end.finished && turn < 60) {
      turn++;
      resolveTurn(turn, fa, fb, generateRandomAction(getOffhandType(a.equipment)), generateRandomAction(getOffhandType(b.equipment)));
      end = checkFightEnd(fa, fb);
    }
    if (!end.finished) { const v = judgeByHp(fa, fb); end = { winner: v.winner, draw: v.draw }; }
    if (end.draw) score += 0.5; else if (end.winner === a.id) score += 1;
  }
  return score / n;
}

const PAIRS: [string, 'shield' | 'dual' | 'twoHand', 'shield' | 'dual' | 'twoHand'][] = [
  ['dual vs shield', 'dual', 'shield'], ['twoHand vs shield', 'twoHand', 'shield'], ['twoHand vs dual', 'twoHand', 'dual'],
];

function score(n: number): { err: number; rates: number[][] } {
  let err = 0; const rates: number[][] = [];
  for (const L of LEVELS) {
    const row: number[] = [];
    for (const [, a, b] of PAIRS) { const r = fight(build('A', L, a), build('B', L, b), n); row.push(r); err += (r - 0.5) ** 2; }
    rates.push(row);
  }
  return { err, rates };
}

type V = { f: number; hit: number; leak: number; mult: number };
const configured: V = { f: G.OFFHAND_WEAPON_DAMAGE_FACTOR, hit: G.DUAL_WIELD_HIT_FACTOR, leak: G.SHIELD_BLOCK_LEAK, mult: G.TWO_HAND_DAMAGE_MULT };
function apply(v: V) { G.OFFHAND_WEAPON_DAMAGE_FACTOR = v.f; G.DUAL_WIELD_HIT_FACTOR = v.hit; G.SHIELD_BLOCK_LEAK = v.leak; G.TWO_HAND_DAMAGE_MULT = v.mult; }
let best: V & { err: number } = { f: 0, hit: 1, leak: 0, mult: 1, err: Infinity };
if (!process.env.REPORT_ONLY) {
  // The offhand weapon's damage must count (design rule), so f >= 0.25.
  for (const f of [0.25, 0.5]) for (const hit of [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) for (const leak of [0, 0.1, 0.2])
    for (const mult of [1.2, 1.4, 1.6, 1.8, 2.0]) {
      apply({ f, hit, leak, mult });
      const { err } = score(FIGHTS);
      if (err < best.err) best = { f, hit, leak, mult, err };
    }
  const b0 = { ...best };
  for (const hit of [b0.hit - 0.025, b0.hit, b0.hit + 0.025]) for (const mult of [b0.mult - 0.1, b0.mult, b0.mult + 0.1]) {
    const v = { f: b0.f, hit: Math.round(hit * 1000) / 1000, leak: b0.leak, mult: Math.round(mult * 100) / 100 };
    apply(v);
    const { err } = score(FIGHTS * 2);
    if (err < best.err) best = { ...v, err };
  }
  console.log(`best: OFFHAND_WEAPON_DAMAGE_FACTOR=${best.f} DUAL_WIELD_HIT_FACTOR=${best.hit} SHIELD_BLOCK_LEAK=${best.leak} TWO_HAND_DAMAGE_MULT=${best.mult}`);
}

function report(label: string, v: V) {
  apply(v);
  const { rates } = score(FIGHTS * 3);
  console.log(`\n${label} (offhand dmg ${v.f}, dual hit ${v.hit}, shield leak ${v.leak}, 2H mult ${v.mult}) — ${RARITY} gear\n| Level | ${PAIRS.map((p) => p[0]).join(' | ')} |\n|---|---|---|---|`);
  LEVELS.forEach((L, i) => console.log(`| ${L} | ${rates[i].map((r) => `${Math.round(r * 100)}%`).join(' | ')} |`));
}
if (!process.env.REPORT_ONLY) report('Best found', best);
report('config.ts values', configured);
