import { v4 as uuidv4 } from 'uuid';
import { GAME_CONSTANTS } from '../config';
import type { Item, ItemType, Rarity, StatBonuses } from '../types';

// === Loot Box Drop Logic ===

/**
 * Roll for loot after a fight win.
 * Returns null if nothing dropped.
 */
export function rollLoot(playerLevel: number): Item | null {
  const roll = Math.random() * 100;

  let rarity: Rarity;
  if (roll < GAME_CONSTANTS.LOOT_LEGENDARY_CHANCE) {
    rarity = 5; // Legendary
  } else if (roll < GAME_CONSTANTS.LOOT_LEGENDARY_CHANCE + GAME_CONSTANTS.LOOT_EPIC_CHANCE) {
    rarity = 4; // Epic
  } else if (
    roll <
    GAME_CONSTANTS.LOOT_LEGENDARY_CHANCE + GAME_CONSTANTS.LOOT_EPIC_CHANCE + GAME_CONSTANTS.LOOT_RARE_CHANCE
  ) {
    rarity = 3; // Rare
  } else if (
    roll <
    GAME_CONSTANTS.LOOT_LEGENDARY_CHANCE +
      GAME_CONSTANTS.LOOT_EPIC_CHANCE +
      GAME_CONSTANTS.LOOT_RARE_CHANCE +
      GAME_CONSTANTS.LOOT_UNCOMMON_CHANCE
  ) {
    rarity = 2; // Uncommon
  } else if (
    roll <
    GAME_CONSTANTS.LOOT_LEGENDARY_CHANCE +
      GAME_CONSTANTS.LOOT_EPIC_CHANCE +
      GAME_CONSTANTS.LOOT_RARE_CHANCE +
      GAME_CONSTANTS.LOOT_UNCOMMON_CHANCE +
      GAME_CONSTANTS.LOOT_COMMON_CHANCE
  ) {
    rarity = 1; // Common
  } else {
    return null; // Nothing
  }

  return generateRandomItem(rarity, playerLevel);
}

// === Random Item Generation ===

const ITEM_TYPE_POOL: ItemType[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const WEAPON_NAMES: Record<Rarity, string[]> = {
  1: ['Rusty Blade', 'Wooden Club', 'Dull Dagger', 'Bent Shortsword'],
  2: ['Steel Longsword', 'Iron Mace', 'Hunters Bow', 'Soldiers Spear'],
  3: ['Enchanted Saber', 'Moonlit Katana', 'Flamebrand', 'Thunderstrike Axe'],
  4: ['Dragonbone Greatsword', 'Void Reaver', 'Stormcaller', 'Demonbane'],
  5: ['Sword of the Sui Sovereign', 'Worldbreaker', 'Eternity Edge', 'Cosmic Cleaver'],
};

const OFFHAND_NAMES: Record<Rarity, string[]> = {
  1: ['Wooden Buckler', 'Worn Parrying Dagger'],
  2: ['Iron Kite Shield', 'Steel Dirk'],
  3: ['Enchanted Tower Shield', 'Shadow Stiletto'],
  4: ['Aegis of the Fallen', 'Voidtouched Blade'],
  5: ['Bulwark of Ages', 'Phantom Twin'],
};

const HELMET_NAMES: Record<Rarity, string[]> = {
  1: ['Leather Cap', 'Cloth Hood'],
  2: ['Iron Helm', 'Chainmail Coif'],
  3: ['Mithril Crown', 'Wardens Visage'],
  4: ['Helm of Dominion', 'Dragonscale Helm'],
  5: ['Crown of the Blockchain King', 'Eternal Diadem'],
};

const CHEST_NAMES: Record<Rarity, string[]> = {
  1: ['Padded Vest', 'Leather Jerkin'],
  2: ['Chainmail Hauberk', 'Studded Leather'],
  3: ['Mithril Breastplate', 'Enchanted Cuirass'],
  4: ['Dragonhide Armor', 'Voidweave Robe'],
  5: ['Chestguard of the Cosmos', 'Sui Eternal Plate'],
};

const GLOVE_NAMES: Record<Rarity, string[]> = {
  1: ['Cloth Wraps', 'Leather Gloves'],
  2: ['Iron Gauntlets', 'Studded Bracers'],
  3: ['Mithril Grips', 'Flamewoven Gloves'],
  4: ['Dragonscale Gauntlets', 'Voidgrip Fists'],
  5: ['Hands of Destiny', 'Infinite Grasp'],
};

const BOOT_NAMES: Record<Rarity, string[]> = {
  1: ['Worn Sandals', 'Leather Boots'],
  2: ['Iron Greaves', 'Travelers Boots'],
  3: ['Swiftwind Treads', 'Mithril Sabatons'],
  4: ['Boots of the Phantom', 'Dragonhide Striders'],
  5: ['Celestial Walkers', 'Eternal Stride'],
};

const BELT_NAMES: Record<Rarity, string[]> = {
  1: ['Rope Belt', 'Leather Strap'],
  2: ['Iron Buckle Belt', 'Chainlink Girdle'],
  3: ['Mithril Cinch', 'Enchanted Sash'],
  4: ['Dragonbone Waistguard', 'Void Binding'],
  5: ['Belt of Infinite Power', 'Cosmic Girdle'],
};

const RING_NAMES: Record<Rarity, string[]> = {
  1: ['Copper Band', 'Wooden Ring'],
  2: ['Silver Ring', 'Iron Signet'],
  3: ['Emerald Loop', 'Ruby Circlet'],
  4: ['Dragon Eye Ring', 'Void Band'],
  5: ['Ring of the Sui Sovereign', 'Eternity Loop'],
};

const NECKLACE_NAMES: Record<Rarity, string[]> = {
  1: ['Leather Cord', 'Shell Pendant'],
  2: ['Silver Chain', 'Iron Amulet'],
  3: ['Sapphire Pendant', 'Enchanted Locket'],
  4: ['Dragon Fang Necklace', 'Void Amulet'],
  5: ['Chain of the Cosmos', 'Necklace of Eternity'],
};

const NAME_MAP: Record<ItemType, Record<Rarity, string[]>> = {
  1: WEAPON_NAMES,
  2: OFFHAND_NAMES,
  3: HELMET_NAMES,
  4: CHEST_NAMES,
  5: GLOVE_NAMES,
  6: BOOT_NAMES,
  7: BELT_NAMES,
  8: RING_NAMES,
  9: NECKLACE_NAMES,
};

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Stat multiplier per rarity
const RARITY_MULTIPLIER: Record<Rarity, number> = {
  1: 1.0,
  2: 1.8,
  3: 3.0,
  4: 5.0,
  5: 8.0,
};

function generateStatBonuses(itemType: ItemType, rarity: Rarity, level: number): StatBonuses {
  const mult = RARITY_MULTIPLIER[rarity];
  const baseVal = Math.max(1, Math.floor((level / 5 + 1) * mult));

  const bonuses: StatBonuses = {};

  switch (itemType) {
    case 1: // Weapon - damage focus
      bonuses.strength = randomInt(1, Math.ceil(baseVal * 0.5));
      bonuses.damage = randomInt(1, Math.ceil(baseVal * 0.3));
      if (rarity >= 3) bonuses.intuition = randomInt(1, Math.ceil(baseVal * 0.3));
      break;
    case 2: // Offhand - defense or damage
      bonuses.armor = randomInt(1, Math.ceil(baseVal * 0.6));
      bonuses.defense = randomInt(1, Math.ceil(baseVal * 0.4));
      if (rarity >= 3) bonuses.endurance = randomInt(1, Math.ceil(baseVal * 0.3));
      break;
    case 3: // Helmet - HP and defense
      bonuses.hp = randomInt(5, Math.ceil(baseVal * 3));
      bonuses.endurance = randomInt(1, Math.ceil(baseVal * 0.4));
      if (rarity >= 3) bonuses.armor = randomInt(1, Math.ceil(baseVal * 0.3));
      break;
    case 4: // Chest - primary armor
      bonuses.armor = randomInt(2, Math.ceil(baseVal * 0.8));
      bonuses.hp = randomInt(5, Math.ceil(baseVal * 2));
      bonuses.endurance = randomInt(1, Math.ceil(baseVal * 0.3));
      break;
    case 5: // Gloves - mixed offense
      bonuses.strength = randomInt(1, Math.ceil(baseVal * 0.4));
      bonuses.dexterity = randomInt(1, Math.ceil(baseVal * 0.4));
      if (rarity >= 2) bonuses.armor = randomInt(1, Math.ceil(baseVal * 0.2));
      break;
    case 6: // Boots - evasion
      bonuses.dexterity = randomInt(1, Math.ceil(baseVal * 0.5));
      bonuses.armor = randomInt(1, Math.ceil(baseVal * 0.3));
      if (rarity >= 3) bonuses.hp = randomInt(3, Math.ceil(baseVal * 1.5));
      break;
    case 7: // Belt - endurance
      bonuses.endurance = randomInt(1, Math.ceil(baseVal * 0.5));
      bonuses.hp = randomInt(3, Math.ceil(baseVal * 2));
      if (rarity >= 2) bonuses.defense = randomInt(1, Math.ceil(baseVal * 0.2));
      break;
    case 8: // Ring - varied stats
      bonuses.strength = randomInt(0, Math.ceil(baseVal * 0.3));
      bonuses.dexterity = randomInt(0, Math.ceil(baseVal * 0.3));
      bonuses.intuition = randomInt(0, Math.ceil(baseVal * 0.3));
      if (rarity >= 3) bonuses.critBonus = parseFloat((Math.random() * 0.1 * mult).toFixed(3));
      break;
    case 9: // Necklace - special bonuses
      bonuses.intuition = randomInt(1, Math.ceil(baseVal * 0.4));
      bonuses.hp = randomInt(3, Math.ceil(baseVal * 1.5));
      if (rarity >= 2) bonuses.critBonus = parseFloat((Math.random() * 0.05 * mult).toFixed(3));
      if (rarity >= 4) bonuses.damage = randomInt(1, Math.ceil(baseVal * 0.2));
      break;
  }

  return bonuses;
}

function generateWeaponDamage(rarity: Rarity, level: number): { minDamage: number; maxDamage: number } {
  const mult = RARITY_MULTIPLIER[rarity];
  const baseDamage = Math.max(3, Math.floor((level / 3 + 2) * mult));
  const minDamage = Math.max(1, baseDamage - randomInt(1, Math.ceil(baseDamage * 0.3)));
  const maxDamage = baseDamage + randomInt(1, Math.ceil(baseDamage * 0.4));
  return { minDamage, maxDamage };
}

export function generateRandomItem(rarity: Rarity, playerLevel: number): Item {
  const itemType = randomFrom(ITEM_TYPE_POOL);
  const names = NAME_MAP[itemType][rarity];
  const name = randomFrom(names);
  const levelReq = Math.max(1, playerLevel - randomInt(0, 3));
  const statBonuses = generateStatBonuses(itemType, rarity, playerLevel);

  const item: Item = {
    id: uuidv4(),
    name,
    itemType,
    rarity,
    levelReq,
    statBonuses,
  };

  if (itemType === 1) {
    const { minDamage, maxDamage } = generateWeaponDamage(rarity, playerLevel);
    item.minDamage = minDamage;
    item.maxDamage = maxDamage;
  }

  if (itemType === 2) {
    // 50/50 shield or dual wield offhand
    item.offhandType = Math.random() < 0.5 ? 'shield' : 'dual_wield';
  }

  return item;
}
