import { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Item } from "@/types/game";

// Original package — types anchor here (Character, Item are first defined here).
// Use PACKAGE_ID for event queries and struct type names.
const PACKAGE_ID =
  process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ??
  "0x07fd856dc8db9dc2950f7cc2ef39408bd20414cea86a37477361f5717e188c1d";

// Upgraded package — all moveCall targets route here so new bytecode runs
// (owner checks, fight locks, mint AdminCap gate, listing fee).
// Fallback to PACKAGE_ID means pre-upgrade testnet builds still work.
const CALL_PACKAGE =
  process.env.NEXT_PUBLIC_SUI_UPGRADED_PACKAGE_ID ??
  "0x5f9011c8eb31f321fbd5b2ad5c811f34011a96a4c8a2ddfc6262727dee55c76b";

const CHARACTER_TYPE = `${PACKAGE_ID}::character::Character`;
const ITEM_TYPE = `${PACKAGE_ID}::item::Item`;
const SUI_CLOCK = '0x6';

// Treasury wallet — receives listing fees and wager platform fees.
// Passed as an argument to list_item_with_fee (config-driven, not hardcoded in contract).
const TREASURY_ADDRESS =
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS ??
  "0xdbd3acbd6db16bdba55cf084ea36131bd97366e399859758689ab2dd686bcd60";

// 0.01 SUI, in MIST
const LISTING_FEE_MIST: bigint = BigInt(10_000_000);

// Equipment slot key → the "_v2" function suffix used in equipment.move
export type EquipSlotKey =
  | "weapon" | "offhand" | "helmet" | "chest" | "gloves"
  | "boots" | "belt" | "ring_1" | "ring_2" | "necklace";

export interface OnChainCharacter {
  objectId: string;
  name: string;
  level: number;
  xp: number;
  strength: number;
  dexterity: number;
  intuition: number;
  endurance: number;
  unallocatedPoints: number;
  wins: number;
  losses: number;
  rating: number;
}

/**
 * Find a player's Character NFT. Characters are shared objects, so we query
 * CharacterCreated events to find the object ID, then fetch it directly.
 */
export async function fetchCharacterNFT(
  client: SuiGrpcClient,
  owner: string,
): Promise<OnChainCharacter | null> {
  // First try: query events to find Character ID for this owner
  const rpcUrl = "https://fullnode.testnet.sui.io:443";
  try {
    const evRes = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_queryEvents",
        params: [
          { MoveEventType: `${PACKAGE_ID}::character::CharacterCreated` },
          null, 50, true,
        ],
      }),
    });
    const evJson = await evRes.json() as Record<string, unknown>;
    const evResult = evJson.result as { data?: Array<{ parsedJson?: Record<string, unknown> }> } | undefined;
    const events = evResult?.data || [];

    let characterId: string | null = null;
    for (const event of events) {
      const parsed = event.parsedJson;
      if (parsed?.owner === owner) {
        characterId = String(parsed.character_id);
        break;
      }
    }

    if (!characterId) return null;

    // Fetch the shared Character object by ID
    const { object: obj } = await client.getObject({
      objectId: characterId,
      include: { json: true },
    });

    const json = obj.json as Record<string, unknown> | null;
    if (!json) return null;

    return {
      objectId: obj.objectId,
      name: String(json.name ?? ""),
      level: Number(json.level ?? 1),
      xp: Number(json.xp ?? 0),
      strength: Number(json.strength ?? 5),
      dexterity: Number(json.dexterity ?? 5),
      intuition: Number(json.intuition ?? 5),
      endurance: Number(json.endurance ?? 5),
      unallocatedPoints: Number(json.unallocated_points ?? 0),
      wins: Number(json.wins ?? 0),
      losses: Number(json.losses ?? 0),
      rating: Number(json.rating ?? 1000),
    };
  } catch {
    return null;
  }
}

/** Build a transaction that calls create_character on-chain. */
export function buildMintCharacterTx(
  name: string,
  strength: number,
  dexterity: number,
  intuition: number,
  endurance: number,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::character::create_character`,
    arguments: [
      tx.pure.string(name),
      tx.pure.u16(strength),
      tx.pure.u16(dexterity),
      tx.pure.u16(intuition),
      tx.pure.u16(endurance),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

/** Build a transaction that allocates unallocated stat points on-chain. */
export function buildAllocateStatsTx(
  characterObjectId: string,
  strength: number,
  dexterity: number,
  intuition: number,
  endurance: number,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::character::allocate_points`,
    arguments: [
      tx.object(characterObjectId),
      tx.pure.u16(strength),
      tx.pure.u16(dexterity),
      tx.pure.u16(intuition),
      tx.pure.u16(endurance),
    ],
  });
  return tx;
}

/** Query a wallet for all Item NFTs and convert to frontend Item type. */
export async function fetchOwnedItems(
  client: SuiGrpcClient,
  owner: string,
): Promise<Item[]> {
  const items: Item[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const res: Awaited<ReturnType<typeof client.listOwnedObjects<{ json: true }>>> =
      await client.listOwnedObjects({
        owner,
        type: ITEM_TYPE,
        cursor,
        include: { json: true },
      });

    for (const obj of res.objects) {
      const json = obj.json as Record<string, unknown> | null;
      if (!json) continue;

      items.push({
        id: obj.objectId,
        name: String(json.name ?? ""),
        imageUrl: String(json.image_url ?? "") || undefined,
        itemType: Number(json.item_type ?? 1) as Item["itemType"],
        classReq: Number(json.class_req ?? 0),
        levelReq: Number(json.level_req ?? 1),
        rarity: Number(json.rarity ?? 1) as Item["rarity"],
        statBonuses: {
          strengthBonus: Number(json.strength_bonus ?? 0),
          dexterityBonus: Number(json.dexterity_bonus ?? 0),
          intuitionBonus: Number(json.intuition_bonus ?? 0),
          enduranceBonus: Number(json.endurance_bonus ?? 0),
          hpBonus: Number(json.hp_bonus ?? 0),
          armorBonus: Number(json.armor_bonus ?? 0),
          defenseBonus: Number(json.defense_bonus ?? 0),
          attackBonus: Number(json.attack_bonus ?? 0),
          critChanceBonus: Number(json.crit_chance_bonus ?? 0),
          critMultiplierBonus: Number(json.crit_multiplier_bonus ?? 0),
          evasionBonus: Number(json.evasion_bonus ?? 0),
          antiCritBonus: Number(json.anti_crit_bonus ?? 0),
          antiEvasionBonus: Number(json.anti_evasion_bonus ?? 0),
        },
        minDamage: Number(json.min_damage ?? 0),
        maxDamage: Number(json.max_damage ?? 0),
      });
    }

    hasNextPage = res.hasNextPage;
    cursor = res.cursor;
  }

  return items;
}

/** Fetch items locked inside the player's Kiosk(s). */
export async function fetchKioskItems(
  client: SuiGrpcClient,
  owner: string,
): Promise<Item[]> {
  const items: Item[] = [];

  // 1. Find KioskOwnerCap objects owned by this wallet
  const { objects: caps } = await client.listOwnedObjects({
    owner,
    type: "0x2::kiosk::KioskOwnerCap",
    include: { json: true },
  });

  for (const cap of caps) {
    const capJson = cap.json as Record<string, unknown> | null;
    if (!capJson) continue;
    const kioskId = String(capJson.for ?? "");
    if (!kioskId) continue;

    // 2. List dynamic fields in this kiosk to find Item objects
    let dfCursor: string | undefined = undefined;
    let hasNextPage = true;

    while (hasNextPage) {
      const res: Awaited<ReturnType<typeof client.listDynamicFields>> =
        await client.listDynamicFields({
          parentId: kioskId,
          cursor: dfCursor,
          limit: 50,
        });

      for (const field of res.dynamicFields) {
        // Kiosk items are DynamicObject fields; the valueType contains the item type
        if (field.$kind !== "DynamicObject" || !field.valueType?.includes("::item::Item")) continue;

        // Fetch the actual item object
        try {
          const { object: obj } = await client.getObject({
            objectId: field.childId,
            include: { json: true },
          });
          const json = obj.json as Record<string, unknown> | null;
          if (!json) continue;

          items.push({
            id: obj.objectId,
            name: String(json.name ?? ""),
            imageUrl: String(json.image_url ?? "") || undefined,
            itemType: Number(json.item_type ?? 1) as Item["itemType"],
            classReq: Number(json.class_req ?? 0),
            levelReq: Number(json.level_req ?? 1),
            rarity: Number(json.rarity ?? 1) as Item["rarity"],
            statBonuses: {
              strengthBonus: Number(json.strength_bonus ?? 0),
              dexterityBonus: Number(json.dexterity_bonus ?? 0),
              intuitionBonus: Number(json.intuition_bonus ?? 0),
              enduranceBonus: Number(json.endurance_bonus ?? 0),
              hpBonus: Number(json.hp_bonus ?? 0),
              armorBonus: Number(json.armor_bonus ?? 0),
              defenseBonus: Number(json.defense_bonus ?? 0),
              attackBonus: Number(json.attack_bonus ?? 0),
              critChanceBonus: Number(json.crit_chance_bonus ?? 0),
              critMultiplierBonus: Number(json.crit_multiplier_bonus ?? 0),
              evasionBonus: Number(json.evasion_bonus ?? 0),
              antiCritBonus: Number(json.anti_crit_bonus ?? 0),
              antiEvasionBonus: Number(json.anti_evasion_bonus ?? 0),
            },
            minDamage: Number(json.min_damage ?? 0),
            maxDamage: Number(json.max_damage ?? 0),
            inKiosk: true,
          });
        } catch {
          // Skip items that fail to fetch
        }
      }

      hasNextPage = res.hasNextPage;
      dfCursor = res.cursor ?? undefined;
    }
  }

  return items;
}

// ===== Wager Transactions =====

/** Build a transaction that creates a wager match with SUI escrow. */
export function buildCreateWagerTx(stakeAmountMist: bigint): Transaction {
  const tx = new Transaction();
  const [stakeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(stakeAmountMist)]);
  tx.moveCall({
    target: `${CALL_PACKAGE}::arena::create_wager`,
    arguments: [stakeCoin, tx.object(SUI_CLOCK)],
  });
  return tx;
}

/** Build a transaction that accepts an existing wager match. */
export function buildAcceptWagerTx(wagerMatchId: string, stakeAmountMist: bigint): Transaction {
  const tx = new Transaction();
  const [stakeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(stakeAmountMist)]);
  tx.moveCall({
    target: `${CALL_PACKAGE}::arena::accept_wager`,
    arguments: [tx.object(wagerMatchId), stakeCoin, tx.object(SUI_CLOCK)],
  });
  return tx;
}

/** Build a transaction that cancels a wager (only player A, only while waiting). */
export function buildCancelWagerTx(wagerMatchId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::arena::cancel_wager`,
    arguments: [tx.object(wagerMatchId)],
  });
  return tx;
}

/** Build a transaction to cancel an expired wager. Anyone can call this. */
export function buildCancelExpiredWagerTx(wagerMatchId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::arena::cancel_expired_wager`,
    arguments: [tx.object(wagerMatchId), tx.object(SUI_CLOCK)],
  });
  return tx;
}

// ============================================================================
//  Equipment (on-chain DOF pattern — equip_*_v2 / unequip_*_v2)
// ============================================================================

/**
 * Build an equip tx for a specific slot. Item becomes a dynamic object field
 * on the Character NFT — no longer transferable, can't be listed, can't be
 * stolen. Owner check + fight-lock check enforced on-chain.
 */
export function buildEquipTx(
  slot: EquipSlotKey,
  characterObjectId: string,
  itemObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::equipment::equip_${slot}_v2`,
    arguments: [
      tx.object(characterObjectId),
      tx.object(itemObjectId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

/**
 * Build an unequip tx for a specific slot. Item returns to the character's
 * owner as a free, transferable, listable NFT. Owner check + fight-lock check
 * enforced on-chain.
 */
export function buildUnequipTx(
  slot: EquipSlotKey,
  characterObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::equipment::unequip_${slot}_v2`,
    arguments: [
      tx.object(characterObjectId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

/**
 * Build a swap tx (PTB): unequip current item, equip new item in the same slot,
 * one wallet signature. Both calls go through the _v2 functions so owner +
 * fight-lock are enforced on each half.
 */
export function buildSwapEquipmentTx(
  slot: EquipSlotKey,
  characterObjectId: string,
  newItemObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::equipment::unequip_${slot}_v2`,
    arguments: [
      tx.object(characterObjectId),
      tx.object(SUI_CLOCK),
    ],
  });
  tx.moveCall({
    target: `${CALL_PACKAGE}::equipment::equip_${slot}_v2`,
    arguments: [
      tx.object(characterObjectId),
      tx.object(newItemObjectId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// ============================================================================
//  Marketplace (Kiosk + listing fee)
// ============================================================================

/** Create a per-player Kiosk. Each wallet typically only needs one. */
export function buildCreateKioskTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::marketplace::create_player_kiosk`,
    arguments: [],
  });
  return tx;
}

/**
 * List an item in the seller's Kiosk with the mandatory 0.01 SUI fee routed
 * to the configured TREASURY. The fee coin is split from gas; any excess
 * (above LISTING_FEE_MIST) is refunded to the sender inside the Move function.
 */
export function buildListItemTx(
  kioskId: string,
  kioskCapId: string,
  itemObjectId: string,
  priceMist: bigint,
): Transaction {
  const tx = new Transaction();
  const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(LISTING_FEE_MIST)]);
  tx.moveCall({
    target: `${CALL_PACKAGE}::marketplace::list_item_with_fee`,
    arguments: [
      tx.object(kioskId),
      tx.object(kioskCapId),
      tx.object(itemObjectId),
      tx.pure.u64(priceMist),
      feeCoin,
      tx.pure.address(TREASURY_ADDRESS),
    ],
  });
  return tx;
}

/** Remove an item from a kiosk listing (does NOT refund the listing fee). */
export function buildDelistItemTx(
  kioskId: string,
  kioskCapId: string,
  itemObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${CALL_PACKAGE}::marketplace::delist_item`,
    arguments: [
      tx.object(kioskId),
      tx.object(kioskCapId),
      tx.pure.id(itemObjectId),
    ],
  });
  return tx;
}

/**
 * Buy a listed item from another player's Kiosk. Pays in SUI at the listing
 * price; the TransferPolicy takes the 2.5% royalty.
 */
export function buildBuyItemTx(
  kioskId: string,
  itemObjectId: string,
  priceMist: bigint,
  transferPolicyId: string,
): Transaction {
  const tx = new Transaction();
  const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);
  tx.moveCall({
    target: `${CALL_PACKAGE}::marketplace::buy_item`,
    arguments: [
      tx.object(kioskId),
      tx.pure.id(itemObjectId),
      paymentCoin,
      tx.object(transferPolicyId),
    ],
  });
  return tx;
}
