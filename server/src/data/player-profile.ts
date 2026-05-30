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
import { sanitizeEquipment } from '../utils/wire-sanitize';
import type { Character, EquipmentSlots } from '../types';

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
  /** v5.1 — mutual-KO outcome counter mirrored from chain Character.draws. */
  draws: number;
  /** Sum of wins + losses + draws. Draws ARE counted as fights — a
   *  mutual KO is still a chain-recorded combat. */
  totalFights: number;
  /** Win rate as a fraction in `[0, 1]`. Convention: **draws excluded
   *  from the denominator** (`wins / (wins + losses)`). A character
   *  with only draws renders 0% — they've not yet won a decisive
   *  fight. This matches the MMO/PvP "decided fights only" semantic;
   *  see `lib/hall-of-fame-display.ts` for the matching frontend
   *  helper. The D in the W/L/D record carries the draw count
   *  separately so the percentage isn't lying. */
  winRate: number;
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
  // Draws ARE fights (mutual KO is a real chain-recorded combat) — they
  // contribute to totalFights. But they DON'T enter the winRate
  // denominator — see PlayerProfileWire.winRate docs above. Decided
  // fights only.
  const decidedFights = character.wins + character.losses;
  const totalFights = decidedFights + character.draws;
  const winRate = decidedFights === 0 ? 0 : character.wins / decidedFights;
  return {
    walletAddress: character.walletAddress,
    name: character.name,
    level: character.level,
    xp: character.xp,
    rating: character.rating,
    wins: character.wins,
    losses: character.losses,
    draws: character.draws,
    totalFights,
    winRate: Math.round(winRate * 1000) / 1000, // 3 decimals
    stats: { ...character.stats },
    unallocatedPoints: character.unallocatedPoints,
    // Wire-shape translation lives in utils/wire-sanitize.ts. The previous
    // private `cloneEquipment` only walked the 10-slot v5.0 list AND only
    // shallow-cloned items (preserving server-shape statBonuses keys),
    // which silently zeroed every equipped-stat bonus in the Tavern scout
    // modal and dropped ring3/pants/bracelets entirely. The shared
    // sanitizer is the same translator handler.ts uses for character_state.
    equipment: sanitizeEquipment(character.equipment as unknown as Record<string, unknown>) as unknown as EquipmentSlots,
    onChainObjectId: character.onChainObjectId ?? undefined,
    fresh,
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
