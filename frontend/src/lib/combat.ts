import type { CharacterStats, DerivedStats, EquipmentSlots, Item } from "@/types/game";

// Fibonacci HP per level (matches server)
const LEVEL_HP = [0, 40, 65, 105, 170, 275, 445, 720, 1165];
const LEVEL_WEAPON_DAMAGE = [0, 6, 8, 16, 20, 42, 52, 84, 136];

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
