import { CONFIG } from '../config';
import type { EquipmentSlots, Item, ItemType, Rarity } from '../types';

const RPC_URL = CONFIG.SUI_NETWORK === 'mainnet'
  ? 'https://fullnode.mainnet.sui.io:443'
  : 'https://fullnode.testnet.sui.io:443';

// On-chain equipment slot name → server EquipmentSlots key. The Move module
// uses snake_case for rings (ring_1 / ring_2); the server type drops the
// underscore (ring1 / ring2). Everything else matches 1:1.
const CHAIN_TO_SERVER_SLOT: Record<string, keyof EquipmentSlots> = {
  weapon: 'weapon',
  offhand: 'offhand',
  helmet: 'helmet',
  chest: 'chest',
  gloves: 'gloves',
  boots: 'boots',
  belt: 'belt',
  ring_1: 'ring1',
  ring_2: 'ring2',
  necklace: 'necklace',
};

async function rpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`[sui-read] ${method}: ${json.error.message}`);
  return json.result as T;
}

// Character.weapon etc. are Move `Option<ID>` fields. The current Sui
// JSON-RPC flattens Some(id) to a bare "0x..." string and None to null.
// Older / alternate SDK shapes use { vec: ["0x..."] } or
// { fields: { vec: ["0x..."] } }. Accept all three so this doesn't silently
// break again if the RPC representation shifts.
function extractOptionId(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.startsWith('0x') ? raw : null;
  if (typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const direct = obj.vec;
  const nested = (obj.fields as Record<string, unknown> | undefined)?.vec;
  const vec = (direct ?? nested) as unknown[] | undefined;
  if (!Array.isArray(vec) || vec.length === 0) return null;
  return String(vec[0]);
}

function parseItemFromContent(
  id: string,
  fields: Record<string, unknown>,
): Item {
  // `imageUrl` and `classReq` aren't declared on the server `Item` type, but
  // the runtime object can carry them and sanitizeCharacter forwards them
  // to the frontend (which does declare them). Cast-add so TS stays quiet.
  const item = {
    id,
    name: String(fields.name ?? ''),
    imageUrl: String(fields.image_url ?? '') || undefined,
    classReq: Number(fields.class_req ?? 0),
    itemType: Number(fields.item_type ?? 1) as ItemType,
    rarity: Number(fields.rarity ?? 1) as Rarity,
    levelReq: Number(fields.level_req ?? 1),
    statBonuses: {
      strength: Number(fields.strength_bonus ?? 0),
      dexterity: Number(fields.dexterity_bonus ?? 0),
      intuition: Number(fields.intuition_bonus ?? 0),
      endurance: Number(fields.endurance_bonus ?? 0),
      hp: Number(fields.hp_bonus ?? 0),
      armor: Number(fields.armor_bonus ?? 0),
      defense: Number(fields.defense_bonus ?? 0),
      critBonus: Number(fields.crit_chance_bonus ?? 0),
      damage: Number(fields.attack_bonus ?? 0),
    },
    minDamage: Number(fields.min_damage ?? 0),
    maxDamage: Number(fields.max_damage ?? 0),
  };
  return item as Item;
}

export type DOFEquipment = Record<keyof EquipmentSlots, Item | null>;

/**
 * Read the Character on-chain and return the full 10-slot equipment map as
 * it appears on chain. A slot is `null` when the character has nothing
 * equipped there. Returns `null` if the character cannot be read at all
 * (RPC failure, object not found) — callers should treat that as "chain
 * read unavailable" and fall back to in-memory state.
 *
 * Implementation: one `sui_getObject` to read the Character's Option<ID>
 * slot fields, followed by one `sui_multiGetObjects` to batch-hydrate the
 * populated Item NFTs. Two RPCs regardless of how many slots are filled.
 */
export async function fetchEquippedFromDOFs(
  characterObjectId: string,
): Promise<DOFEquipment | null> {
  let charFields: Record<string, unknown> | undefined;
  try {
    const charResult = await rpc<{
      data?: { content?: { fields?: Record<string, unknown> } };
    }>('sui_getObject', [characterObjectId, { showContent: true }]);
    charFields = charResult?.data?.content?.fields;
  } catch (err: any) {
    console.error('[sui-read] Failed to fetch Character:', err?.message || err);
    return null;
  }
  if (!charFields) return null;

  const empty: DOFEquipment = {
    weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
    boots: null, belt: null, ring1: null, ring2: null, necklace: null,
  };

  const populated: Array<{ slot: keyof EquipmentSlots; id: string }> = [];
  for (const [chainKey, serverKey] of Object.entries(CHAIN_TO_SERVER_SLOT)) {
    const id = extractOptionId(charFields[chainKey]);
    if (id) populated.push({ slot: serverKey, id });
  }

  if (populated.length === 0) return empty;

  let objects: Array<{
    data?: { content?: { fields?: Record<string, unknown> } };
  }>;
  try {
    objects = await rpc('sui_multiGetObjects', [
      populated.map((p) => p.id),
      { showContent: true },
    ]);
  } catch (err: any) {
    console.error('[sui-read] Failed to multiGetObjects equipped items:', err?.message || err);
    return null;
  }

  const out: DOFEquipment = { ...empty };
  for (let i = 0; i < populated.length; i++) {
    const itemFields = objects[i]?.data?.content?.fields;
    if (!itemFields) continue;
    out[populated[i].slot] = parseItemFromContent(populated[i].id, itemFields);
  }
  return out;
}

function isOnChainItemId(id: string | undefined): boolean {
  return typeof id === 'string' && id.startsWith('0x') && id.length >= 42;
}

/**
 * Overwrite a character's in-memory equipment with chain truth, preserving
 * off-chain NPC items the chain cannot see.
 *
 * Rules applied per slot:
 *   - chain has item  → write chain item (overrides server state)
 *   - chain is empty, server has on-chain item → clear (it was unequipped on chain)
 *   - chain is empty, server has NPC item or null → leave as-is
 *
 * Mutates `equipment` in place. Returns the slot names whose contents changed
 * so callers can log.
 */
export function applyDOFEquipment(
  equipment: EquipmentSlots,
  dof: DOFEquipment,
): Array<keyof EquipmentSlots> {
  const changed: Array<keyof EquipmentSlots> = [];
  const entries = Object.entries(dof) as Array<[keyof EquipmentSlots, Item | null]>;
  for (const [slot, chainItem] of entries) {
    const current = equipment[slot];
    if (chainItem) {
      if (current?.id !== chainItem.id) {
        equipment[slot] = chainItem;
        changed.push(slot);
      }
      continue;
    }
    // chainItem === null
    if (current && isOnChainItemId(current.id)) {
      equipment[slot] = null;
      changed.push(slot);
    }
  }
  return changed;
}
