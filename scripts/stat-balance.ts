/**
 * Stat-build balance tuner (v5.3).
 *
 *   $ cd server && SUI_PACKAGE_ID=0x1 ADMIN_CAP_ID=0x1 PLATFORM_TREASURY=0x1 \
 *       SUI_TREASURY_PRIVATE_KEY=dummy npx tsx ../scripts/stat-balance.ts
 *   REPORT_ONLY=1 … → just print the matchup table for config.ts values.
 *
 * Five builds with the same number of stat points: STR, DEX, INT, END
 * (half the points in the main stat) and BAL (even split). Grid-searches the
 * INT constants + CRIT_BLOCK_PIERCE so the INT build's average win rate vs
 * every other build is ~50% without breaking the others.
 */
import { GAME_CONSTANTS } from '../server/src/config';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { createFighterState, resolveTurn, checkFightEnd, generateRandomAction, judgeByHp } = require('../server/src/game/combat');

const G = GAME_CONSTANTS as any;
const FIGHTS = Number(process.env.FIGHTS ?? 600);
const LEVELS = [3, 8, 14, 20];
const EMPTY = { weapon: null, offhand: null, helmet: null, chest: null, gloves: null, boots: null, belt: null,
  ring1: null, ring2: null, necklace: null, ring3: null, pants: null, bracelets: null };
const BUILDS = ['STR', 'DEX', 'INT', 'END', 'BAL'] as const;
type Build = typeof BUILDS[number];
const KEY: Record<string, string> = { STR: 'strength', DEX: 'dexterity', INT: 'intuition', END: 'endurance' };

function stats(level: number, b: Build) {
  const pts = 20 + 3 * (level - 1);
  const s: any = { strength: 0, dexterity: 0, intuition: 0, endurance: 0 };
  if (b === 'BAL') { const e = Math.floor(pts / 4); Object.keys(s).forEach((k, i) => (s[k] = e + (i < pts - e * 4 ? 1 : 0))); return s; }
  const main = Math.round(pts * 0.5); const rest = pts - main; const each = Math.floor(rest / 3);
  let extra = rest - each * 3;
  for (const k of Object.keys(s)) { if (k === KEY[b]) s[k] = main; else { s[k] = each + (extra > 0 ? 1 : 0); extra--; } }
  return s;
}
const ch = (id: string, level: number, b: Build) => ({ id, walletAddress: id, level, stats: stats(level, b), equipment: { ...EMPTY } });

function fight(a: any, b: any, n: number): number {
  let score = 0;
  for (let i = 0; i < n; i++) {
    const fa = createFighterState(a, b); const fb = createFighterState(b, a);
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

function matrix(n: number) {
  // avg win rate of each build vs the other four, averaged over LEVELS
  const avg: Record<string, number> = {}; const intVs: Record<string, number> = {};
  for (const a of BUILDS) avg[a] = 0;
  for (const L of LEVELS) for (const a of BUILDS) for (const b of BUILDS) {
    if (a >= b) continue;
    const r = fight(ch('A', L, a), ch('B', L, b), n);
    avg[a] += r; avg[b] += 1 - r;
    if (a === 'INT') intVs[b] = (intVs[b] ?? 0) + r / LEVELS.length;
    if (b === 'INT') intVs[a] = (intVs[a] ?? 0) + (1 - r) / LEVELS.length;
  }
  for (const a of BUILDS) avg[a] /= (BUILDS.length - 1) * LEVELS.length;
  return { avg, intVs };
}

type V = { cc: number; cm: number; pierce: number; cap: number };
const apply = (v: V) => { G.CRIT_CHANCE_PER_INTUITION = v.cc; G.CRIT_MULTIPLIER_PER_INTUITION = v.cm; G.CRIT_BLOCK_PIERCE = v.pierce; G.CRIT_CHANCE_CAP = v.cap; };
const configured: V = { cc: G.CRIT_CHANCE_PER_INTUITION, cm: G.CRIT_MULTIPLIER_PER_INTUITION, pierce: G.CRIT_BLOCK_PIERCE ?? 0, cap: G.CRIT_CHANCE_CAP };

function spread(avg: Record<string, number>) { return BUILDS.reduce((e, b) => e + (avg[b] - 0.5) ** 2, 0); }

// TUNE=core — tune END / DEX / STR constants with INT as configured.
if (process.env.TUNE === 'core') {
  type C = { hpEnd: number; defEnd: number; acEnd: number; evaDex: number; dmgDex: number; aeStr: number };
  const applyC = (c: C) => { G.HP_PER_ENDURANCE = c.hpEnd; G.DEFENSE_PER_ENDURANCE = c.defEnd; G.ANTI_CRIT_PER_ENDURANCE = c.acEnd;
    G.EVASION_PER_DEXTERITY = c.evaDex; G.DEX_DAMAGE_BONUS = c.dmgDex; G.ANTI_EVASION_PER_STRENGTH = c.aeStr; };
  const start: C = { hpEnd: G.HP_PER_ENDURANCE, defEnd: G.DEFENSE_PER_ENDURANCE, acEnd: G.ANTI_CRIT_PER_ENDURANCE,
    evaDex: G.EVASION_PER_DEXTERITY, dmgDex: G.DEX_DAMAGE_BONUS, aeStr: G.ANTI_EVASION_PER_STRENGTH };
  let best: C & { err: number } = { ...start, err: Infinity };
  for (const hpEnd of [2, 2.5, 3]) for (const defEnd of [0.1, 0.15, 0.2, 0.3]) for (const acEnd of [0.2, 0.3])
    for (const evaDex of [0.5, 0.65, 0.8]) for (const dmgDex of [0.15, 0.3]) for (const aeStr of [0.2, 0.3]) {
      const c = { hpEnd, defEnd, acEnd, evaDex, dmgDex, aeStr }; applyC(c);
      const { avg } = matrix(FIGHTS);
      const err = spread(avg);
      if (err < best.err) best = { ...c, err };
    }
  console.log(`best core: HP_PER_ENDURANCE=${best.hpEnd} DEFENSE_PER_ENDURANCE=${best.defEnd} ANTI_CRIT_PER_ENDURANCE=${best.acEnd} EVASION_PER_DEXTERITY=${best.evaDex} DEX_DAMAGE_BONUS=${best.dmgDex} ANTI_EVASION_PER_STRENGTH=${best.aeStr}`);
  applyC(best);
  const f = matrix(FIGHTS * 3);
  console.log('| Build | ' + BUILDS.join(' | ') + ' |\n|---|' + BUILDS.map(() => '---').join('|') + '|');
  console.log('| win % | ' + BUILDS.map((b) => `${Math.round(f.avg[b] * 100)}%`).join(' | ') + ' |');
  process.exit(0);
}

if (!process.env.REPORT_ONLY) {
  apply({ ...configured, cc: 0.5, cm: 0.01, pierce: 0, cap: 25 });
  const before = matrix(FIGHTS);
  console.log('before (v5.2 INT):', Object.entries(before.avg).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join('  '));
  let best: V & { err: number } = { cc: 0.5, cm: 0.01, pierce: 0, cap: 25, err: Infinity };
  for (const cc of [0.75, 1.0, 1.25, 1.5]) for (const cm of [0.01, 0.02, 0.03]) for (const pierce of [0.2, 0.3]) for (const cap of [30, 40]) {
    apply({ cc, cm, pierce, cap });
    const { avg } = matrix(FIGHTS);
    const err = spread(avg);
    if (err < best.err) best = { cc, cm, pierce, cap, err };
  }
  console.log(`best: CRIT_CHANCE_PER_INTUITION=${best.cc} CRIT_MULTIPLIER_PER_INTUITION=${best.cm} CRIT_BLOCK_PIERCE=${best.pierce} CRIT_CHANCE_CAP=${best.cap}`);
  apply(best);
} else apply(configured);

const final = matrix(FIGHTS * 3);
console.log('\nBuild (avg win % vs the other 4 builds, levels ' + LEVELS.join('/') + '):');
console.log('| Build | ' + BUILDS.join(' | ') + ' |\n|---|' + BUILDS.map(() => '---').join('|') + '|');
console.log('| win % | ' + BUILDS.map((b) => `${Math.round(final.avg[b] * 100)}%`).join(' | ') + ' |');
console.log('\nINT build vs each: ' + Object.entries(final.intVs).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join('  '));
