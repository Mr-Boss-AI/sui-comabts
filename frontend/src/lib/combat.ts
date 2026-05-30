import type { CharacterStats, DerivedStats, EquipmentSlots, Item } from "@/types/game";

// Per-level HP and weapon-damage tables. **Server is canonical** —
// `server/src/config.ts::GAME_CONSTANTS` is what combat actually runs.
// These mirrors exist so the character page can show the correct
// max-HP and base-attack-power without a server round-trip. Drift here
// produced the live-test 2026-05-03 bug where the character page
// reported HP 178 (old Fibonacci-curve table) while combat used HP 93
// (rebalanced "chunky-progression" table) for the same Lv4 Mr_Boss.
//
// `qa-combat-stats.ts` pins these element-by-element against the
// server config so a future rebalance can't silently desync again.
// Indices 1..20 are the playable range; index 0 is the unused L0 slot.
export const LEVEL_HP = [
  0,    // L0 (unused)
  40,   // L1
  50,   // L2
  65,   // L3
  85,   // L4
  110,  // L5
  140,  // L6
  175,  // L7
  215,  // L8
  260,  // L9
  310,  // L10
  365,  // L11
  425,  // L12
  490,  // L13
  560,  // L14
  635,  // L15
  715,  // L16
  800,  // L17
  890,  // L18
  985,  // L19
  1085, // L20
] as const;

export const LEVEL_WEAPON_DAMAGE = [
  0,   // L0 (unused)
  6,   // L1
  8,   // L2
  11,  // L3
  14,  // L4
  18,  // L5
  22,  // L6
  27,  // L7
  32,  // L8
  38,  // L9
  44,  // L10
  50,  // L11
  57,  // L12
  64,  // L13
  72,  // L14
  80,  // L15
  88,  // L16
  97,  // L17
  106, // L18
  116, // L19
  126, // L20
] as const;

function sumEquipmentStat(
  equipment: EquipmentSlots,
  key: keyof Item["statBonuses"]
): number {
  let total = 0;
  for (const item of Object.values(equipment)) {
    if (item) total += item.statBonuses[key] || 0;
  }
  return total;
}

function getWeaponDamage(equipment: EquipmentSlots): number {
  const w = equipment.weapon;
  if (!w) return 0;
  return (w.minDamage + w.maxDamage) / 2;
}

export function computeDerivedStats(
  stats: CharacterStats,
  equipment: EquipmentSlots,
  opponentStats?: CharacterStats,
  level: number = 1
): DerivedStats {
  const eqHp = sumEquipmentStat(equipment, "hpBonus");
  const eqArmor = sumEquipmentStat(equipment, "armorBonus");
  const eqDefense = sumEquipmentStat(equipment, "defenseBonus");
  const eqAttack = sumEquipmentStat(equipment, "attackBonus");
  const eqCritChance = sumEquipmentStat(equipment, "critChanceBonus");
  const eqCritMult = sumEquipmentStat(equipment, "critMultiplierBonus");
  const eqEvasion = sumEquipmentStat(equipment, "evasionBonus");
  const weaponDmg = getWeaponDamage(equipment);

  const maxHp = (LEVEL_HP[level] || 40) + eqHp;

  const baseWeaponDmg = LEVEL_WEAPON_DAMAGE[level] || 6;
  const attackPower = baseWeaponDmg + weaponDmg
    + stats.strength * 0.5
    + stats.dexterity * 0.15
    + eqAttack;

  const opAntiCrit = opponentStats ? opponentStats.endurance * 0.3 : 0;
  const critChance = Math.min(25, stats.intuition * 0.5 + eqCritChance - opAntiCrit);

  const critMultiplier = 1.5 + stats.intuition * 0.01 + eqCritMult / 100;

  const opAntiEvasion = opponentStats ? opponentStats.strength * 0.3 : 0;
  const evasionChance = Math.min(30, stats.dexterity * 0.5 + eqEvasion - opAntiEvasion);

  const armor = eqArmor;
  const defense = Math.max(0, stats.endurance * 0.3 + eqDefense);

  return {
    maxHp: Math.round(Math.max(1, maxHp)),
    attackPower: Math.round(attackPower * 10) / 10,
    critChance: Math.round(Math.max(0, critChance) * 10) / 10,
    critMultiplier: Math.round(critMultiplier * 100) / 100,
    evasionChance: Math.round(Math.max(0, evasionChance) * 10) / 10,
    armor: Math.round(armor),
    defense: Math.round(defense * 10) / 10,
  };
}

export function computeDefenseReduction(defense: number): number {
  return defense;
}

export function getArchetype(stats: CharacterStats): string {
  const { strength, dexterity, intuition, endurance } = stats;
  const max = Math.max(strength, dexterity, intuition, endurance);
  if (max === endurance && endurance >= strength)
    return "Tank";
  if (max === intuition)
    return "Crit";
  if (max === dexterity)
    return "Evasion";
  return "Hybrid";
}

export function getArchetypeColor(archetype: string): string {
  switch (archetype) {
    case "Tank": return "text-amber-400";
    case "Crit": return "text-red-400";
    case "Evasion": return "text-cyan-400";
    default: return "text-zinc-400";
  }
}
