/**
 * Item catalog generator + validator (v5.3 — no rarity tiers).
 *
 *   $ cd server && SUI_PACKAGE_ID=0x1 ADMIN_CAP_ID=0x1 PLATFORM_TREASURY=0x1 \
 *       SUI_TREASURY_PRIVATE_KEY=dummy npx tsx ../scripts/item-catalog.ts > /tmp/catalog.md
 *
 * Items have only a level and stats. Every slot has build variants (STR /
 * DEX / INT / END flavours, heavy vs light armour, …) of EQUAL power, so
 * players choose a build, not a tier. This script:
 *   1. measures what one point of each stat is worth per level (real engine),
 *   2. prints recommended stats per variant per level,
 *   3. checks every item against the on-chain limits (item.move
 *      flat_power / chance_points), and
 *   4. simulates full build-themed gear sets against each other.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createFighterState, resolveTurn, checkFightEnd, generateRandomAction, getOffhandType, judgeByHp } = require('../server/src/game/combat');

const FIGHTS = Number(process.env.FIGHTS ?? 1500);
const SET_EDGES = Number(process.env.SET_EDGES ?? 8);  // power of a full 13-slot set, in edge units
const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20];
const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
  ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null };

type Key = 'hp' | 'armor' | 'defense' | 'damage' | 'weaponAvg' | 'strength' | 'dexterity' | 'intuition' | 'endurance'
  | 'critBonus' | 'critMultiplier' | 'evasion' | 'antiCrit' | 'antiEvasion';
const MEASURED: Key[] = ['hp', 'armor', 'defense', 'damage', 'weaponAvg', 'strength', 'dexterity', 'intuition', 'endurance', 'critBonus', 'evasion'];

// ---- on-chain limits (mirror of item.move) ----
const W: Partial<Record<Key, number>> = { hp: 1, armor: 7, defense: 7, damage: 7, strength: 5, dexterity: 3, endurance: 7 };
const W_MAX_DAMAGE = 6;
const maxFlatPower = (L: number) => Math.floor((477 * L * L + 4620 * L + 10800) / 1000);
const MAX_CHANCE = 20;
const HAND_MIN_LEVEL = 3;

// ---- slots + build variants (share of set power, stat mix) ----
type Variant = { name: string; mix: Partial<Record<Key, number>> };
type Slot = { slot: string; chain: string; type: number; slotType: number; share: number; variants: Variant[] };
const SLOTS: Slot[] = [
  { slot: 'Weapon (1-hand)', chain: 'weapon', type: 1, slotType: 0, share: 0.22, variants: [
    { name: 'Sword — STR', mix: { weaponAvg: 0.75, strength: 0.25 } },
    { name: 'Dagger — DEX', mix: { weaponAvg: 0.7, dexterity: 0.3 } },
    { name: 'Rune blade — INT', mix: { weaponAvg: 0.7, intuition: 0.3 } },
    { name: 'Mace — END', mix: { weaponAvg: 0.7, endurance: 0.3 } },
  ] },
  { slot: 'Weapon (2-hand)', chain: 'weapon', type: 1, slotType: 2, share: 0.32, variants: [
    { name: 'Greatsword — STR', mix: { weaponAvg: 0.8, strength: 0.2 } },
    { name: 'War staff — INT', mix: { weaponAvg: 0.65, intuition: 0.35 } },
  ] },
  { slot: 'Shield', chain: 'offhand', type: 2, slotType: 1, share: 0.10, variants: [
    { name: 'Heater shield', mix: { armor: 0.5, defense: 0.3, hp: 0.2 } },
  ] },
  { slot: 'Helmet', chain: 'helmet', type: 3, slotType: 0, share: 0.08, variants: [
    { name: 'Helm — heavy', mix: { armor: 0.5, hp: 0.5 } },
    { name: 'Hood — light', mix: { evasion: 0.5, hp: 0.5 } },
    { name: 'Circlet — mystic', mix: { intuition: 0.5, hp: 0.5 } },
  ] },
  { slot: 'Chest', chain: 'chest', type: 4, slotType: 0, share: 0.14, variants: [
    { name: 'Plate / mail — heavy', mix: { armor: 0.6, hp: 0.4 } },
    { name: 'Leather — light', mix: { evasion: 0.35, dexterity: 0.35, hp: 0.3 } },
    { name: 'Robe — mystic', mix: { intuition: 0.5, hp: 0.5 } },
  ] },
  { slot: 'Gloves', chain: 'gloves', type: 5, slotType: 0, share: 0.06, variants: [
    { name: 'Gauntlets — striker', mix: { damage: 0.6, critBonus: 0.4 } },
    { name: 'Grips — precise', mix: { antiEvasion: 0.5, dexterity: 0.5 } },
  ] },
  { slot: 'Boots', chain: 'boots', type: 6, slotType: 0, share: 0.06, variants: [
    { name: 'Greaves — heavy', mix: { armor: 0.5, hp: 0.5 } },
    { name: 'Soft boots — light', mix: { evasion: 0.6, dexterity: 0.4 } },
  ] },
  { slot: 'Belt', chain: 'belt', type: 7, slotType: 0, share: 0.05, variants: [
    { name: 'Girdle', mix: { endurance: 0.6, hp: 0.4 } },
  ] },
  { slot: 'Legs', chain: 'pants', type: 10, slotType: 0, share: 0.08, variants: [
    { name: 'Chausses — heavy', mix: { armor: 0.5, hp: 0.5 } },
    { name: 'Breeches — light', mix: { evasion: 0.5, hp: 0.5 } },
  ] },
  { slot: 'Bracers', chain: 'bracelets', type: 11, slotType: 0, share: 0.05, variants: [
    { name: 'Vambraces — STR', mix: { defense: 0.5, strength: 0.5 } },
    { name: 'Wraps — INT', mix: { critBonus: 0.5, intuition: 0.5 } },
  ] },
  { slot: 'Necklace', chain: 'necklace', type: 9, slotType: 0, share: 0.05, variants: [
    { name: 'Amulet — crit', mix: { critBonus: 0.5, antiCrit: 0.5 } },
    { name: 'Talisman — dodge', mix: { evasion: 0.5, antiEvasion: 0.5 } },
  ] },
  { slot: 'Ring', chain: 'ring1', type: 8, slotType: 0, share: 0.037, variants: [
    { name: 'Ring of Strength', mix: { strength: 1 } },
    { name: 'Ring of Dexterity', mix: { dexterity: 1 } },
    { name: 'Ring of Intuition', mix: { intuition: 1 } },
    { name: 'Ring of Endurance', mix: { endurance: 1 } },
  ] },
  { slot: 'Earrings (needs 14th slot)', chain: 'earrings', type: 0, slotType: 0, share: 0.03, variants: [
    { name: 'Earrings', mix: { evasion: 0.5, antiEvasion: 0.5 } },
  ] },
];

function baseStats(level: number) {
  const pts = 20 + 3 * (level - 1); const each = Math.floor(pts / 4); const rem = pts - each * 4;
  return { strength: each + (rem > 0 ? 1 : 0), dexterity: each + (rem > 1 ? 1 : 0), intuition: each + (rem > 2 ? 1 : 0), endurance: each };
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

// ---- 1. edge units ----
function probe(id: string, L: number, k: Key, x: number) {
  const equipment: any = { ...EMPTY };
  if (k === 'weaponAvg') equipment.weapon = { statBonuses: {}, minDamage: x, maxDamage: x, itemType: 1, slotType: 0 };
  else equipment.ring1 = { statBonuses: { [k]: x }, minDamage: 0, maxDamage: 0, itemType: 8 };
  return { id, walletAddress: id, level: L, stats: baseStats(L), equipment };
}
function edge(L: number, k: Key): number {
  const base = probe('B', L, 'hp', 0);
  const rate = (x: number) => fight(probe('A', L, k, x), base, FIGHTS);
  let lo = 0, hi = 1;
  while (rate(hi) < 0.6) hi *= 2;
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (rate(m) < 0.6) lo = m; else hi = m; }
  return hi;
}
const edges: Record<number, Record<Key, number>> = {};
for (let L = 1; L <= 20; L++) { edges[L] = {} as any; for (const k of MEASURED) edges[L][k] = edge(L, k); process.stderr.write(`edges L${L}\n`); }
for (const k of MEASURED) {
  const raw = Array.from({ length: 21 }, (_, L) => (L ? edges[L][k] : 0));
  for (let L = 1; L <= 20; L++) { const nb = [raw[L - 1], raw[L], raw[L + 1]].filter((v) => v); edges[L][k] = nb.reduce((a, v) => a + v, 0) / nb.length; }
}
for (let L = 1; L <= 20; L++) {
  edges[L].antiCrit = edges[L].critBonus;
  edges[L].antiEvasion = edges[L].evasion;
  edges[L].critMultiplier = edges[L].critBonus * 8;
}

// ---- 2. build items ----
type Built = { bonus: Partial<Record<Key, number>>; min: number; max: number; flat: number; chance: number };
function build(s: Slot, v: Variant, L: number): Built | null {
  if ((s.type === 1 || s.type === 2) && L < HAND_MIN_LEVEL) return null;
  let power = SET_EDGES * s.share;
  for (let attempt = 0; attempt < 20; attempt++) {
    const bonus: Partial<Record<Key, number>> = {}; let min = 0, max = 0;
    for (const [k, f] of Object.entries(v.mix) as [Key, number][]) {
      const raw = power * f * edges[L][k];
      if (k === 'weaponAvg') { const avg = Math.max(1, raw); min = Math.max(1, Math.round(avg * 0.7)); max = Math.max(min, Math.round(avg * 1.3)); }
      else { const r = Math.round(raw); if (r > 0) bonus[k] = r; }
    }
    if (Object.keys(bonus).length === 0 && max === 0) bonus.hp = Math.max(1, Math.round(power * edges[L].hp));
    const flat = Object.entries(bonus).reduce((a, [k, x]) => a + (W[k as Key] ?? 0) * (x ?? 0), 0) + W_MAX_DAMAGE * max;
    const chance = 2 * (bonus.intuition ?? 0) + (bonus.critBonus ?? 0) + (bonus.evasion ?? 0) + (bonus.antiCrit ?? 0)
      + (bonus.antiEvasion ?? 0) + Math.floor((bonus.critMultiplier ?? 0) / 10);
    if (flat <= maxFlatPower(L) && chance <= MAX_CHANCE) return { bonus, min, max, flat, chance };
    power *= 0.93;  // shrink until it fits the chain limits
  }
  throw new Error(`cannot fit ${s.slot}/${v.name} at L${L}`);
}

const LABEL: Record<Key, string> = { hp: 'HP', armor: 'ARM', defense: 'DEF', damage: 'ATK', weaponAvg: 'DMG', strength: 'STR', dexterity: 'DEX',
  intuition: 'INT', endurance: 'END', critBonus: 'CRIT%', critMultiplier: 'CRITDMG', evasion: 'EVA%', antiCrit: 'ANTICRIT%', antiEvasion: 'ANTIEVA%' };
const fmt = (b: Built | null) => !b ? '—' : [b.max ? `DMG ${b.min}-${b.max}` : '', ...Object.entries(b.bonus).map(([k, v]) => `${LABEL[k as Key]} +${v}`)].filter(Boolean).join(', ');

// ---- 3. build-themed full sets ----
const THEMES: Record<string, Record<string, string>> = {
  STR: { weapon: 'Sword — STR', helmet: 'Helm — heavy', chest: 'Plate / mail — heavy', gloves: 'Gauntlets — striker', boots: 'Greaves — heavy', pants: 'Chausses — heavy', bracelets: 'Vambraces — STR', necklace: 'Amulet — crit', ring: 'Ring of Strength' },
  DEX: { weapon: 'Dagger — DEX', helmet: 'Hood — light', chest: 'Leather — light', gloves: 'Grips — precise', boots: 'Soft boots — light', pants: 'Breeches — light', bracelets: 'Vambraces — STR', necklace: 'Talisman — dodge', ring: 'Ring of Dexterity' },
  INT: { weapon: 'Rune blade — INT', helmet: 'Circlet — mystic', chest: 'Robe — mystic', gloves: 'Gauntlets — striker', boots: 'Soft boots — light', pants: 'Breeches — light', bracelets: 'Wraps — INT', necklace: 'Amulet — crit', ring: 'Ring of Intuition' },
  END: { weapon: 'Mace — END', helmet: 'Helm — heavy', chest: 'Plate / mail — heavy', gloves: 'Gauntlets — striker', boots: 'Greaves — heavy', pants: 'Chausses — heavy', bracelets: 'Vambraces — STR', necklace: 'Amulet — crit', ring: 'Ring of Endurance' },
};
const STAT_KEY: Record<string, string> = { STR: 'strength', DEX: 'dexterity', INT: 'intuition', END: 'endurance' };
function themedChar(id: string, L: number, theme: string) {
  const pts = 20 + 3 * (L - 1); const main = Math.round(pts * 0.4); const rest = pts - main; const each = Math.floor(rest / 3); let extra = rest - each * 3;
  const stats: any = {};
  for (const k of ['strength', 'dexterity', 'intuition', 'endurance']) { if (k === STAT_KEY[theme]) stats[k] = main; else { stats[k] = each + (extra > 0 ? 1 : 0); extra--; } }
  const equipment: any = { ...EMPTY };
  const pick = (slotName: string, vName: string) => { const s = SLOTS.find((x) => x.slot === slotName)!; return build(s, s.variants.find((v) => v.name === vName)!, L); };
  const put = (chain: string, b: Built | null, type: number, slotType = 0) => { if (b) equipment[chain] = { statBonuses: b.bonus, minDamage: b.min, maxDamage: b.max, itemType: type, slotType }; };
  const t = THEMES[theme];
  put('weapon', pick('Weapon (1-hand)', t.weapon), 1);
  put('offhand', pick('Shield', 'Heater shield'), 2, 1);
  put('helmet', pick('Helmet', t.helmet), 3); put('chest', pick('Chest', t.chest), 4); put('gloves', pick('Gloves', t.gloves), 5);
  put('boots', pick('Boots', t.boots), 6); put('belt', pick('Belt', 'Girdle'), 7); put('pants', pick('Legs', t.pants), 10);
  put('bracelets', pick('Bracers', t.bracelets), 11); put('necklace', pick('Necklace', t.necklace), 9);
  for (const r of ['ring1', 'ring2', 'ring3']) put(r, pick('Ring', t.ring), 8);
  return { id, walletAddress: id, level: L, stats, equipment };
}

// ---- optional: tune global combat constants against geared build matchups ----
if (process.env.TUNE_GEAR) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const G = require('../server/src/config').GAME_CONSTANTS as any;
  const themesT = Object.keys(THEMES);
  const score = (n: number) => {
    const avg: Record<string, number> = {}; themesT.forEach((t) => (avg[t] = 0));
    for (const L of [6, 12, 18]) for (let i = 0; i < themesT.length; i++) for (let j = i + 1; j < themesT.length; j++) {
      const r = fight(themedChar('A', L, themesT[i]), themedChar('B', L, themesT[j]), n);
      avg[themesT[i]] += r; avg[themesT[j]] += 1 - r;
    }
    themesT.forEach((t) => (avg[t] /= 3 * (themesT.length - 1)));
    return { avg, err: themesT.reduce((e, t) => e + (avg[t] - 0.5) ** 2, 0) };
  };
  let best: any = { err: Infinity };
  for (const cap of [30, 35, 40, 45]) for (const pen of [0.5, 0.35, 0.2]) for (const pierce of [0.2, 0.15, 0.1]) {
    G.EVASION_CAP = cap; G.CRIT_ARMOR_PEN = pen; G.CRIT_BLOCK_PIERCE = pierce;
    const r = score(FIGHTS);
    if (r.err < best.err) best = { cap, pen, pierce, ...r };
  }
  console.log(`best gear: EVASION_CAP=${best.cap} CRIT_ARMOR_PEN=${best.pen} CRIT_BLOCK_PIERCE=${best.pierce} avg=${JSON.stringify(Object.fromEntries(Object.entries(best.avg).map(([k, v]) => [k, Math.round((v as number) * 100)])))}`);
  process.exit(0);
}

// ---- output ----
const out: string[] = [];
const halves = [LEVELS.slice(0, 7), LEVELS.slice(7)];
let worstFlat = 0, worstChance = 0;
for (const s of SLOTS) {
  out.push(`\n### ${s.slot}\n`);
  for (const lv of halves) {
    out.push(`| Variant | ${lv.map((L) => `Lv${L}`).join(' | ')} |`);
    out.push(`|---|${lv.map(() => '---').join('|')}|`);
    for (const v of s.variants) {
      out.push(`| ${v.name} | ${lv.map((L) => { const b = build(s, v, L); if (b) { worstFlat = Math.max(worstFlat, b.flat / maxFlatPower(L)); worstChance = Math.max(worstChance, b.chance / MAX_CHANCE); } return fmt(b); }).join(' | ')} |`);
    }
    out.push('');
  }
}

const themes = Object.keys(THEMES);
const val: string[] = [`| Level | ${themes.flatMap((a, i) => themes.slice(i + 1).map((b) => `${a} vs ${b}`)).join(' | ')} |`, `|---|${themes.flatMap((a, i) => themes.slice(i + 1).map(() => '---')).join('|')}|`];
for (const L of [3, 6, 10, 15, 20]) {
  const cells: string[] = [];
  for (let i = 0; i < themes.length; i++) for (let j = i + 1; j < themes.length; j++)
    cells.push(`${Math.round(fight(themedChar('A', L, themes[i]), themedChar('B', L, themes[j]), FIGHTS) * 100)}%`);
  val.push(`| ${L} | ${cells.join(' | ')} |`);
  process.stderr.write(`validated L${L}\n`);
}
const lvl: string[] = ['| Level | full set vs no gear | full set vs set 2 levels lower (same level fighters) |', '|---|---|---|'];
for (const L of [3, 6, 10, 15, 20]) {
  const naked = { ...themedChar('B', L, 'STR'), equipment: { ...EMPTY } };
  const lower = themedChar('B', Math.max(1, L - 2), 'STR'); const lowerSameLevel = { ...lower, level: L, stats: themedChar('B', L, 'STR').stats };
  lvl.push(`| ${L} | ${Math.round(fight(themedChar('A', L, 'STR'), naked, FIGHTS) * 100)}% | ${Math.round(fight(themedChar('A', L, 'STR'), lowerSameLevel, FIGHTS) * 100)}% |`);
}

console.log('<!-- BUILDS -->'); console.log(val.join('\n'));
console.log('<!-- LEVELS -->'); console.log(lvl.join('\n'));
console.log(`<!-- LIMITS worstFlat=${Math.round(worstFlat * 100)}% worstChance=${Math.round(worstChance * 100)}% -->`);
console.log('<!-- TABLES -->'); console.log(out.join('\n'));
