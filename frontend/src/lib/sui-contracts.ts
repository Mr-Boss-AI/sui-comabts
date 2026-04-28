import { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Item } from "@/types/game";

// =============================================================================
// PACKAGE / OBJECT IDS
//
// Next.js 16 / Turbopack only inlines `process.env.NEXT_PUBLIC_FOO` when the
// access is *literal* (a static property name). A helper like `requireEnv(s)`
// does `process.env[s]` — a dynamic lookup the bundler can't statically
// resolve — so at runtime in the browser the value is undefined. Read each
// var directly, then validate.
// =============================================================================

function required(label: string, v: string | undefined): string {
  if (!v || v.trim() === "") {
    throw new Error(`Required env var ${label} is not set. Check frontend/.env.local`);
  }
  return v.trim();
}

/** v5 ships as a single fresh-publish package — no upgraded/original split. */
export const PACKAGE_ID = required(
  "NEXT_PUBLIC_SUI_PACKAGE_ID",
  process.env.NEXT_PUBLIC_SUI_PACKAGE_ID,
);
/** Alias kept for legacy callsites. Same as PACKAGE_ID in v5. */
export const CALL_PACKAGE = PACKAGE_ID;

const CHARACTER_TYPE = `${PACKAGE_ID}::character::Character`;
const ITEM_TYPE = `${PACKAGE_ID}::item::Item`;
export const SUI_CLOCK = "0x6";

/** Treasury wallet — receives listing fees and wager platform fees. */
export const TREASURY_ADDRESS = required(
  "NEXT_PUBLIC_TREASURY_ADDRESS",
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS,
);

/** TransferPolicy<Item> object id. Required for marketplace buys. */
export const TRANSFER_POLICY_ID = process.env.NEXT_PUBLIC_TRANSFER_POLICY_ID ?? "";

/** Per-listing fee charged on list_item, in MIST (0.01 SUI). */
const LISTING_FEE_MIST: bigint = BigInt(10_000_000);

/** Royalty config — must match marketplace.move ROYALTY_BPS / ROYALTY_MIN_MIST. */
const ROYALTY_BPS = BigInt(250);       // 2.5%
const BPS_BASE = BigInt(10_000);
const ROYALTY_MIN_MIST = BigInt(1_000);

/** Compute the royalty amount required for a sale at `priceMist`. */
export function computeRoyalty(priceMist: bigint): bigint {
  const computed = (priceMist * ROYALTY_BPS) / BPS_BASE;
  return computed < ROYALTY_MIN_MIST ? ROYALTY_MIN_MIST : computed;
}

// =============================================================================
// EQUIPMENT SLOT KEY (matches the chain `String` keys in equipment.move)
// =============================================================================

export type EquipSlotKey =
  | "weapon" | "offhand" | "helmet" | "chest" | "gloves"
  | "boots" | "belt" | "ring_1" | "ring_2" | "necklace";

// =============================================================================
// CHARACTER NFT
// =============================================================================

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
  loadoutVersion: number;
}

/**
 * Find a player's Character NFT via the CharacterCreated event log, then
 * fetch the shared object directly.
 */
export async function fetchCharacterNFT(
  client: SuiGrpcClient,
  owner: string,
): Promise<OnChainCharacter | null> {
  const rpcUrl =
    (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") === "mainnet"
      ? "https://fullnode.mainnet.sui.io:443"
      : "https://fullnode.testnet.sui.io:443";
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
    const evJson = (await evRes.json()) as Record<string, unknown>;
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
      loadoutVersion: Number(json.loadout_version ?? 0),
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
    target: `${PACKAGE_ID}::character::create_character`,
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
    target: `${PACKAGE_ID}::character::allocate_points`,
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
        if (field.$kind !== "DynamicObject" || !field.valueType?.includes("::item::Item")) continue;

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

// =============================================================================
//  Wager
// =============================================================================

export function buildCreateWagerTx(stakeAmountMist: bigint): Transaction {
  const tx = new Transaction();
  const [stakeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(stakeAmountMist)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::arena::create_wager`,
    arguments: [stakeCoin, tx.object(SUI_CLOCK)],
  });
  return tx;
}

export function buildAcceptWagerTx(wagerMatchId: string, stakeAmountMist: bigint): Transaction {
  const tx = new Transaction();
  const [stakeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(stakeAmountMist)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::arena::accept_wager`,
    arguments: [tx.object(wagerMatchId), stakeCoin, tx.object(SUI_CLOCK)],
  });
  return tx;
}

/** v5 cancel_wager takes a Clock for `settled_at`. */
export function buildCancelWagerTx(wagerMatchId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::arena::cancel_wager`,
    arguments: [tx.object(wagerMatchId), tx.object(SUI_CLOCK)],
  });
  return tx;
}

export function buildCancelExpiredWagerTx(wagerMatchId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::arena::cancel_expired_wager`,
    arguments: [tx.object(wagerMatchId), tx.object(SUI_CLOCK)],
  });
  return tx;
}

// =============================================================================
//  Equipment (DOF pattern — v5 dropped the _v2 suffix)
// =============================================================================

export function buildEquipTx(
  slot: EquipSlotKey,
  characterObjectId: string,
  itemObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::equipment::equip_${slot}`,
    arguments: [
      tx.object(characterObjectId),
      tx.object(itemObjectId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildUnequipTx(
  slot: EquipSlotKey,
  characterObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::equipment::unequip_${slot}`,
    arguments: [
      tx.object(characterObjectId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

export function buildSwapEquipmentTx(
  slot: EquipSlotKey,
  characterObjectId: string,
  newItemObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::equipment::unequip_${slot}`,
    arguments: [tx.object(characterObjectId), tx.object(SUI_CLOCK)],
  });
  tx.moveCall({
    target: `${PACKAGE_ID}::equipment::equip_${slot}`,
    arguments: [
      tx.object(characterObjectId),
      tx.object(newItemObjectId),
      tx.object(SUI_CLOCK),
    ],
  });
  return tx;
}

// =============================================================================
//  Marketplace (Kiosk + listing fee + royalty)
// =============================================================================

/** Create a per-player Kiosk. Each wallet typically only needs one. */
export function buildCreateKioskTx(): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::marketplace::create_player_kiosk`,
    arguments: [],
  });
  return tx;
}

/**
 * List an item in the seller's Kiosk with the mandatory 0.01 SUI fee routed
 * to TREASURY. v5 renamed this from `list_item_with_fee` to `list_item`.
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
    target: `${PACKAGE_ID}::marketplace::list_item`,
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

export function buildDelistItemTx(
  kioskId: string,
  kioskCapId: string,
  itemObjectId: string,
): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::marketplace::delist_item`,
    arguments: [
      tx.object(kioskId),
      tx.object(kioskCapId),
      tx.pure.id(itemObjectId),
    ],
  });
  return tx;
}

/**
 * Buy a listed item.
 *
 * v5 buy_item takes TWO Coin<SUI> args — purchase price + royalty. The royalty
 * coin is required by the TransferPolicy<Item>'s royalty rule. Use
 * `computeRoyalty(priceMist)` to derive the second amount before calling.
 */
export function buildBuyItemTx(
  kioskId: string,
  itemObjectId: string,
  priceMist: bigint,
  transferPolicyId: string,
): Transaction {
  const tx = new Transaction();
  const royaltyMist = computeRoyalty(priceMist);
  const [paymentCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(priceMist)]);
  const [royaltyCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(royaltyMist)]);
  tx.moveCall({
    target: `${PACKAGE_ID}::marketplace::buy_item`,
    arguments: [
      tx.object(kioskId),
      tx.pure.id(itemObjectId),
      paymentCoin,
      royaltyCoin,
      tx.object(transferPolicyId),
    ],
  });
  return tx;
}
