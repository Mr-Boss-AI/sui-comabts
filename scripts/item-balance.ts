/**
 * Item stat recommender + validator (v5.3). Generates the tables in
 * docs/ITEM_DESIGN_GUIDE.md.
 *
 *   $ cd server && SUI_PACKAGE_ID=0x1 ADMIN_CAP_ID=0x1 PLATFORM_TREASURY=0x1 \
 *       SUI_TREASURY_PRIVATE_KEY=dummy npx tsx ../scripts/item-balance.ts > /tmp/items.md
 *
 * 1. Measures an "edge unit" per stat per level with the real combat engine
 *    (amount of one stat that turns a 50/50 mirror match into 60/40).
 * 2. Gives every slot a stat recipe and every rarity a set power, converts
 *    that power into whole stat points at each level.
 * 3. Checks every item against the on-chain rarity budget (item.move) and
 *    simulates full sets: naked vs Common, Common vs Uncommon, … so each
 *    rarity step is a clear but not hopeless upgrade.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createFighterState, resolveTurn, checkFightEnd, generateRandomAction, getOffhandType, judgeByHp } = require('../server/src/game/combat');

const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
  ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null };
const FIGHTS = Number(process.env.FIGHTS ?? 1500);
const TABLE_LEVELS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 20];

// Contract budgets (contracts/sources/item.move) — sum of all *_bonus + max_damage.
const RARITIES = [
  { name: 'Common', id: 1, budget: 20, setEdges: 5.0 },
  { name: 'Uncommon', id: 2, budget: 40, setEdges: 6.5 },
  { name: 'Rare', id: 3, budget: 70, setEdges: 8.2 },
  { name: 'Epic', id: 4, budget: 110, setEdges: 10.2 },
  { name: 'Legendary', id: 5, budget: 160, setEdges: 12.8 },
];

// Stat keys follow the server StatBonuses shape; weaponAvg is the weapon's
// (min+max)/2. Counter stats are priced off the stat they counter.
type Key = 'hp' | 'armor' | 'defense' | 'damage' | 'weaponAvg' | 'strength' | 'dexterity' | 'intuition' | 'endurance'
  | 'critBonus' | 'critMultiplier' | 'evasion' | 'antiCrit' | 'antiEvasion';
const MEASURED: Key[] = ['hp', 'armor', 'defense', 'damage', 'weaponAvg', 'strength', 'dexterity', 'endurance', 'critBonus', 'evasion'];

// Slot recipes: share of the set's power + stat mix (fractions sum to 1).
const SLOTS: { slot: string; chain: string; type: number; slotType: number; share: number; mix: Partial<Record<Key, number>> }[] = [
  { slot: 'Weapon (1-hand)', chain: 'weapon', type: 1, slotType: 0, share: 0.22, mix: { weaponAvg: 0.75, strength: 0.25 } },
  { slot: 'Shield', chain: 'offhand', type: 2, slotType: 1, share: 0.10, mix: { armor: 0.5, defense: 0.3, hp: 0.2 } },
  { slot: 'Helmet', chain: 'helmet', type: 3, slotType: 0, share: 0.08, mix: { armor: 0.5, hp: 0.5 } },
  { slot: 'Chest', chain: 'chest', type: 4, slotType: 0, share: 0.14, mix: { armor: 0.6, hp: 0.4 } },
  { slot: 'Gloves', chain: 'gloves', type: 5, slotType: 0, share: 0.06, mix: { damage: 0.6, critBonus: 0.4 } },
  { slot: 'Boots', chain: 'boots', type: 6, slotType: 0, share: 0.06, mix: { armor: 0.5, evasion: 0.5 } },
  { slot: 'Belt', chain: 'belt', type: 7, slotType: 0, share: 0.05, mix: { endurance: 0.6, hp: 0.4 } },
  { slot: 'Legs', chain: 'pants', type: 10, slotType: 0, share: 0.08, mix: { armor: 0.5, hp: 0.5 } },
  { slot: 'Bracers', chain: 'bracelets', type: 11, slotType: 0, share: 0.05, mix: { defense: 0.5, strength: 0.5 } },
  { slot: 'Necklace', chain: 'necklace', type: 9, slotType: 0, share: 0.05, mix: { critBonus: 0.5, antiCrit: 0.5 } },
  { slot: 'Ring (Strength)', chain: 'ring1', type: 8, slotType: 0, share: 0.037, mix: { strength: 1 } },
  { slot: 'Ring (Endurance)', chain: 'ring2', type: 8, slotType: 0, share: 0.037, mix: { endurance: 1 } },
  { slot: 'Ring (Dexterity)', chain: 'ring3', type: 8, slotType: 0, share: 0.036, mix: { dexterity: 1 } },
];

function baseStats(level: number) {
  const pts = 20 + 3 * (level - 1);
  const each = Math.floor(pts / 4); const rem = pts - each * 4;
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

function probeChar(id: string, level: number, key: Key, x: number) {
  const equipment: any = { ...EMPTY };
  if (key === 'weaponAvg') equipment.weapon = { statBonuses: {}, minDamage: x, maxDamage: x, itemType: 1, slotType: 0 };
  else equipment.ring1 = { statBonuses: { [key]: x }, minDamage: 0, maxDamage: 0, itemType: 8 };
  return { id, walletAddress: id, level, stats: baseStats(level), equipment };
}

function edge(level: number, key: Key): number {
  const base = probeChar('B', level, 'hp', 0);
  const rate = (x: number) => fight(probeChar('A', level, key, x), base, FIGHTS);
  let lo = 0, hi = 1;
  while (rate(hi) < 0.6) hi *= 2;
  for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (rate(m) < 0.6) lo = m; else hi = m; }
  return hi;
}

// ---- 1. edge table (smoothed across levels) ----
const edges: Record<number, Record<Key, number>> = {};
for (let L = 1; L <= 20; L++) {
  edges[L] = {} as any;
  for (const k of MEASURED) edges[L][k] = edge(L, k);
  process.stderr.write(`edges L${L}\n`);
}
for (const k of MEASURED) {  // 3-point smoothing to remove simulation noise
  const raw = Array.from({ length: 21 }, (_, L) => (L ? edges[L][k] : 0));
  for (let L = 1; L <= 20; L++) {
    const nb = [raw[L - 1], raw[L], raw[L + 1]].filter((v) => v);
    edges[L][k] = nb.reduce((s, v) => s + v, 0) / nb.length;
  }
}
for (let L = 1; L <= 20; L++) {
  // counter stats priced 1:1 against what they counter; crit damage in
  // hundredths ≈ 4x the crit-chance edge (crit dmg only pays when you crit).
  edges[L].intuition = edges[L].strength * 12;  // INT measured ~12-15x weaker than STR (see guide §4)
  edges[L].antiCrit = edges[L].critBonus;
  edges[L].antiEvasion = edges[L].evasion;
  edges[L].critMultiplier = edges[L].critBonus * 4;
}

// ---- 2. build items ----
type Built = { slot: string; chain: string; type: number; slotType: number; bonus: Partial<Record<Key, number>>; min: number; max: number; budgetUsed: number };
function buildItem(s: typeof SLOTS[number], level: number, rarity: typeof RARITIES[number]): Built {
  const power = rarity.setEdges * s.share;              // edge units for this item
  const bonus: Partial<Record<Key, number>> = {};
  let min = 0, max = 0;
  for (const [k, f] of Object.entries(s.mix) as [Key, number][]) {
    const raw = power * f * edges[level][k];
    if (k === 'weaponAvg') {
      const avg = Math.max(1, raw);
      min = Math.max(1, Math.round(avg * 0.7)); max = Math.max(min, Math.round(avg * 1.3));
    } else {
      const v = Math.round(raw);
      if (v > 0) bonus[k] = v;
    }
  }
  // Guarantee every item does *something*: if rounding erased it, give +HP.
  if (Object.keys(bonus).length === 0 && max === 0) bonus.hp = Math.max(1, Math.round(power * edges[level].hp));
  let budgetUsed = Object.values(bonus).reduce((a, b) => a + (b ?? 0), 0) + max;
  // The chain budget counts raw points; HP is the cheapest stat per point,
  // so trim HP first when a recipe overshoots the rarity budget.
  if (budgetUsed > rarity.budget && bonus.hp) {
    const cut = Math.min(bonus.hp, budgetUsed - rarity.budget);
    bonus.hp -= cut; budgetUsed -= cut;
    if (bonus.hp === 0) delete bonus.hp;
  }
  return { slot: s.slot, chain: s.chain, type: s.type, slotType: s.slotType, bonus, min, max, budgetUsed };
}

// Extra rows for the design tables (not part of the validated default set).
const EXTRA_SLOTS: typeof SLOTS = [
  { slot: 'Weapon (2-hand, no shield)', chain: 'weapon', type: 1, slotType: 2, share: 0.32, mix: { weaponAvg: 0.8, strength: 0.2 } },
  { slot: 'Offhand weapon (dual-wield)', chain: 'offhand', type: 1, slotType: 0, share: 0.10, mix: { damage: 0.5, critBonus: 0.5 } },
  { slot: 'Earrings (needs 14th slot)', chain: 'earrings', type: 0, slotType: 0, share: 0.03, mix: { evasion: 0.5, antiEvasion: 0.5 } },
];

const LABEL: Record<Key, string> = { hp: 'HP', armor: 'ARM', defense: 'DEF', damage: 'ATK', weaponAvg: 'DMG', strength: 'STR', dexterity: 'DEX',
  intuition: 'INT', endurance: 'END', critBonus: 'CRIT%', critMultiplier: 'CRITDMG', evasion: 'EVA%', antiCrit: 'ANTICRIT%', antiEvasion: 'ANTIEVA%' };
function fmt(b: Built): string {
  const parts: string[] = [];
  if (b.max) parts.push(`DMG ${b.min}-${b.max}`);
  for (const [k, v] of Object.entries(b.bonus)) parts.push(`${LABEL[k as Key]} +${v}`);
  return parts.join(', ');
}

function setChar(id: string, level: number, rarity: typeof RARITIES[number] | null) {
  const equipment: any = { ...EMPTY };
  if (rarity) for (const s of SLOTS) {
    const b = buildItem(s, level, rarity);
    equipment[s.chain] = { statBonuses: b.bonus, minDamage: b.min, maxDamage: b.max, itemType: b.type, slotType: b.slotType };
  }
  return { id, walletAddress: id, level, stats: baseStats(level), equipment };
}

// ---- 3. output ----
const out: string[] = [];
let overBudget = 0;
for (const L of TABLE_LEVELS) {
  out.push(`\n### Level ${L} items (level_req = ${L})\n`);
  out.push(`| Slot | ${RARITIES.map((r) => r.name).join(' | ')} |`);
  out.push(`|---|${RARITIES.map(() => '---').join('|')}|`);
  for (const s of [...SLOTS, ...EXTRA_SLOTS]) {
    const cells = RARITIES.map((r) => {
      const b = buildItem(s, L, r);
      if (b.budgetUsed > r.budget) { overBudget++; return `${fmt(b)} ⚠️ over budget`; }
      return fmt(b);
    });
    out.push(`| ${s.slot} | ${cells.join(' | ')} |`);
  }
}

const val: string[] = [];
val.push('| Level | Common set vs naked | Uncommon vs Common | Rare vs Uncommon | Epic vs Rare | Legendary vs Epic |');
val.push('|---|---|---|---|---|---|');
for (const L of [1, 5, 10, 15, 20]) {
  const row: string[] = [];
  let prev: any = setChar('P', L, null);
  for (const r of RARITIES) {
    const cur = setChar('C', L, r);
    row.push(`${Math.round(fight(cur, prev, FIGHTS) * 100)}%`);
    prev = { ...cur, id: 'P', walletAddress: 'P' };
  }
  val.push(`| ${L} | ${row.join(' | ')} |`);
  process.stderr.write(`validated L${L}\n`);
}

// Mechanics checks: what an empty shield / a 2-hander is worth on its own.
function kit(id: string, level: number, kind: 'naked' | 'emptyShield' | 'twoHand' | 'oneHandShield', rarity = RARITIES[2]) {
  const equipment: any = { ...EMPTY };
  if (kind === 'emptyShield') equipment.offhand = { statBonuses: {}, minDamage: 0, maxDamage: 0, itemType: 2, slotType: 1 };
  if (kind === 'twoHand' || kind === 'oneHandShield') {
    const base = setChar(id, level, rarity).equipment;
    Object.assign(equipment, base);
    if (kind === 'twoHand') {
      const b = buildItem(EXTRA_SLOTS[0], level, rarity);
      equipment.weapon = { statBonuses: b.bonus, minDamage: b.min, maxDamage: b.max, itemType: 1, slotType: 2 };
      equipment.offhand = null;
    }
  }
  return { id, walletAddress: id, level, stats: baseStats(level), equipment };
}
const mech: string[] = [];
for (const L of [1, 10, 20]) {
  mech.push(`| ${L} | ${Math.round(fight(kit('A', L, 'emptyShield'), kit('B', L, 'naked'), FIGHTS) * 100)}% | ${Math.round(fight(kit('A', L, 'twoHand'), kit('B', L, 'oneHandShield'), FIGHTS) * 100)}% |`);
}

const edgeRows: string[] = [];
edgeRows.push(`| Stat | ${[1, 5, 10, 15, 20].map((l) => `Lv${l}`).join(' | ')} |`);
edgeRows.push(`|---|${[1, 5, 10, 15, 20].map(() => '---').join('|')}|`);
for (const k of MEASURED) edgeRows.push(`| ${LABEL[k]} | ${[1, 5, 10, 15, 20].map((l) => edges[l][k].toFixed(1)).join(' | ')} |`);

console.log('<!-- EDGE -->');
console.log(edgeRows.join('\n'));
console.log('<!-- VALIDATION -->');
console.log(val.join('\n'));
console.log('<!-- MECH -->');
console.log('| Level | Empty shield (0 stats) vs no shield | Rare 2-hander set vs Rare 1-hand+shield set |\n|---|---|---|\n' + mech.join('\n'));
console.log('<!-- TABLES -->');
console.log(out.join('\n'));
console.log(`<!-- over-budget cells: ${overBudget} -->`);
