import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { CONFIG } from '../config';
import type { EquipmentSlots, Item, ItemType, Rarity } from '../types';

const network = (CONFIG.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

// Chain stores slot names as utf8 String keys on dynamic_object_field. The
// canonical chain names use snake_case for rings (ring_1, ring_2); the server
// type drops the underscore. Map both directions.
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

const CHAIN_SLOT_NAMES = Object.keys(CHAIN_TO_SERVER_SLOT);

function parseItemFromContent(
  id: string,
  fields: Record<string, unknown>,
): Item {
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

const EMPTY: DOFEquipment = {
  weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
  boots: null, belt: null, ring1: null, ring2: null, necklace: null,
};

/**
 * Read a Character's 10-slot equipment by enumerating its dynamic-object-fields.
 * Returns a slot-keyed map with `null` for empty slots, or `null` overall if
 * the Character object can't be read.
 *
 * Implementation: one `getDynamicFields` page (Character has at most ~11 DFs:
 * 10 equipment slots + 1 fight_lock_expires_at), then `multiGetObjects` to
 * batch-hydrate the Items.
 */
export async function fetchEquippedFromDOFs(
  characterObjectId: string,
): Promise<DOFEquipment | null> {
  let page;
  try {
    page = await client.getDynamicFields({
      parentId: characterObjectId,
      limit: 50,
    });
  } catch (err) {
    console.error('[sui-read] getDynamicFields failed:', (err as Error)?.message || err);
    return null;
  }

  // Each entry has shape: { name: { type, value }, objectId, objectType, type: 'DynamicObject', ... }
  const slotEntries: Array<{ chainName: string; serverSlot: keyof EquipmentSlots; objectId: string }> = [];
  for (const f of page.data) {
    // Filter to slot-named String DFs (skip fight_lock_expires_at which has vector<u8> name)
    const nameType = f.name?.type;
    const nameValue = f.name?.value;
    if (nameType !== '0x1::string::String' || typeof nameValue !== 'string') continue;
    if (!CHAIN_SLOT_NAMES.includes(nameValue)) continue;
    const serverSlot = CHAIN_TO_SERVER_SLOT[nameValue];
    slotEntries.push({ chainName: nameValue, serverSlot, objectId: f.objectId });
  }

  if (slotEntries.length === 0) return { ...EMPTY };

  // For DOFs, the listed objectId is the wrapper that holds the actual Item.
  // Use getDynamicFieldObject on each slot to retrieve the wrapped Item.
  const out: DOFEquipment = { ...EMPTY };
  await Promise.all(
    slotEntries.map(async (entry) => {
      try {
        const obj = await client.getDynamicFieldObject({
          parentId: characterObjectId,
          name: { type: '0x1::string::String', value: entry.chainName },
        });
        const fields = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
        if (!fields) return;
        const objectId = obj.data?.objectId ?? entry.objectId;
        out[entry.serverSlot] = parseItemFromContent(objectId, fields);
      } catch (err) {
        console.warn(`[sui-read] DOF ${entry.chainName} fetch failed:`, (err as Error)?.message || err);
      }
    }),
  );

  return out;
}

function isOnChainItemId(id: string | undefined): boolean {
  return typeof id === 'string' && id.startsWith('0x') && id.length >= 42;
}

/**
 * Overwrite a character's in-memory equipment with chain truth.
 *
 * Rules per slot:
 *   - chain has item  → write chain item (overrides server state)
 *   - chain empty + server has on-chain item → clear (it was unequipped on-chain)
 *   - chain empty + server has off-chain item or null → leave as-is
 *
 * Mutates `equipment` in place. Returns the slot names that changed.
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
    if (current && isOnChainItemId(current.id)) {
      equipment[slot] = null;
      changed.push(slot);
    }
  }
  return changed;
}
