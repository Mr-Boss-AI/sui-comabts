/**
 * Single wire-boundary translator for Items / EquipmentSlots.
 *
 * The server stores items in *server* shape (snake-derived keys —
 * `strength, hp, damage, critBonus, …`) because the chain DOF parser
 * (`utils/sui-read.ts::parseItemFromContent`) maps `crit_chance_bonus`
 * → `critBonus` and so on. The frontend, however, expects
 * `strengthBonus, hpBonus, attackBonus, critChanceBonus, …` — the
 * canonical `computeDerivedStats` consumer reads only these keys, and
 * any other key is silently dropped.
 *
 * Every outbound payload that carries an Item or EquipmentSlots MUST
 * pass through `sanitizeItem` / `sanitizeEquipment` before going on
 * the wire. The previous duplicate in `data/player-profile.ts` only
 * shallow-cloned items (preserving the server-shape keys) and only
 * walked the v5.0 10-slot list, which silently zeroed every stat on
 * the Tavern scout modal AND dropped the v5.1 `ring3 / pants /
 * bracelets` slots entirely. Centralising both passes here closes
 * that family of regressions.
 *
 * The v5.1 slot list is the **only** source of truth for which slots
 * the wire carries. Always-13 keys: a missing slot ships as `null`,
 * so frontend SlotTiles render the empty placeholder even on legacy
 * characters whose in-memory record predates the schema bump.
 */

const WIRE_SLOTS = [
  'weapon',
  'offhand',
  'helmet',
  'chest',
  'gloves',
  'boots',
  'belt',
  'ring1',
  'ring2',
  'ring3',
  'necklace',
  'pants',
  'bracelets',
] as const;

export function sanitizeItem(item: any): unknown {
  if (!item) return null;
  const s = item.statBonuses || {};
  return {
    id: item.id,
    name: item.name,
    imageUrl: item.imageUrl ?? undefined,
    itemType: item.itemType,
    rarity: item.rarity,
    classReq: item.classReq ?? 0,
    levelReq: item.levelReq,
    // v5.1 — chain slot_type carried across the wire. Frontend
    // lib/two-handed-weapons.ts reads this to detect two-handed weapons
    // without a name allowlist. Legacy items (server-only NPC loot) lack
    // the field; treat undefined as MAINHAND=0 so the sanitizer always
    // emits a concrete number rather than `undefined`, which downstream
    // JSON consumers handle more cleanly.
    slotType: item.slotType ?? 0,
    minDamage: item.minDamage ?? 0,
    maxDamage: item.maxDamage ?? 0,
    statBonuses: {
      strengthBonus: s.strength || 0,
      dexterityBonus: s.dexterity || 0,
      intuitionBonus: s.intuition || 0,
      enduranceBonus: s.endurance || 0,
      hpBonus: s.hp || 0,
      armorBonus: s.armor || 0,
      defenseBonus: s.defense || 0,
      attackBonus: s.damage || 0,
      critChanceBonus: s.critBonus || 0,
      // TODO(loadout-cleanup): server StatBonuses type is missing these 4
      // fields. On-chain items have them but they're dropped here. Unify
      // server/frontend stat shape as part of mainnet prep. Tracked in
      // MAINNET_PREP.md.
      critMultiplierBonus: 0,
      evasionBonus: 0,
      antiCritBonus: 0,
      antiEvasionBonus: 0,
    },
  };
}

export function sanitizeEquipment(
  equipment: Record<string, any>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const slot of WIRE_SLOTS) {
    out[slot] = sanitizeItem(equipment[slot] ?? null);
  }
  return out;
}

/**
 * v5.2 (2026-05-30) — sanitizer for the full `character_data` /
 * `points_allocated` wire payloads. Moved out of `ws/handler.ts` so
 * fight-room.ts can also push a fresh `character_data` after the
 * post-fight chain `update_after_fight` lands without creating a
 * `handler.ts → fight-room.ts → handler.ts` import cycle.
 *
 * Behaviour mirrors the prior `sanitizeCharacter` in handler.ts
 * 1-for-1 — including the unallocatedPoints diagnostic log when
 * non-zero, the BUG E `onChainObjectId` carry-through, and the
 * 13-slot equipment guarantee via sanitizeEquipment.
 */
export function sanitizeCharacter(character: any): Record<string, any> {
  const unallocatedPoints = character.unallocatedPoints || 0;
  if (unallocatedPoints > 0) {
    console.log(
      `[Character] Sending ${character.name} with ${unallocatedPoints} unallocated points`,
    );
  }
  return {
    id: character.id,
    name: character.name,
    level: character.level,
    xp: character.xp,
    walletAddress: character.walletAddress,
    onChainObjectId: character.onChainObjectId ?? null,
    stats: {
      strength: character.stats.strength,
      dexterity: character.stats.dexterity,
      intuition: character.stats.intuition,
      endurance: character.stats.endurance,
    },
    unallocatedPoints,
    equipment: sanitizeEquipment(character.equipment),
    wins: character.wins,
    losses: character.losses,
    draws: character.draws,
    rating: character.rating,
  };
}
