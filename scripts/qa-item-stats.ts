/**
 * Item-stat wiring gauntlet (v5.3, 2026-09-27).
 *
 *   $ cd server && npx tsx ../scripts/qa-item-stats.ts
 *
 * Before v5.3 the server read only 9 of the 13 chain `Item` stat fields,
 * and added `crit_chance_bonus` to the crit MULTIPLIER (a +10 crit-chance
 * ring made crits hit ~11.5×). `crit_multiplier_bonus`, `evasion_bonus`,
 * `anti_crit_bonus` and `anti_evasion_bonus` were dropped entirely.
 *
 * This gauntlet pins every item stat to its documented effect on
 * `deriveCombatStats` (server = authority) and checks the frontend mirror
 * agrees for the self-only stats it models.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { GAME_CONSTANTS } from '../server/src/config';
import { computeDerivedStats } from '../frontend/src/lib/combat';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { deriveCombatStats } = require('../server/src/game/combat');

let passes = 0;
let failures = 0;
function ok(label: string): void { passes++; console.log(`  \x1b[32mPASS\x1b[0m ${label}`); }
function fail(label: string, detail: string): void { failures++; console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`); }
function near(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) < 1e-9) ok(label);
  else fail(label, `actual=${actual} expected=${expected}`);
}

const EMPTY = {
  weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
  boots: null, belt: null, ring1: null, ring2: null, necklace: null,
  ring3: null, pants: null, bracelets: null,
};
const STATS = { strength: 10, dexterity: 10, intuition: 10, endurance: 10 };

function ring(statBonuses: Record<string, number>) {
  return { statBonuses, minDamage: 0, maxDamage: 0, itemType: 8 };
}
function char(equipment: Record<string, unknown> = {}, stats = STATS, level = 5) {
  return { id: 'c', walletAddress: '0xtest', level, stats, equipment: { ...EMPTY, ...equipment } };
}
function derive(me: ReturnType<typeof char>, opp?: ReturnType<typeof char>) {
  return deriveCombatStats(me as any, opp?.stats, opp?.equipment as any);
}

function main(): void {
  const base = derive(char());
  const baseVsOpp = derive(char(), char());

  console.log('\n[1] crit_chance_bonus → crit CHANCE (percentage points), not multiplier');
  const crit = derive(char({ ring1: ring({ critBonus: 5 }) }));
  near(crit.critChance, base.critChance + 5, `+5 crit chance → critChance ${base.critChance} → ${base.critChance + 5}`);
  near(crit.critMultiplier, base.critMultiplier, 'crit multiplier unchanged by crit chance');

  console.log('\n[2] crit_multiplier_bonus → multiplier in hundredths');
  const mult = derive(char({ ring1: ring({ critMultiplier: 25 }) }));
  near(mult.critMultiplier, base.critMultiplier + 0.25, '+25 → +0.25× crit multiplier');
  near(mult.critChance, base.critChance, 'crit chance unchanged by multiplier');

  console.log('\n[3] evasion_bonus → evasion chance (percentage points)');
  const eva = derive(char({ ring1: ring({ evasion: 4 }) }));
  near(eva.evasionChance, base.evasionChance + 4, '+4 evasion → +4%');

  console.log('\n[4] anti_crit_bonus lowers the OPPONENT\'s crit chance');
  const vsAntiCrit = derive(char(), char({ ring1: ring({ antiCrit: 3 }) }));
  near(vsAntiCrit.critChance, Math.max(0, baseVsOpp.critChance - 3), 'opponent +3 anti-crit → my crit −3%');

  console.log('\n[5] anti_evasion_bonus lowers the OPPONENT\'s evasion chance');
  const vsAntiEva = derive(char(), char({ ring1: ring({ antiEvasion: 2 }) }));
  near(vsAntiEva.evasionChance, Math.max(0, baseVsOpp.evasionChance - 2), 'opponent +2 anti-evasion → my evasion −2%');

  console.log('\n[6] Caps still hold');
  const capped = derive(char({ ring1: ring({ critBonus: 500, evasion: 500 }) }));
  near(capped.critChance, GAME_CONSTANTS.CRIT_CHANCE_CAP, `crit chance capped at ${GAME_CONSTANTS.CRIT_CHANCE_CAP}%`);
  near(capped.evasionChance, GAME_CONSTANTS.EVASION_CAP, `evasion capped at ${GAME_CONSTANTS.EVASION_CAP}%`);

  console.log('\n[7] Opponent item STR/END bonuses still feed anti-evasion / anti-crit');
  const vsStr = derive(char(), char({ ring1: ring({ strength: 10 }) }));
  near(vsStr.evasionChance, Math.max(0, baseVsOpp.evasionChance - 10 * GAME_CONSTANTS.ANTI_EVASION_PER_STRENGTH), 'opponent +10 STR item → my evasion −3%');

  console.log('\n[8] Frontend mirror agrees on self-only item stats');
  const feItem = {
    statBonuses: {
      strengthBonus: 0, dexterityBonus: 0, intuitionBonus: 0, enduranceBonus: 0, hpBonus: 0,
      armorBonus: 0, defenseBonus: 0, attackBonus: 0, critChanceBonus: 5, critMultiplierBonus: 25,
      evasionBonus: 4, antiCritBonus: 0, antiEvasionBonus: 0,
    },
    minDamage: 0, maxDamage: 0,
  };
  const fe = computeDerivedStats(STATS, { ...EMPTY, ring1: feItem } as any, undefined, 5);
  const sv = derive(char({ ring1: ring({ critBonus: 5, critMultiplier: 25, evasion: 4 }) }));
  near(fe.critChance, Math.round(sv.critChance * 10) / 10, `critChance frontend ${fe.critChance} = server ${sv.critChance}`);
  near(fe.critMultiplier, Math.round(sv.critMultiplier * 100) / 100, `critMultiplier frontend ${fe.critMultiplier} = server ${sv.critMultiplier}`);
  near(fe.evasionChance, Math.round(sv.evasionChance * 10) / 10, `evasion frontend ${fe.evasionChance} = server ${sv.evasionChance}`);

  console.log(`\n${'='.repeat(60)}\nitem-stats gauntlet: ${passes}/${passes + failures} PASS, ${failures} FAIL\n${'='.repeat(60)}`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
