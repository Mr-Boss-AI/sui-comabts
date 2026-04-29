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

/**
 * Decode a Sui Kiosk `Listing { id: address, is_exclusive: bool }` key from
 * its BCS bytes. The id field is 32 bytes; we don't need the bool. Returns
 * the listed Item NFT object ID as a 0x-prefixed hex string.
 *
 * The gRPC SDK serializes name BCS as either a Uint8Array or as a numeric-key
 * object depending on transport — we coerce both cleanly.
 */
function decodeListingKeyItemId(bcs: unknown): string | null {
  let bytes: Uint8Array | null = null;
  if (bcs instanceof Uint8Array) bytes = bcs;
  else if (Array.isArray(bcs)) bytes = new Uint8Array(bcs);
  else if (bcs && typeof bcs === "object") {
    const obj = bcs as Record<string, unknown>;
    const len = Object.keys(obj).length;
    if (len < 32) return null;
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = Number(obj[String(i)] ?? 0);
    bytes = out;
  } else if (typeof bcs === "string") {
    // base64 (SDK default for unknown transports)
    try {
      const raw = atob(bcs);
      const out = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
      bytes = out;
    } catch {
      return null;
    }
  }
  if (!bytes || bytes.length < 32) return null;
  let hex = "0x";
  for (let i = 0; i < 32; i++) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Fetch every Item NFT physically inside the connected user's Kiosk(s),
 * stamped with chain-truth `inKiosk: true` and `kioskListed` (true iff the
 * item has a live Sui Kiosk Listing DOF for it).
 *
 * We pass through the dynamic-field list once, classifying each entry:
 *   - DynamicObject + valueType `::item::Item` → an Item child of the kiosk
 *   - name.type `0x2::kiosk::Listing` → the item with id encoded in the
 *     listing key is currently listed
 *
 * Item NFTs are then hydrated (one `getObject` call each) and joined against
 * the listing set. This keeps `kioskListed` chain-authoritative — there's no
 * race with the server's gRPC listing index.
 */
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

    const itemFields: { childId: string }[] = [];
    const listedItemIds = new Set<string>();
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
        // 1) Item DOF — collect for hydration
        if (field.$kind === "DynamicObject" && field.valueType?.includes("::item::Item")) {
          itemFields.push({ childId: field.childId });
          continue;
        }
        // 2) Listing DF — extract the listed item ID from the key BCS
        if (field.name?.type?.includes("::kiosk::Listing")) {
          const itemId = decodeListingKeyItemId((field.name as { bcs?: unknown }).bcs);
          if (itemId) listedItemIds.add(itemId);
        }
      }

      hasNextPage = res.hasNextPage;
      dfCursor = res.cursor ?? undefined;
    }

    // Hydrate the item objects in parallel — testnet typical kiosk has <50
    // items so this is bounded.
    await Promise.all(
      itemFields.map(async ({ childId }) => {
        try {
          const { object: obj } = await client.getObject({
            objectId: childId,
            include: { json: true },
          });
          const json = obj.json as Record<string, unknown> | null;
          if (!json) return;

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
            kioskListed: listedItemIds.has(obj.objectId),
          });
        } catch {
          // Skip items that fail to fetch
        }
      }),
    );
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

/**
 * Atomic delist + take + transfer.
 *
 * `marketplace::delist_item` only clears the Sui Kiosk's `Listing` DOF — the
 * `Item` DOF stays put, so the NFT is still owned by the kiosk after a
 * vanilla delist. Most users expect "delist" to mean "I want my item back",
 * so this PTB chains the three moves any seller wants in one wallet popup:
 *
 *   1. `${PACKAGE_ID}::marketplace::delist_item`  → removes Listing DOF
 *   2. `0x2::kiosk::take<Item>`                    → removes Item DOF, returns Item
 *   3. `tx.transferObjects([item], recipient)`     → sends Item to wallet
 *
 * `kiosk::take` aborts if the item is still listed, so step 1 must succeed
 * first (atomic per PTB semantics — the whole tx aborts if any step does).
 *
 * `recipient` is normally `currentAccount.address` — passed in because the
 * sender isn't known at PTB build time.
 */
export function buildDelistItemTx(
  kioskId: string,
  kioskCapId: string,
  itemObjectId: string,
  recipient: string,
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

  const item = tx.moveCall({
    target: `0x2::kiosk::take`,
    typeArguments: [`${PACKAGE_ID}::item::Item`],
    arguments: [
      tx.object(kioskId),
      tx.object(kioskCapId),
      tx.pure.id(itemObjectId),
    ],
  });

  tx.transferObjects([item], tx.pure.address(recipient));

  return tx;
}

/**
 * Take an unlisted item out of the seller's Kiosk (skip the delist step).
 *
 * Migration / recovery path for any item that's stuck inside a Kiosk because
 * a previous version of the client called the old vanilla delist (which left
 * the Item DOF in place). Aborts if the item is currently listed — sellers
 * must use `buildDelistItemTx` for that case.
 */
export function buildTakeFromKioskTx(
  kioskId: string,
  kioskCapId: string,
  itemObjectId: string,
  recipient: string,
): Transaction {
  const tx = new Transaction();

  const item = tx.moveCall({
    target: `0x2::kiosk::take`,
    typeArguments: [`${PACKAGE_ID}::item::Item`],
    arguments: [
      tx.object(kioskId),
      tx.object(kioskCapId),
      tx.pure.id(itemObjectId),
    ],
  });

  tx.transferObjects([item], tx.pure.address(recipient));

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

/**
 * Withdraw SUI profits from a Kiosk into the seller's wallet. Uses the Sui
 * stdlib `0x2::kiosk::withdraw` directly — `marketplace.move` doesn't wrap
 * this since it doesn't add anything beyond the base Kiosk semantics.
 *
 * Pass `amountMist = null` to withdraw everything; otherwise pulls exactly
 * `amountMist` MIST. The returned Coin<SUI> is transferred to the
 * `recipient` address (in practice, always the kiosk owner / tx sender).
 */
export function buildWithdrawKioskProfitsTx(
  kioskId: string,
  kioskCapId: string,
  recipient: string,
  amountMist: bigint | null = null,
): Transaction {
  const tx = new Transaction();
  const profits = tx.moveCall({
    target: `0x2::kiosk::withdraw`,
    arguments: [
      tx.object(kioskId),
      tx.object(kioskCapId),
      tx.pure.option('u64', amountMist === null ? null : amountMist),
    ],
  });
  tx.transferObjects([profits], tx.pure.address(recipient));
  return tx;
}
