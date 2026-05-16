/**
 * Player profile resolver — full character + equipment for the
 * "view another player" modal.
 *
 * The Tavern's player sidebar exposes a click-to-profile interaction.
 * The modal needs more than what the player-list wire shape carries:
 * full stats, equipped items per slot (with image URLs from the chain
 * Display objects), W/L record, total played, etc.
 *
 * Resolution order:
 *   1. In-memory `getCharacterByWallet` — covers the hot path (target
 *      is currently online).
 *   2. Supabase fallback via `restoreCharacterFromDb` — covers offline
 *      players whose row is persisted.
 *   3. On-chain DOF read for equipped items — re-syncs the equipment
 *      slice with chain truth (the DB row may be stale if the player
 *      saved a loadout from another tab).
 *
 * Returns a wire-shaped record that the frontend can render directly.
 * If the wallet has no character at all (legitimately new), returns
 * `null`.
 */

import { getCharacterByWallet, restoreCharacterFromDb } from './characters';
import { fetchEquippedFromDOFs, applyDOFEquipment } from '../utils/sui-read';
import type { Character, EquipmentSlots, Item } from '../types';

/** Wire shape returned to the frontend. Mirrors `Character` minus
 *  inventory + sensitive bits, plus a denormalised win-rate. */
export interface PlayerProfileWire {
  walletAddress: string;
  name: string;
  level: number;
  xp: number;
  rating: number;
  wins: number;
  losses: number;
  totalFights: number;
  winRate: number; // 0..1
  stats: {
    strength: number;
    dexterity: number;
    intuition: number;
    endurance: number;
  };
  unallocatedPoints: number;
  equipment: EquipmentSlots;
  onChainObjectId?: string;
  /** True iff the data came from in-memory (fresh) vs Supabase (might
   *  be stale). The frontend can show a subtle "live" indicator. */
  fresh: boolean;
}

export function characterToProfileWire(
  character: Character,
  fresh: boolean,
): PlayerProfileWire {
  const totalFights = character.wins + character.losses;
  const winRate = totalFights === 0 ? 0 : character.wins / totalFights;
  return {
    walletAddress: character.walletAddress,
    name: character.name,
    level: character.level,
    xp: character.xp,
    rating: character.rating,
    wins: character.wins,
    losses: character.losses,
    totalFights,
    winRate: Math.round(winRate * 1000) / 1000, // 3 decimals
    stats: { ...character.stats },
    unallocatedPoints: character.unallocatedPoints,
    equipment: cloneEquipment(character.equipment),
    onChainObjectId: character.onChainObjectId ?? undefined,
    fresh,
  };
}

function cloneEquipment(eq: EquipmentSlots): EquipmentSlots {
  return {
    weapon: eq.weapon ? ({ ...eq.weapon } as Item) : null,
    offhand: eq.offhand ? ({ ...eq.offhand } as Item) : null,
    helmet: eq.helmet ? ({ ...eq.helmet } as Item) : null,
    chest: eq.chest ? ({ ...eq.chest } as Item) : null,
    gloves: eq.gloves ? ({ ...eq.gloves } as Item) : null,
    boots: eq.boots ? ({ ...eq.boots } as Item) : null,
    belt: eq.belt ? ({ ...eq.belt } as Item) : null,
    ring1: eq.ring1 ? ({ ...eq.ring1 } as Item) : null,
    ring2: eq.ring2 ? ({ ...eq.ring2 } as Item) : null,
    necklace: eq.necklace ? ({ ...eq.necklace } as Item) : null,
  };
}

/**
 * Get the full profile for any wallet. If `refreshChain` is true (default
 * `true`), also re-reads equipment from on-chain DOFs so a player who
 * saved a loadout from another tab shows their current gear, not the DB
 * snapshot.
 */
export async function getPlayerProfile(
  walletAddress: string,
  options: { refreshChain?: boolean } = {},
): Promise<PlayerProfileWire | null> {
  const refreshChain = options.refreshChain ?? true;

  let character = getCharacterByWallet(walletAddress);
  let fresh = !!character;
  if (!character) {
    const restored = await restoreCharacterFromDb(walletAddress);
    if (!restored) return null;
    character = restored;
    fresh = false;
  }

  if (refreshChain && character.onChainObjectId) {
    try {
      const dof = await fetchEquippedFromDOFs(character.onChainObjectId);
      if (dof) {
        applyDOFEquipment(character.equipment, dof);
      }
    } catch (err: any) {
      // Non-fatal — the cached equipment is still useful and the modal
      // can render against a slightly stale view.
      console.warn(
        `[PlayerProfile] DOF refresh failed for ${walletAddress.slice(0, 10)}:`,
        err?.message ?? err,
      );
    }
  }

  return characterToProfileWire(character, fresh);
}
