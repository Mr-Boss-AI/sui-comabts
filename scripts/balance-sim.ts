/**
 * Item balance simulator (v5.3).
 *
 *   $ cd server && SUI_PACKAGE_ID=0x1 ADMIN_CAP_ID=0x1 PLATFORM_TREASURY=0x1 \
 *       SUI_TREASURY_PRIVATE_KEY=dummy npx tsx ../scripts/balance-sim.ts
 *
 * For each level it builds a "baseline" fighter (all stat points spread
 * evenly, no gear), then finds how much of each single item stat makes an
 * otherwise identical fighter win 60% of fights against the baseline, using
 * the real server combat engine with random zone choices.
 *
 * That amount = one "edge unit". Item budgets in docs/ITEM_DESIGN_GUIDE.md
 * are expressed in edge units so every stat is priced by what it actually
 * does in a fight, not by its raw number.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createFighterState, resolveTurn, checkFightEnd, generateRandomAction, judgeByHp } = require('../server/src/game/combat');

const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
  ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null };

const LEVELS = [1, 5, 10, 15, 20];
const FIGHTS = Number(process.env.FIGHTS ?? 3000);
const TARGET = 0.60;

type Bonus = Record<string, number>;
const STATS: { key: string; label: string; weapon?: boolean }[] = [
  { key: 'hp', label: 'HP' },
  { key: 'armor', label: 'Armor' },
  { key: 'defense', label: 'Defense' },
  { key: 'damage', label: 'Attack (flat dmg)' },
  { key: 'weaponAvg', label: 'Weapon avg dmg', weapon: true },
  { key: 'strength', label: 'STR' },
  { key: 'dexterity', label: 'DEX' },
  { key: 'intuition', label: 'INT' },
  { key: 'endurance', label: 'END' },
  { key: 'critBonus', label: 'Crit chance %' },
  { key: 'critMultiplier', label: 'Crit dmg (1/100x)' },
  { key: 'evasion', label: 'Evasion %' },
  { key: 'antiCrit', label: 'Anti-crit %' },
  { key: 'antiEvasion', label: 'Anti-evasion %' },
];

function baseline(level: number) {
  const pts = 20 + 3 * (level - 1);
  const each = Math.floor(pts / 4);
  const rem = pts - each * 4;
  return { strength: each + (rem > 0 ? 1 : 0), dexterity: each + (rem > 1 ? 1 : 0), intuition: each + (rem > 2 ? 1 : 0), endurance: each };
}

function fighter(id: string, level: number, bonus: Bonus, weaponAvg = 0) {
  const equipment: any = { ...EMPTY };
  equipment.ring1 = { statBonuses: bonus, minDamage: 0, maxDamage: 0, itemType: 8 };
  if (weaponAvg > 0) equipment.weapon = { statBonuses: {}, minDamage: weaponAvg, maxDamage: weaponAvg, itemType: 1, slotType: 0 };
  return { id, walletAddress: id, level, stats: baseline(level), equipment };
}

function winRate(a: any, b: any, n: number): number {
  let score = 0;
  for (let i = 0; i < n; i++) {
    const fa = createFighterState(a, b);
    const fb = createFighterState(b, a);
    let turn = 0; let end: any = { finished: false };
    while (!end.finished && turn < 60) {
      turn++;
      resolveTurn(turn, fa, fb, generateRandomAction('none'), generateRandomAction('none'));
      end = checkFightEnd(fa, fb);
    }
    if (!end.finished) { const v = judgeByHp(fa, fb); end = { winner: v.winner, draw: v.draw }; }
    if (end.draw) score += 0.5; else if (end.winner === a.id) score += 1;
  }
  return score / n;
}

function edgeUnit(level: number, stat: typeof STATS[number]): number | null {
  const base = fighter('B', level, {});
  const rate = (x: number) => {
    const a = stat.weapon ? fighter('A', level, {}, x) : fighter('A', level, { [stat.key]: x });
    return winRate(a, base, FIGHTS);
  };
  let lo = 0, hi = 1;
  while (rate(hi) < TARGET) { hi *= 2; if (hi > 4096) return null; }
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (rate(mid) < TARGET) lo = mid; else hi = mid;
  }
  return Math.round(hi * 10) / 10;
}

const rows: string[] = [];
rows.push(`| Stat | ${LEVELS.map((l) => `Lv${l}`).join(' | ')} |`);
rows.push(`|---|${LEVELS.map(() => '---').join('|')}|`);
for (const s of STATS) {
  const vals = LEVELS.map((l) => { const v = edgeUnit(l, s); return v === null ? 'n/a (capped)' : String(v); });
  rows.push(`| ${s.label} | ${vals.join(' | ')} |`);
  console.error(`done ${s.label}`);
}
console.log(`Edge unit = amount of ONE stat that turns a 50% mirror match into a ${TARGET * 100}% win rate (${FIGHTS} fights per probe).\n`);
console.log(rows.join('\n'));
