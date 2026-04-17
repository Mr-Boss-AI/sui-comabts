/**
 * Supabase persistence layer for SUI Combats.
 *
 * All writes are fire-and-forget (async, non-blocking) so the game loop
 * is never stalled by DB latency.  Reads happen once at login.
 */

import { getSupabase } from './supabase';
import type { Character, FightHistoryEntry, Item, EquipmentSlots } from '../types';

// ─── Character persistence ──────────────────────────────────────────

export interface DbCharacter {
  wallet_address: string;
  name: string;
  strength: number;
  dexterity: number;
  intuition: number;
  endurance: number;
  level: number;
  xp: number;
  gold: number;
  rating: number;
  wins: number;
  losses: number;
  unallocated_points?: number;
  created_at: string;
}

/** Save a character to Supabase (upsert by wallet). */
export async function dbSaveCharacter(char: Character): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const row: DbCharacter = {
    wallet_address: char.walletAddress,
    name: char.name,
    strength: char.stats.strength,
    dexterity: char.stats.dexterity,
    intuition: char.stats.intuition,
    endurance: char.stats.endurance,
    level: char.level,
    xp: char.xp,
    gold: char.gold,
    rating: char.rating,
    wins: char.wins,
    losses: char.losses,
    unallocated_points: char.unallocatedPoints,
    created_at: new Date(char.createdAt).toISOString(),
  };

  const { error } = await sb
    .from('characters')
    .upsert(row, { onConflict: 'wallet_address' });

  if (error) {
    console.error('[DB] Failed to save character:', error.message);
  }
}

/** Load a character row from Supabase by wallet. Returns null if not found. */
export async function dbLoadCharacter(walletAddress: string): Promise<DbCharacter | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from('characters')
    .select('*')
    .eq('wallet_address', walletAddress)
    .maybeSingle();

  if (error) {
    console.error('[DB] Failed to load character:', error.message);
    return null;
  }

  return data as DbCharacter | null;
}

/** Delete a character and their items from Supabase. */
export async function dbDeleteCharacter(walletAddress: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  // Delete items first (foreign key constraint)
  await sb.from('items').delete().eq('owner_wallet', walletAddress);
  // Delete character
  const { error } = await sb.from('characters').delete().eq('wallet_address', walletAddress);
  if (error) {
    console.error('[DB] Failed to delete character:', error.message);
  } else {
    console.log(`[DB] Deleted character for ${walletAddress.slice(0, 10)}...`);
  }
}

// ─── Fight history ──────────────────────────────────────────────────

export interface DbFightHistory {
  id: string;
  winner_wallet: string;
  loser_wallet: string;
  turns: number;
  fight_type: string;
  winner_xp: number;
  loser_xp: number;
  winner_elo_change: number;
  loser_elo_change: number;
  created_at: string;
}

/** Save a fight record to Supabase. */
export async function dbSaveFight(
  fightId: string,
  winnerWallet: string,
  loserWallet: string,
  turns: number,
  fightType: string,
  winnerXp: number,
  loserXp: number,
  winnerEloChange: number,
  loserEloChange: number,
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const row: DbFightHistory = {
    id: fightId,
    winner_wallet: winnerWallet,
    loser_wallet: loserWallet,
    turns,
    fight_type: fightType,
    winner_xp: winnerXp,
    loser_xp: loserXp,
    winner_elo_change: winnerEloChange,
    loser_elo_change: loserEloChange,
    created_at: new Date().toISOString(),
  };

  const { error } = await sb.from('fight_history').insert(row);

  if (error) {
    console.error('[DB] Failed to save fight:', error.message);
  }
}

/** Load recent fight history for a wallet (as winner or loser). */
export async function dbLoadFightHistory(walletAddress: string, limit = 50): Promise<DbFightHistory[]> {
  const sb = getSupabase();
  if (!sb) return [];

  const { data, error } = await sb
    .from('fight_history')
    .select('*')
    .or(`winner_wallet.eq.${walletAddress},loser_wallet.eq.${walletAddress}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('[DB] Failed to load fight history:', error.message);
    return [];
  }

  return (data as DbFightHistory[]) || [];
}

// ─── Items inventory ────────────────────────────────────────────────

export interface DbItem {
  id: string;
  owner_wallet: string;
  item_name: string;
  item_type: number;
  rarity: number;
  level_req: number;
  strength: number;
  dexterity: number;
  intuition: number;
  endurance: number;
  hp: number;
  armor: number;
  defense: number;
  attack: number;
  crit_chance: number;
  crit_multiplier: number;
  evasion: number;
  anti_crit: number;
  anti_evasion: number;
  damage_min: number;
  damage_max: number;
  image_url: string | null;
  equipped_slot: string | null;
  is_onchain: boolean;
  onchain_id: string | null;
  created_at: string;
}

function itemToDbRow(item: Item, ownerWallet: string, equippedSlot: string | null): DbItem {
  return {
    id: item.id,
    owner_wallet: ownerWallet,
    item_name: item.name,
    item_type: item.itemType,
    rarity: item.rarity,
    level_req: item.levelReq,
    strength: item.statBonuses.strength || 0,
    dexterity: item.statBonuses.dexterity || 0,
    intuition: item.statBonuses.intuition || 0,
    endurance: item.statBonuses.endurance || 0,
    hp: item.statBonuses.hp || 0,
    armor: item.statBonuses.armor || 0,
    defense: item.statBonuses.defense || 0,
    attack: item.statBonuses.damage || 0,
    crit_chance: item.statBonuses.critBonus || 0,
    crit_multiplier: 0,
    evasion: 0,
    anti_crit: 0,
    anti_evasion: 0,
    damage_min: item.minDamage || 0,
    damage_max: item.maxDamage || 0,
    image_url: null,
    equipped_slot: equippedSlot,
    is_onchain: false,
    onchain_id: null,
    created_at: new Date().toISOString(),
  };
}

function dbRowToItem(row: DbItem): Item {
  return {
    id: row.id,
    name: row.item_name,
    itemType: row.item_type as Item['itemType'],
    rarity: row.rarity as Item['rarity'],
    levelReq: row.level_req,
    statBonuses: {
      strength: row.strength || undefined,
      dexterity: row.dexterity || undefined,
      intuition: row.intuition || undefined,
      endurance: row.endurance || undefined,
      hp: row.hp || undefined,
      armor: row.armor || undefined,
      defense: row.defense || undefined,
      damage: row.attack || undefined,
      critBonus: row.crit_chance || undefined,
    },
    minDamage: row.damage_min,
    maxDamage: row.damage_max,
    price: undefined,
    shopAvailable: false,
  };
}

/** Save all items (inventory + equipped) for a character. Replaces all rows for that wallet. */
export async function dbSaveItems(char: Character): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const rows: DbItem[] = [];

  // Inventory items
  for (const item of char.inventory) {
    rows.push(itemToDbRow(item, char.walletAddress, null));
  }

  // Equipped items
  for (const [slot, item] of Object.entries(char.equipment)) {
    if (item) {
      rows.push(itemToDbRow(item as Item, char.walletAddress, slot));
    }
  }

  // Delete existing items for this wallet, then insert fresh
  const { error: delError } = await sb
    .from('items_inventory')
    .delete()
    .eq('owner_wallet', char.walletAddress)
    .eq('is_onchain', false);

  if (delError) {
    console.error('[DB] Failed to clear items:', delError.message);
    return;
  }

  if (rows.length > 0) {
    const { error: insError } = await sb.from('items_inventory').insert(rows);
    if (insError) {
      console.error('[DB] Failed to save items:', insError.message);
    }
  }
}

/** Load all items for a wallet. Returns { inventory, equipment }. */
export async function dbLoadItems(walletAddress: string): Promise<{ inventory: Item[]; equipment: Partial<EquipmentSlots> }> {
  const sb = getSupabase();
  if (!sb) return { inventory: [], equipment: {} };

  const { data, error } = await sb
    .from('items_inventory')
    .select('*')
    .eq('owner_wallet', walletAddress)
    .eq('is_onchain', false);

  if (error) {
    console.error('[DB] Failed to load items:', error.message);
    return { inventory: [], equipment: {} };
  }

  const inventory: Item[] = [];
  const equipment: Partial<EquipmentSlots> = {};

  for (const row of (data as DbItem[]) || []) {
    const item = dbRowToItem(row);
    if (row.equipped_slot) {
      (equipment as Record<string, Item>)[row.equipped_slot] = item;
    } else {
      inventory.push(item);
    }
  }

  return { inventory, equipment };
}
