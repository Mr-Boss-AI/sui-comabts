import { v4 as uuidv4 } from 'uuid';
import { GAME_CONSTANTS } from '../config';
import { dbSaveCharacter, dbLoadCharacter, dbDeleteCharacter, dbSaveItems, dbLoadItems } from './db';
import type { Character, CharacterStats, EquipmentSlots, FightHistoryEntry, Item, ItemType } from '../types';

// === In-Memory Character Store ===

const characters = new Map<string, Character>();
// Index by wallet address for quick lookup
const walletToCharacter = new Map<string, string>();
// Fight history per character
const fightHistories = new Map<string, FightHistoryEntry[]>();

export function getCharacterById(id: string): Character | undefined {
  return characters.get(id);
}

export function getCharacterByWallet(walletAddress: string): Character | undefined {
  const charId = walletToCharacter.get(walletAddress);
  if (!charId) return undefined;
  return characters.get(charId);
}

/**
 * Try to restore a character from Supabase into the in-memory store.
 * Called during auth when the character isn't already in memory.
 */
export async function restoreCharacterFromDb(walletAddress: string): Promise<Character | null> {
  // Already in memory?
  const existing = getCharacterByWallet(walletAddress);
  if (existing) return existing;

  const row = await dbLoadCharacter(walletAddress);
  if (!row) return null;

  // Re-check after async gap (another call may have restored while we waited)
  const existingAfterLoad = getCharacterByWallet(walletAddress);
  if (existingAfterLoad) return existingAfterLoad;

  const id = uuidv4();

  const emptyEquipment: EquipmentSlots = {
    weapon: null, offhand: null, helmet: null, chest: null,
    gloves: null, boots: null, belt: null, ring1: null, ring2: null, necklace: null,
  };

  const character: Character = {
    id,
    name: row.name,
    level: row.level,
    xp: row.xp,
    walletAddress,
    stats: {
      strength: row.strength,
      dexterity: row.dexterity,
      intuition: row.intuition,
      endurance: row.endurance,
    },
    equipment: emptyEquipment,
    inventory: [],
    gold: row.gold,
    wins: row.wins,
    losses: row.losses,
    rating: row.rating,
    unallocatedPoints: row.unallocated_points || 0,
    onChainObjectId: row.onchain_character_id ?? undefined,
    fightHistory: [],
    createdAt: new Date(row.created_at).getTime(),
  };

  // Retroactively compute unallocated points if DB didn't have them
  // Total possible = 20 (starting) + (level - 1) * 3
  // Currently allocated = sum of stats
  // Unallocated = total_possible - currently_allocated
  if (character.unallocatedPoints === 0 && character.level > 1) {
    const totalPossible = GAME_CONSTANTS.STARTING_STAT_POINTS
      + (character.level - 1) * GAME_CONSTANTS.STAT_POINTS_PER_LEVEL;
    const allocated = character.stats.strength + character.stats.dexterity
      + character.stats.intuition + character.stats.endurance;
    const retroactive = Math.max(0, totalPossible - allocated);
    if (retroactive > 0) {
      character.unallocatedPoints = retroactive;
      console.log(`[DB] Retroactive unallocated points for "${character.name}": ${retroactive} (level ${character.level}, stats total ${allocated}/${totalPossible})`);
    }
  }

  // Restore items from DB
  const { inventory, equipment } = await dbLoadItems(walletAddress);
  character.inventory = inventory;
  for (const [slot, item] of Object.entries(equipment)) {
    if (item) {
      (character.equipment as unknown as Record<string, Item | null>)[slot] = item;
    }
  }

  // Store in memory
  characters.set(id, character);
  walletToCharacter.set(walletAddress, id);
  fightHistories.set(id, []);

  console.log(`[DB] Restored character "${character.name}" for ${walletAddress.slice(0, 10)}...`);
  return character;
}

export function createCharacter(
  walletAddress: string,
  name: string,
  stats: CharacterStats
): { character: Character | null; error?: string } {
  // Check if wallet already has a character
  if (walletToCharacter.has(walletAddress)) {
    return { character: null, error: 'Wallet already has a character' };
  }

  // Validate name
  if (!name || name.length < 2 || name.length > 20) {
    return { character: null, error: 'Name must be between 2 and 20 characters' };
  }

  // Validate stat allocation (only for fresh creates — not restoration)
  const totalStats = stats.strength + stats.dexterity + stats.intuition + stats.endurance;
  if (totalStats !== GAME_CONSTANTS.STARTING_STAT_POINTS) {
    return {
      character: null,
      error: `Stats must sum to ${GAME_CONSTANTS.STARTING_STAT_POINTS}, got ${totalStats}`,
    };
  }

  const minStat = GAME_CONSTANTS.MIN_STAT;
  if (stats.strength < minStat || stats.dexterity < minStat || stats.intuition < minStat || stats.endurance < minStat) {
    return { character: null, error: `Each stat must be at least ${minStat}` };
  }

  const emptyEquipment: EquipmentSlots = {
    weapon: null, offhand: null, helmet: null, chest: null,
    gloves: null, boots: null, belt: null, ring1: null, ring2: null, necklace: null,
  };

  const id = uuidv4();
  const character: Character = {
    id,
    name,
    level: 1,
    xp: 0,
    walletAddress,
    stats,
    equipment: emptyEquipment,
    inventory: [],
    gold: GAME_CONSTANTS.STARTING_GOLD,
    wins: 0,
    losses: 0,
    rating: GAME_CONSTANTS.DEFAULT_RATING,
    unallocatedPoints: 0,
    fightHistory: [],
    createdAt: Date.now(),
  };

  characters.set(id, character);
  walletToCharacter.set(walletAddress, id);
  fightHistories.set(id, []);

  // Persist to Supabase (fire-and-forget)
  dbSaveCharacter(character).catch(() => {});

  return { character };
}

/**
 * Restore a server-side character record from authoritative on-chain data.
 * Skips stat-sum validation (chain may have allocated points above the L1 budget).
 * Returns the existing character if the wallet is already registered.
 */
export function restoreCharacterFromChain(
  walletAddress: string,
  name: string,
  stats: CharacterStats,
  level: number,
  xp: number,
  unallocatedPoints: number,
  wins: number,
  losses: number,
  rating: number,
  onChainObjectId?: string,
): { character: Character | null; error?: string } {
  // Idempotent: return existing server record if already registered. If the
  // existing record is missing the on-chain id (legacy row) and the caller
  // supplied one, backfill it so subsequent admin calls hit the right NFT.
  if (walletToCharacter.has(walletAddress)) {
    const existing = characters.get(walletToCharacter.get(walletAddress)!);
    if (!existing) return { character: null, error: 'Stale wallet index' };
    if (!existing.onChainObjectId && onChainObjectId) {
      existing.onChainObjectId = onChainObjectId;
      dbSaveCharacter(existing).catch(() => {});
    }
    return { character: existing };
  }

  const emptyEquipment: EquipmentSlots = {
    weapon: null, offhand: null, helmet: null, chest: null,
    gloves: null, boots: null, belt: null, ring1: null, ring2: null, necklace: null,
  };

  const id = uuidv4();
  const character: Character = {
    id,
    name,
    level,
    xp,
    walletAddress,
    stats,
    equipment: emptyEquipment,
    inventory: [],
    gold: GAME_CONSTANTS.STARTING_GOLD,
    wins,
    losses,
    rating,
    unallocatedPoints,
    onChainObjectId,
    fightHistory: [],
    createdAt: Date.now(),
  };

  characters.set(id, character);
  walletToCharacter.set(walletAddress, id);
  fightHistories.set(id, []);

  dbSaveCharacter(character).catch(() => {});

  console.log(`[Character] Restored from chain: "${character.name}" lvl ${level} for ${walletAddress.slice(0, 10)}... (onChain ${onChainObjectId ? onChainObjectId.slice(0, 10) + '...' : 'unknown'})`);
  return { character };
}

/** Pin or update the on-chain object id for an existing server-side
 *  character. Used by the auth handler when DOF hydration discovers the
 *  canonical NFT id but the in-memory record was created before this
 *  field existed. Idempotent — no-op when the id is already correct. */
export function setOnChainObjectId(walletAddress: string, onChainObjectId: string): void {
  const character = getCharacterByWallet(walletAddress);
  if (!character) return;
  if (character.onChainObjectId === onChainObjectId) return;
  character.onChainObjectId = onChainObjectId;
  dbSaveCharacter(character).catch(() => {});
}

export function deleteCharacter(walletAddress: string): boolean {
  const charId = walletToCharacter.get(walletAddress);
  if (!charId) return false;

  characters.delete(charId);
  walletToCharacter.delete(walletAddress);
  fightHistories.delete(charId);

  // Delete from Supabase (fire-and-forget)
  dbDeleteCharacter(walletAddress).catch(() => {});

  console.log(`[Character] Deleted character for ${walletAddress.slice(0, 10)}...`);
  return true;
}

export function updateCharacter(character: Character): void {
  characters.set(character.id, character);
  // Persist to Supabase (fire-and-forget)
  dbSaveCharacter(character).catch(() => {});
}

/** Save items to DB after equipment/inventory changes. Fire-and-forget. */
export function persistItems(character: Character): void {
  dbSaveItems(character).catch(() => {});
}

export function addToInventory(characterId: string, item: Item): boolean {
  const character = characters.get(characterId);
  if (!character) return false;
  character.inventory.push(item);
  return true;
}

export function removeFromInventory(characterId: string, itemId: string): Item | null {
  const character = characters.get(characterId);
  if (!character) return null;
  const idx = character.inventory.findIndex((i) => i.id === itemId);
  if (idx === -1) return null;
  const [item] = character.inventory.splice(idx, 1);
  return item;
}

function getEquipSlotKey(itemType: ItemType): keyof EquipmentSlots | null {
  const mapping: Record<number, keyof EquipmentSlots> = {
    1: 'weapon',
    2: 'offhand',
    3: 'helmet',
    4: 'chest',
    5: 'gloves',
    6: 'boots',
    7: 'belt',
    // 8 = ring (special: ring1 or ring2)
    9: 'necklace',
  };
  return mapping[itemType] || null;
}

export function equipItem(
  characterId: string,
  itemId: string
): { success: boolean; error?: string } {
  const character = characters.get(characterId);
  if (!character) return { success: false, error: 'Character not found' };

  const itemIdx = character.inventory.findIndex((i) => i.id === itemId);
  if (itemIdx === -1) return { success: false, error: 'Item not in inventory' };

  const item = character.inventory[itemIdx];

  if (item.levelReq > character.level) {
    return { success: false, error: `Requires level ${item.levelReq}` };
  }

  let slotKey: keyof EquipmentSlots | null;

  if (item.itemType === 8) {
    // Ring: try ring1 first, then ring2
    if (!character.equipment.ring1) {
      slotKey = 'ring1';
    } else if (!character.equipment.ring2) {
      slotKey = 'ring2';
    } else {
      // Both full: swap ring1 out
      const oldRing = character.equipment.ring1;
      character.equipment.ring1 = null;
      character.inventory.push(oldRing);
      slotKey = 'ring1';
    }
  } else {
    slotKey = getEquipSlotKey(item.itemType);
  }

  if (!slotKey) return { success: false, error: 'Invalid item type' };

  // Unequip existing item in that slot
  const existing = character.equipment[slotKey];
  if (existing) {
    character.inventory.push(existing);
  }

  // Re-find item index (inventory may have changed)
  const currentItemIdx = character.inventory.findIndex((i) => i.id === itemId);
  if (currentItemIdx === -1) return { success: false, error: 'Item not in inventory' };

  // Equip new item
  character.equipment[slotKey] = item;
  character.inventory.splice(currentItemIdx, 1);

  // Persist items to DB
  persistItems(character);

  return { success: true };
}

export function unequipItem(
  characterId: string,
  slot: keyof EquipmentSlots
): { success: boolean; error?: string } {
  const character = characters.get(characterId);
  if (!character) return { success: false, error: 'Character not found' };

  const item = character.equipment[slot];
  if (!item) return { success: false, error: 'No item in that slot' };

  character.equipment[slot] = null;
  character.inventory.push(item);

  // Persist items to DB
  persistItems(character);

  return { success: true };
}

export function addFightHistory(characterId: string, entry: FightHistoryEntry): void {
  const history = fightHistories.get(characterId);
  if (history) {
    history.unshift(entry); // newest first
    if (history.length > 50) history.pop(); // keep last 50
  }
  const character = characters.get(characterId);
  if (character) {
    character.fightHistory.unshift(entry.fightId);
    if (character.fightHistory.length > 50) character.fightHistory.pop();
  }
}

export function getFightHistory(characterId: string): FightHistoryEntry[] {
  return fightHistories.get(characterId) || [];
}

export function getAllCharacters(): Character[] {
  return Array.from(characters.values());
}

export function getCharacterCount(): number {
  return characters.size;
}
