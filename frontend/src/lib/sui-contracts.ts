import { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import type { Item } from "@/types/game";

const PACKAGE_ID =
  process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ??
  "0x7fd54c4d9294269f88e24a6e5912477910d024b3b7efbba16b18876d072f2303";

const CHARACTER_TYPE = `${PACKAGE_ID}::character::Character`;
const ITEM_TYPE = `${PACKAGE_ID}::item::Item`;

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

/** Query a wallet for an existing Character NFT. Returns the first one found, or null. */
export async function fetchCharacterNFT(
  client: SuiGrpcClient,
  owner: string,
): Promise<OnChainCharacter | null> {
  const { objects } = await client.listOwnedObjects({
    owner,
    type: CHARACTER_TYPE,
    include: { json: true },
  });

  if (objects.length === 0) return null;

  const obj = objects[0];
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
