import { GAME_CONSTANTS } from '../config';
import type {
  Character,
  CharacterStats,
  DerivedStats,
  EquipmentSlots,
  FighterState,
  HitResult,
  Item,
  OffhandType,
  TurnAction,
  TurnResult,
  Zone,
} from '../types';

// === Helper: random number in range ===

function randomFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// === Equipment stat aggregation ===

function getEquipmentBonuses(equipment: EquipmentSlots): {
  hpBonus: number;
  armorTotal: number;
  defenseBonus: number;
  critBonus: number;
  damageBonus: number;
  strengthBonus: number;
  dexterityBonus: number;
  intuitionBonus: number;
  enduranceBonus: number;
  weaponMinDamage: number;
  weaponMaxDamage: number;
} {
  let hpBonus = 0;
  let armorTotal = 0;
  let defenseBonus = 0;
  let critBonus = 0;
  let damageBonus = 0;
  let strengthBonus = 0;
  let dexterityBonus = 0;
  let intuitionBonus = 0;
  let enduranceBonus = 0;
  let weaponMinDamage = 0;
  let weaponMaxDamage = 0;

  const slots: (Item | null)[] = [
    equipment.weapon,
    equipment.offhand,
    equipment.helmet,
    equipment.chest,
    equipment.gloves,
    equipment.boots,
    equipment.belt,
    equipment.ring1,
    equipment.ring2,
    equipment.necklace,
  ];

  for (const item of slots) {
    if (!item) continue;
    const b = item.statBonuses;
    hpBonus += b.hp || 0;
    armorTotal += b.armor || 0;
    defenseBonus += b.defense || 0;
    critBonus += b.critBonus || 0;
    damageBonus += b.damage || 0;
    strengthBonus += b.strength || 0;
    dexterityBonus += b.dexterity || 0;
    intuitionBonus += b.intuition || 0;
    enduranceBonus += b.endurance || 0;
  }

  if (equipment.weapon) {
    weaponMinDamage = equipment.weapon.minDamage || 0;
    weaponMaxDamage = equipment.weapon.maxDamage || 0;
  }

  return {
    hpBonus,
    armorTotal,
    defenseBonus,
    critBonus,
    damageBonus,
    strengthBonus,
    dexterityBonus,
    intuitionBonus,
    enduranceBonus,
    weaponMinDamage,
    weaponMaxDamage,
  };
}

// === Offhand detection ===

export function getOffhandType(equipment: EquipmentSlots): OffhandType {
  const off = equipment.offhand;
  if (!off) return 'none';
  // Prefer the explicit offhandType label if the item carries one (set by
  // the legacy NPC-item factory). On-chain items hydrated through
  // sui-read.ts::parseItemFromContent don't carry offhandType — the Move
  // Item struct only has item_type: u8. Fall back to itemType so shield
  // owners actually get 3 block slots and dual-wielders get 2 attack slots.
  if (off.offhandType === 'shield') return 'shield';
  if (off.offhandType === 'dual_wield') return 'dual_wield';
  // ITEM_TYPES.SHIELD = 2, ITEM_TYPES.WEAPON = 1 (weapon in offhand slot = dual wield).
  if (off.itemType === 2) return 'shield';
  if (off.itemType === 1) return 'dual_wield';
  return 'none';
}

// === Zone slot counts ===

export function getZoneCounts(offhand: OffhandType): { attackSlots: number; blockSlots: number } {
  switch (offhand) {
    case 'shield':
      return {
        attackSlots: GAME_CONSTANTS.DEFAULT_ATTACK_ZONES,
        blockSlots: GAME_CONSTANTS.SHIELD_BLOCK_ZONES,
      };
    case 'dual_wield':
      return {
        attackSlots: GAME_CONSTANTS.DUAL_WIELD_ATTACK_ZONES,
        blockSlots: GAME_CONSTANTS.DUAL_WIELD_BLOCK_ZONES,
      };
    default:
      return {
        attackSlots: GAME_CONSTANTS.DEFAULT_ATTACK_ZONES,
        blockSlots: GAME_CONSTANTS.DEFAULT_BLOCK_ZONES,
      };
  }
}

// === Derive combat stats (Fibonacci-based) ===

export function deriveCombatStats(
  character: Character,
  opponentStats?: CharacterStats,
  opponentEquipment?: EquipmentSlots
): DerivedStats {
  const equip = getEquipmentBonuses(character.equipment);

  const effectiveStr = character.stats.strength + equip.strengthBonus;
  const effectiveDex = character.stats.dexterity + equip.dexterityBonus;
  const effectiveInt = character.stats.intuition + equip.intuitionBonus;
  const effectiveEnd = character.stats.endurance + equip.enduranceBonus;

  // HP is purely level-based (Fibonacci scaling)
  const level = character.level;
  const maxHp = Math.max(1, (GAME_CONSTANTS.LEVEL_HP[level] || 40) + equip.hpBonus);

  // Base weapon damage from level, plus stat bonuses
  const baseWeaponDmg = GAME_CONSTANTS.LEVEL_WEAPON_DAMAGE[level] || 6;
  const weaponBonus = equip.weaponMinDamage > 0
    ? (equip.weaponMinDamage + equip.weaponMaxDamage) / 2
    : 0;
  const attackPower = baseWeaponDmg + weaponBonus
    + effectiveStr * GAME_CONSTANTS.STR_DAMAGE_BONUS
    + effectiveDex * GAME_CONSTANTS.DEX_DAMAGE_BONUS
    + equip.damageBonus;

  // Crit (from INT, reduced by opponent END)
  let opponentAntiCrit = 0;
  if (opponentStats) {
    const oppEquip = opponentEquipment ? getEquipmentBonuses(opponentEquipment) : { enduranceBonus: 0 };
    opponentAntiCrit = (opponentStats.endurance + oppEquip.enduranceBonus) * GAME_CONSTANTS.ANTI_CRIT_PER_ENDURANCE;
  }
  const critChance = Math.min(
    GAME_CONSTANTS.CRIT_CHANCE_CAP,
    effectiveInt * GAME_CONSTANTS.CRIT_CHANCE_PER_INTUITION - opponentAntiCrit
  );
  const critMultiplier = GAME_CONSTANTS.CRIT_MULTIPLIER_BASE
    + effectiveInt * GAME_CONSTANTS.CRIT_MULTIPLIER_PER_INTUITION
    + equip.critBonus;

  // Evasion (from DEX, reduced by opponent STR)
  let opponentAntiEvasion = 0;
  if (opponentStats) {
    const oppEquip = opponentEquipment ? getEquipmentBonuses(opponentEquipment) : { strengthBonus: 0 };
    opponentAntiEvasion = (opponentStats.strength + oppEquip.strengthBonus) * GAME_CONSTANTS.ANTI_EVASION_PER_STRENGTH;
  }
  const evasionChance = Math.min(
    GAME_CONSTANTS.EVASION_CAP,
    effectiveDex * GAME_CONSTANTS.EVASION_PER_DEXTERITY - opponentAntiEvasion
  );

  const armor = equip.armorTotal;
  const defense = Math.max(0, effectiveEnd * GAME_CONSTANTS.DEFENSE_PER_ENDURANCE + equip.defenseBonus);

  return {
    maxHp,
    attackPower,
    critChance: Math.max(0, critChance),
    critMultiplier,
    evasionChance: Math.max(0, evasionChance),
    armor,
    defense,
  };
}

// === Create a FighterState from a Character ===

export function createFighterState(character: Character, opponent: Character): FighterState {
  const derivedStats = deriveCombatStats(character, opponent.stats, opponent.equipment);
  return {
    characterId: character.id,
    walletAddress: character.walletAddress,
    currentHp: derivedStats.maxHp,
    maxHp: derivedStats.maxHp,
    derivedStats,
    character,
  };
}

// === Resolve a single attack ===

function resolveAttack(
  attackZone: Zone,
  defenderBlockZones: Zone[],
  attackerStats: DerivedStats,
  defenderStats: DerivedStats
): HitResult {
  if (defenderBlockZones.includes(attackZone)) {
    return { zone: attackZone, blocked: true, dodged: false, crit: false, damage: 0 };
  }

  const evasionRoll = Math.random() * 100;
  if (evasionRoll < defenderStats.evasionChance) {
    return { zone: attackZone, blocked: false, dodged: true, crit: false, damage: 0 };
  }

  const critRoll = Math.random() * 100;
  const isCrit = critRoll < attackerStats.critChance;

  // Damage: attackPower * random(0.8, 1.2), then flat armor+defense subtraction
  const rawDamage = attackerStats.attackPower * randomFloat(
    GAME_CONSTANTS.DAMAGE_RANGE_LOW,
    GAME_CONSTANTS.DAMAGE_RANGE_HIGH
  );

  let damage: number;
  if (isCrit) {
    const critDmg = rawDamage * attackerStats.critMultiplier;
    const effectiveArmor = defenderStats.armor * (1 - GAME_CONSTANTS.CRIT_ARMOR_PEN);
    damage = Math.max(1, critDmg - effectiveArmor - defenderStats.defense);
  } else {
    damage = Math.max(1, rawDamage - defenderStats.armor - defenderStats.defense);
  }

  return {
    zone: attackZone,
    blocked: false,
    dodged: false,
    crit: isCrit,
    damage: Math.round(damage * 100) / 100,
  };
}

// === Shield and block line helpers ===

export function isValidShieldLine(blockZones: Zone[]): boolean {
  if (blockZones.length !== 3) return false;
  const sorted = [...blockZones].sort();
  return GAME_CONSTANTS.SHIELD_BLOCK_LINES.some((line) => {
    const lineSorted = [...line].sort();
    return sorted[0] === lineSorted[0] && sorted[1] === lineSorted[1] && sorted[2] === lineSorted[2];
  });
}

export function getShieldLineFromCenter(center: Zone): Zone[] {
  const zones = GAME_CONSTANTS.ZONES;
  const len = zones.length;
  const idx = zones.indexOf(center);
  return [zones[idx], zones[(idx + 1) % len], zones[(idx + 2) % len]];
}

export function isValidBlockLine(blockZones: Zone[]): boolean {
  if (blockZones.length !== 2) return false;
  const sorted = [...blockZones].sort();
  return GAME_CONSTANTS.BLOCK_LINES.some((line) => {
    const lineSorted = [...line].sort();
    return sorted[0] === lineSorted[0] && sorted[1] === lineSorted[1];
  });
}

// === Validate a turn action ===

export function validateTurnAction(
  action: TurnAction,
  offhand: OffhandType
): { valid: boolean; error?: string } {
  const { attackSlots, blockSlots } = getZoneCounts(offhand);
  const allZones: Zone[] = ['head', 'chest', 'stomach', 'belt', 'legs'];

  if (action.attackZones.length !== attackSlots) {
    return { valid: false, error: `Expected ${attackSlots} attack zone(s), got ${action.attackZones.length}` };
  }
  if (action.blockZones.length !== blockSlots) {
    return { valid: false, error: `Expected ${blockSlots} block zone(s), got ${action.blockZones.length}` };
  }

  for (const z of action.attackZones) {
    if (!allZones.includes(z)) {
      return { valid: false, error: `Invalid attack zone: ${z}` };
    }
  }
  for (const z of action.blockZones) {
    if (!allZones.includes(z)) {
      return { valid: false, error: `Invalid block zone: ${z}` };
    }
  }

  // Shield: 3-zone adjacent line
  if (offhand === 'shield') {
    if (!isValidShieldLine(action.blockZones)) {
      return { valid: false, error: 'Shield blocks must be 3 adjacent zones (a line)' };
    }
  }

  // Normal weapon: 2-zone adjacent line
  if (offhand === 'none' && action.blockZones.length === 2) {
    if (!isValidBlockLine(action.blockZones)) {
      return { valid: false, error: 'Block zones must be 2 adjacent zones' };
    }
  }

  // Check for duplicate block zones
  const uniqueBlocks = new Set(action.blockZones);
  if (uniqueBlocks.size !== action.blockZones.length) {
    return { valid: false, error: 'Duplicate block zones' };
  }

  return { valid: true };
}

// === Generate a random turn action (for timeout default) ===

export function generateRandomAction(offhand: OffhandType): TurnAction {
  const { attackSlots } = getZoneCounts(offhand);
  const allZones: Zone[] = [...GAME_CONSTANTS.ZONES];

  const attackZones: Zone[] = [];
  for (let i = 0; i < attackSlots; i++) {
    attackZones.push(allZones[randomInt(0, allZones.length - 1)]);
  }

  let blockZones: Zone[];
  if (offhand === 'shield') {
    const lines = GAME_CONSTANTS.SHIELD_BLOCK_LINES;
    blockZones = [...lines[randomInt(0, lines.length - 1)]] as Zone[];
  } else if (offhand === 'dual_wield') {
    blockZones = [allZones[randomInt(0, allZones.length - 1)]];
  } else {
    // Normal: pick a random 2-adjacent block line
    const lines = GAME_CONSTANTS.BLOCK_LINES;
    blockZones = [...lines[randomInt(0, lines.length - 1)]] as Zone[];
  }

  return { attackZones, blockZones };
}

// === Resolve a full turn (simultaneous resolution) ===

export function resolveTurn(
  turnNumber: number,
  playerA: FighterState,
  playerB: FighterState,
  actionA: TurnAction,
  actionB: TurnAction
): TurnResult {
  const hitsOnB: HitResult[] = [];
  for (const attackZone of actionA.attackZones) {
    hitsOnB.push(resolveAttack(attackZone, actionB.blockZones, playerA.derivedStats, playerB.derivedStats));
  }

  const hitsOnA: HitResult[] = [];
  for (const attackZone of actionB.attackZones) {
    hitsOnA.push(resolveAttack(attackZone, actionA.blockZones, playerB.derivedStats, playerA.derivedStats));
  }

  let totalDamageOnA = 0;
  let totalDamageOnB = 0;
  for (const hit of hitsOnB) totalDamageOnB += hit.damage;
  for (const hit of hitsOnA) totalDamageOnA += hit.damage;

  playerA.currentHp = Math.max(0, Math.round((playerA.currentHp - totalDamageOnA) * 100) / 100);
  playerB.currentHp = Math.max(0, Math.round((playerB.currentHp - totalDamageOnB) * 100) / 100);

  return {
    turn: turnNumber,
    playerA: {
      playerId: playerA.characterId,
      actions: actionA,
      hits: hitsOnA,
      hpAfter: playerA.currentHp,
    },
    playerB: {
      playerId: playerB.characterId,
      actions: actionB,
      hits: hitsOnB,
      hpAfter: playerB.currentHp,
    },
  };
}

// === Check if fight is over ===

export function checkFightEnd(playerA: FighterState, playerB: FighterState): {
  finished: boolean;
  winner?: string;
  draw?: boolean;
} {
  const aDead = playerA.currentHp <= 0;
  const bDead = playerB.currentHp <= 0;

  if (aDead && bDead) return { finished: true, draw: true };
  if (aDead) return { finished: true, winner: playerB.characterId };
  if (bDead) return { finished: true, winner: playerA.characterId };
  return { finished: false };
}

// === XP and Leveling (cumulative — matches chain character.move::xp_for_level) ===

/**
 * Cumulative XP threshold to reach the given level. `level` is 1..MAX_LEVEL.
 * Returns Infinity for levels beyond the table so an out-of-range query can
 * never spuriously level a character up.
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > GAME_CONSTANTS.MAX_LEVEL) return Number.POSITIVE_INFINITY;
  const v = GAME_CONSTANTS.LEVEL_XP_CUMULATIVE[level - 1];
  return v ?? Number.POSITIVE_INFINITY;
}

/**
 * Cumulative XP threshold for the level a character is currently at. Used as
 * the lower bound of the in-level XP bar.
 */
export function xpForCurrentLevel(level: number): number {
  return xpForLevel(level);
}

/**
 * Cumulative XP threshold for the next level. Returns Infinity at MAX_LEVEL
 * so callers can render a "MAX" pill without divide-by-zero.
 */
export function xpForNextLevel(level: number): number {
  if (level >= GAME_CONSTANTS.MAX_LEVEL) return Number.POSITIVE_INFINITY;
  return xpForLevel(level + 1);
}

/**
 * Legacy alias — kept so any external import continues to resolve. Returns
 * the cumulative threshold for `level + 1` (i.e. the bar denominator at
 * `level`). Prefer `xpForNextLevel` in new code.
 */
export function xpToNextLevel(level: number): number {
  return xpForNextLevel(level);
}

/**
 * Add fight-earned XP (cumulative) and level the character up while thresholds
 * are crossed. Mirrors `character.move::update_after_fight`'s loop semantics:
 *   - XP is cumulative; never decremented on level-up.
 *   - Each level grants +STAT_POINTS_PER_LEVEL unallocated points.
 *   - Capped at MAX_LEVEL.
 */
export function applyXp(character: Character, xpGained: number): { leveledUp: boolean; newLevel: number; levelsGained: number } {
  if (xpGained < 0) xpGained = 0;
  character.xp += xpGained;
  let leveledUp = false;
  let levelsGained = 0;

  while (character.level < GAME_CONSTANTS.MAX_LEVEL) {
    const nextLevel = character.level + 1;
    const required = xpForLevel(nextLevel);
    if (character.xp >= required) {
      character.level = nextLevel;
      character.unallocatedPoints += GAME_CONSTANTS.STAT_POINTS_PER_LEVEL;
      leveledUp = true;
      levelsGained++;
    } else {
      break;
    }
  }

  return { leveledUp, newLevel: character.level, levelsGained };
}
