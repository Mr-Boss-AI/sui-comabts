import { v4 as uuidv4 } from 'uuid';
import type { Item, ItemType, Rarity } from '../types';

// === NPC Shop Catalog ===

function createShopItem(
  name: string,
  itemType: ItemType,
  rarity: Rarity,
  levelReq: number,
  price: number,
  statBonuses: Item['statBonuses'],
  extra?: Partial<Item>
): Item {
  return {
    id: uuidv4(),
    name,
    itemType,
    rarity,
    levelReq,
    statBonuses,
    price,
    shopAvailable: rarity <= 2, // Only Common and Uncommon purchasable
    ...extra,
  };
}

const SHOP_ITEMS: Item[] = [
  // === LEVEL 1 COMMON (stat budget: 1) ===
  createShopItem('Rusty Sword', 1, 1, 1, 50, { strength: 1 }, { minDamage: 1, maxDamage: 3 }),
  createShopItem('Wooden Staff', 1, 1, 1, 50, { intuition: 1 }, { minDamage: 1, maxDamage: 2 }),
  createShopItem('Worn Dagger', 1, 1, 1, 50, { dexterity: 1 }, { minDamage: 1, maxDamage: 3 }),
  createShopItem('Wooden Buckler', 2, 1, 1, 40, { endurance: 1 }, { offhandType: 'shield' }),
  createShopItem('Sharpened Stick', 2, 1, 1, 40, { dexterity: 1 }, { offhandType: 'dual_wield', minDamage: 1, maxDamage: 2 }),
  createShopItem('Cloth Cap', 3, 1, 1, 30, { endurance: 1 }),
  createShopItem('Padded Vest', 4, 1, 1, 40, { armor: 1 }),
  createShopItem('Cloth Wraps', 5, 1, 1, 25, { strength: 1 }),
  createShopItem('Leather Boots', 6, 1, 1, 30, { dexterity: 1 }),
  createShopItem('Rope Belt', 7, 1, 1, 20, { endurance: 1 }),
  createShopItem('Copper Band', 8, 1, 1, 25, { strength: 1 }),
  createShopItem('Shell Pendant', 9, 1, 1, 25, { intuition: 1 }),

  // === LEVEL 1 UNCOMMON (stat budget: 2) ===
  createShopItem('Short Sword', 1, 2, 1, 100, { strength: 1, damage: 1 }, { minDamage: 2, maxDamage: 4 }),
  createShopItem('Leather Cap', 3, 2, 1, 80, { endurance: 1, armor: 1 }),
  createShopItem('Leather Vest', 4, 2, 1, 90, { armor: 1, endurance: 1 }),
  createShopItem('Worn Sandals', 6, 2, 1, 70, { dexterity: 1, armor: 1 }),

  // === LEVEL 3 COMMON (stat budget: 3) ===
  createShopItem('Steel Longsword', 1, 1, 3, 200, { strength: 2, damage: 1 }, { minDamage: 3, maxDamage: 6 }),
  createShopItem('Iron Mace', 1, 1, 3, 200, { strength: 3 }, { minDamage: 2, maxDamage: 5 }),
  createShopItem('Iron Kite Shield', 2, 1, 3, 180, { endurance: 2, armor: 1 }, { offhandType: 'shield' }),
  createShopItem('Iron Helm', 3, 1, 3, 150, { endurance: 2, armor: 1 }),
  createShopItem('Chainmail Shirt', 4, 1, 3, 250, { armor: 2, endurance: 1 }),

  // === LEVEL 3 UNCOMMON (stat budget: 5) ===
  createShopItem('Hunters Bow', 1, 2, 3, 400, { dexterity: 3, intuition: 2 }, { minDamage: 4, maxDamage: 8 }),
  createShopItem('Steel Dirk', 2, 2, 3, 380, { dexterity: 2, strength: 2, damage: 1 }, { offhandType: 'dual_wield', minDamage: 3, maxDamage: 5 }),
  createShopItem('Studded Bracers', 5, 2, 3, 300, { strength: 2, dexterity: 2, armor: 1 }),
  createShopItem('Travelers Boots', 6, 2, 3, 320, { dexterity: 3, armor: 2 }),
  createShopItem('Silver Signet', 8, 2, 3, 350, { intuition: 3, critBonus: 2 }),

  // === LEVEL 5 RARE (stat budget: 13, not purchasable) ===
  createShopItem('Enchanted Saber', 1, 3, 5, 0, { strength: 5, intuition: 3, damage: 5 }, { minDamage: 8, maxDamage: 14, shopAvailable: false }),
  createShopItem('Mithril Breastplate', 4, 3, 5, 0, { armor: 6, endurance: 4, defense: 3 }, { shopAvailable: false }),
  createShopItem('Swiftwind Treads', 6, 3, 5, 0, { dexterity: 6, armor: 4, endurance: 3 }, { shopAvailable: false }),
  createShopItem('Emerald Loop', 8, 3, 5, 0, { intuition: 6, dexterity: 4, critBonus: 3 }, { shopAvailable: false }),
  createShopItem('Tower Shield', 2, 3, 5, 0, { armor: 5, defense: 4, endurance: 4 }, { offhandType: 'shield', shopAvailable: false }),
];

// === Export Functions ===

export function getShopCatalog(): Item[] {
  return SHOP_ITEMS.map((item) => ({ ...item }));
}

export function getPurchasableItems(): Item[] {
  return SHOP_ITEMS.filter((item) => item.shopAvailable).map((item) => ({ ...item }));
}

export function getShopItemById(itemId: string): Item | undefined {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  return item ? { ...item } : undefined;
}

export function purchaseShopItem(itemId: string): { item: Item | null; error?: string } {
  const template = SHOP_ITEMS.find((i) => i.id === itemId);
  if (!template) {
    return { item: null, error: 'Item not found in shop' };
  }
  if (!template.shopAvailable) {
    return { item: null, error: 'This item is not available for purchase' };
  }
  if (!template.price || template.price <= 0) {
    return { item: null, error: 'Item has no valid price' };
  }

  const playerItem: Item = {
    ...template,
    id: uuidv4(),
    price: undefined,
    shopAvailable: undefined,
  };

  return { item: playerItem };
}

export function getShopItemPrice(itemId: string): number {
  const item = SHOP_ITEMS.find((i) => i.id === itemId);
  return item?.price || 0;
}
