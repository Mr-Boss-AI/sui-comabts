/**
 * Combat-stats parity gauntlet (live test 2026-05-03).
 *
 *   $ cd server && npx tsx ../scripts/qa-combat-stats.ts
 *
 * Mr_Boss_v5.1 (Lv4) showed HP 178 on the character page and HP 93 in
 * combat for the same fight. Same character, same equipment, same
 * moment, two different numbers. Root cause: the frontend's
 * `lib/combat.ts` carried a pre-rebalance Fibonacci-style HP table
 * (`[0,40,65,105,170,...]`) while the server had moved to a
 * chunky-progression table (`[0,40,50,65,85,...]`) during the v4→v5
 * hardening. The character page reported the old table's value (170+8
 * = 178); combat ran the new table's value (85+8 = 93). Players will
 * mistrust a UI that disagrees with the rules.
 *
 * Fix: frontend mirrors are now copies of the server-canonical tables
 * with the full 21 entries (L0..L20). This gauntlet pins parity:
 * every level slot, every weapon-damage slot, plus a few `maxHp`
 * outputs through the actual `computeDerivedStats` to confirm the
 * derivation function uses the table correctly.
 *
 * If a future rebalance changes server config, this gauntlet fails
 * until the frontend mirror is updated. Single source of truth = the
 * server config; frontend lives in `frontend/src/lib/combat.ts`.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { GAME_CONSTANTS } from '../server/src/config';
import {
  LEVEL_HP as FE_LEVEL_HP,
  LEVEL_WEAPON_DAMAGE as FE_LEVEL_WEAPON_DAMAGE,
  computeDerivedStats,
} from '../frontend/src/lib/combat';
import type { CharacterStats, EquipmentSlots, Item, StatBonuses } from '../frontend/src/types/game';

let passes = 0;
let failures = 0;

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

const ZERO_BONUSES: StatBonuses = {
  strengthBonus: 0,
  dexterityBonus: 0,
  intuitionBonus: 0,
  enduranceBonus: 0,
  hpBonus: 0,
  armorBonus: 0,
  defenseBonus: 0,
  attackBonus: 0,
  critChanceBonus: 0,
  critMultiplierBonus: 0,
  evasionBonus: 0,
  antiCritBonus: 0,
  antiEvasionBonus: 0,
};

function mkItem(overrides: Partial<Item> & Pick<Item, 'id' | 'name' | 'itemType'>): Item {
  return {
    classReq: 0,
    levelReq: 1,
    rarity: 1,
    statBonuses: { ...ZERO_BONUSES, ...(overrides.statBonuses ?? {}) },
    minDamage: 0,
    maxDamage: 0,
    ...overrides,
    statBonuses: { ...ZERO_BONUSES, ...(overrides.statBonuses ?? {}) },
  } as Item;
}

const EMPTY_EQUIP: EquipmentSlots = {
  weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
  boots: null, belt: null, ring1: null, ring2: null, necklace: null,
};

function main(): void {
  // ===========================================================================
  // 1 — table-length parity
  // ===========================================================================
  console.log('\n[1] Table lengths match server config');
  eq(FE_LEVEL_HP.length, GAME_CONSTANTS.LEVEL_HP.length,
     `LEVEL_HP length (frontend ${FE_LEVEL_HP.length}, server ${GAME_CONSTANTS.LEVEL_HP.length})`);
  eq(FE_LEVEL_WEAPON_DAMAGE.length, GAME_CONSTANTS.LEVEL_WEAPON_DAMAGE.length,
     `LEVEL_WEAPON_DAMAGE length (frontend ${FE_LEVEL_WEAPON_DAMAGE.length}, server ${GAME_CONSTANTS.LEVEL_WEAPON_DAMAGE.length})`);
  eq(FE_LEVEL_HP.length, 21, 'LEVEL_HP has 21 slots (L0..L20)');
  eq(FE_LEVEL_WEAPON_DAMAGE.length, 21, 'LEVEL_WEAPON_DAMAGE has 21 slots (L0..L20)');

  // ===========================================================================
  // 2 — element-by-element parity (the actual desync guard)
  // ===========================================================================
  console.log('\n[2] LEVEL_HP element-by-element parity');
  for (let level = 0; level < FE_LEVEL_HP.length; level++) {
    const fe = FE_LEVEL_HP[level];
    const sv = GAME_CONSTANTS.LEVEL_HP[level];
    eq(fe, sv, `L${level}: frontend=${fe} === server=${sv}`);
  }

  console.log('\n[3] LEVEL_WEAPON_DAMAGE element-by-element parity');
  for (let level = 0; level < FE_LEVEL_WEAPON_DAMAGE.length; level++) {
    const fe = FE_LEVEL_WEAPON_DAMAGE[level];
    const sv = GAME_CONSTANTS.LEVEL_WEAPON_DAMAGE[level];
    eq(fe, sv, `L${level}: frontend=${fe} === server=${sv}`);
  }

  // ===========================================================================
  // 4 — ⚡ THE BUG: Mr_Boss Lv4 with Chainmail → maxHp = 93, not 178
  // ===========================================================================
  console.log('\n[4] ⚡ Mr_Boss / Sx live-test maxHp regressions (the actual bug)');
  const mrBossStats: CharacterStats = { strength: 6, dexterity: 6, intuition: 11, endurance: 6 };
  const mrBossGear: EquipmentSlots = {
    ...EMPTY_EQUIP,
    weapon: mkItem({
      id: 'longsword', name: 'Longsword', itemType: 1, levelReq: 2, minDamage: 4, maxDamage: 7,
      statBonuses: { ...ZERO_BONUSES, strengthBonus: 1 },
    }),
    chest: mkItem({
      id: 'chainmail', name: 'Chainmail Shirt', itemType: 4, levelReq: 3,
      statBonuses: { ...ZERO_BONUSES, hpBonus: 8 },
    }),
    ring1: mkItem({
      id: 'phantom_loop', name: 'Phantom Loop', itemType: 8, levelReq: 3,
      statBonuses: { ...ZERO_BONUSES, intuitionBonus: 2 },
    }),
    ring2: mkItem({
      id: 'silver_signet', name: 'Silver Signet', itemType: 8, levelReq: 3,
      statBonuses: { ...ZERO_BONUSES, dexterityBonus: 3 },
    }),
  };
  const mrBoss = computeDerivedStats(mrBossStats, mrBossGear, undefined, 4);
  eq(mrBoss.maxHp, 93,
    'Mr_Boss Lv4 (Chainmail HP+8) → maxHp=93 (was 178 pre-fix; combat used 93)');

  const sxStats: CharacterStats = { strength: 6, dexterity: 13, intuition: 5, endurance: 5 };
  const sxGear: EquipmentSlots = {
    ...EMPTY_EQUIP,
    chest: mkItem({
      id: 'assassins_garb', name: "Assassin's Garb", itemType: 4, levelReq: 3,
      statBonuses: { ...ZERO_BONUSES, hpBonus: 3 },
    }),
  };
  const sx = computeDerivedStats(sxStats, sxGear, undefined, 4);
  eq(sx.maxHp, 88,
    'Sx Lv4 (Garb HP+3) → maxHp=88 (was 173 pre-fix; combat used 88)');

  // ===========================================================================
  // 5 — maxHp formula sanity at every level (no equipment bonus)
  // ===========================================================================
  console.log('\n[5] maxHp = LEVEL_HP[level] when no hp_bonus equipment');
  const blankStats: CharacterStats = { strength: 5, dexterity: 5, intuition: 5, endurance: 5 };
  for (let level = 1; level <= 20; level++) {
    const d = computeDerivedStats(blankStats, EMPTY_EQUIP, undefined, level);
    eq(d.maxHp, GAME_CONSTANTS.LEVEL_HP[level],
       `L${level}: maxHp=${d.maxHp} === LEVEL_HP[${level}]=${GAME_CONSTANTS.LEVEL_HP[level]}`);
  }

  // ===========================================================================
  // 6 — equipment hpBonus is added flat
  // ===========================================================================
  console.log('\n[6] hpBonus is added flat to LEVEL_HP[level]');
  const heavyChest = mkItem({
    id: 'titan_plate', name: 'Titan Plate', itemType: 4, levelReq: 1,
    statBonuses: { ...ZERO_BONUSES, hpBonus: 50 },
  });
  for (const level of [1, 5, 10, 20]) {
    const d = computeDerivedStats(blankStats, { ...EMPTY_EQUIP, chest: heavyChest }, undefined, level);
    const expected = GAME_CONSTANTS.LEVEL_HP[level] + 50;
    eq(d.maxHp, expected, `L${level} +50 hpBonus → ${expected}`);
  }

  // ===========================================================================
  // 7 — out-of-range level fallback uses the same default both ways
  // ===========================================================================
  console.log('\n[7] Out-of-range level → default 40');
  const oob = computeDerivedStats(blankStats, EMPTY_EQUIP, undefined, 99);
  eq(oob.maxHp, 40, 'L99 → maxHp=40 (fallback table miss)');

  // ===========================================================================
  // 8 — base attackPower at sample levels uses LEVEL_WEAPON_DAMAGE[level]
  // ===========================================================================
  console.log('\n[8] Attack power floor = LEVEL_WEAPON_DAMAGE[level] (no weapon, min stats)');
  const minStats: CharacterStats = { strength: 0, dexterity: 0, intuition: 0, endurance: 0 };
  for (const level of [1, 4, 10, 20]) {
    const d = computeDerivedStats(minStats, EMPTY_EQUIP, undefined, level);
    eq(d.attackPower, GAME_CONSTANTS.LEVEL_WEAPON_DAMAGE[level],
       `L${level}: attackPower=${d.attackPower} === LEVEL_WEAPON_DAMAGE[${level}]=${GAME_CONSTANTS.LEVEL_WEAPON_DAMAGE[level]}`);
  }

  // ===========================================================================
  // 9 — server's own combat math agrees with frontend on these inputs
  //     (smoke test against deriveCombatStats; the server runs combat so its
  //      output is the chain truth at fight resolution time)
  // ===========================================================================
  console.log('\n[9] Server `deriveCombatStats` agrees on maxHp');
  // Lazy-load to avoid pulling the rest of the server graph if step 8 already
  // failed, but in practice we want this last so a regression here is caught.
  const { deriveCombatStats } = require('../server/src/game/combat');
  const sxServer = deriveCombatStats(
    {
      id: 'sx',
      walletAddress: '0xtest',
      level: 4,
      stats: { strength: 6, dexterity: 13, intuition: 5, endurance: 5 },
      equipment: {
        ...EMPTY_EQUIP,
        chest: { statBonuses: { hp: 3 }, minDamage: 0, maxDamage: 0, itemType: 4 },
      },
    } as any,
    undefined,
    undefined,
  );
  eq(sxServer.maxHp, 88, 'server deriveCombatStats Sx Lv4 → 88 (matches frontend Sx)');
  const mbServer = deriveCombatStats(
    {
      id: 'mb',
      walletAddress: '0xtest',
      level: 4,
      stats: { strength: 6, dexterity: 6, intuition: 11, endurance: 6 },
      equipment: {
        ...EMPTY_EQUIP,
        chest: { statBonuses: { hp: 8 }, minDamage: 0, maxDamage: 0, itemType: 4 },
      },
    } as any,
    undefined,
    undefined,
  );
  eq(mbServer.maxHp, 93, 'server deriveCombatStats Mr_Boss Lv4 → 93 (matches frontend Mr_Boss)');

  // ===========================================================================
  // Summary
  // ===========================================================================
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`combat-stats gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
