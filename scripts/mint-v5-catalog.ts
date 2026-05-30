/**
 * v5 starter-catalog minter — 22 items spec'd by Shakalix.
 *
 * Mints all 22 items from the publisher wallet, then transfers items 1–11
 * to Mr_Boss and 12–22 to Sx. Updates deployment.testnet-v5.json with the
 * minted object IDs grouped by player.
 *
 * Run from repo root once the Pinata CID is known:
 *   NFT_IPFS_CID=bafybeie... \
 *     NODE_PATH=server/node_modules \
 *     ./server/node_modules/.bin/tsx scripts/mint-v5-catalog.ts
 *
 * Required env (loaded from server/.env via dotenv):
 *   SUI_NETWORK              testnet | mainnet
 *   SUI_PACKAGE_ID           v5 fresh-publish package id
 *   ADMIN_CAP_ID             AdminCap object id held by treasury
 *   SUI_TREASURY_PRIVATE_KEY treasury Ed25519 keypair (suiprivkey1...)
 *   NFT_IPFS_CID             Pinata folder CID containing all 22 PNGs
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { writeFileSync, readFileSync } from 'fs';

// ===== Constants from item.move =====
const TYPE = {
  WEAPON: 1, SHIELD: 2, HELMET: 3, CHEST: 4, GLOVES: 5,
  BOOTS: 6, BELT: 7, RING: 8, NECKLACE: 9,
} as const;
const RARITY = {
  COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5,
} as const;

type Bonuses = {
  strength?: number; dexterity?: number; intuition?: number; endurance?: number;
  hp?: number; armor?: number; defense?: number; attack?: number;
  critChance?: number; critMultiplier?: number; evasion?: number;
  antiCrit?: number; antiEvasion?: number;
};

interface ItemTemplate {
  index: number;
  recipient: 'mr_boss' | 'sx';
  filename: string;
  name: string;
  itemType: number;
  classReq: number;
  levelReq: number;
  rarity: number;
  bonuses: Bonuses;
  minDamage?: number;
  maxDamage?: number;
}

// ===== 22-item catalog per Shakalix spec =====
const CATALOG: ItemTemplate[] = [
  // ── Mr_Boss (Crit build) ──
  { index: 1,  recipient: 'mr_boss', filename: 'short_rusty_sword.png',           name: 'Short Rusty Sword',         itemType: TYPE.WEAPON, classReq: 0, levelReq: 1, rarity: RARITY.COMMON,   bonuses: {},                                                  minDamage: 2, maxDamage: 4 },
  { index: 2,  recipient: 'mr_boss', filename: 'longsword_game.png',              name: 'Longsword',                 itemType: TYPE.WEAPON, classReq: 0, levelReq: 2, rarity: RARITY.COMMON,   bonuses: { strength: 1 },                                     minDamage: 4, maxDamage: 7 },
  { index: 3,  recipient: 'mr_boss', filename: 'two_handed_steel_greatsword.png', name: 'Steel Greatsword',          itemType: TYPE.WEAPON, classReq: 0, levelReq: 5, rarity: RARITY.RARE,     bonuses: { strength: 3, attack: 2 },                          minDamage: 8, maxDamage: 14 },
  { index: 4,  recipient: 'mr_boss', filename: 'dark_cursed_greatsword.png',      name: 'Cursed Greatsword',         itemType: TYPE.WEAPON, classReq: 0, levelReq: 5, rarity: RARITY.EPIC,     bonuses: { intuition: 4, critChance: 5, critMultiplier: 20 }, minDamage: 10, maxDamage: 16 },
  { index: 5,  recipient: 'mr_boss', filename: 'simple_leather_chest_armor.png',  name: 'Leather Jerkin',            itemType: TYPE.CHEST,  classReq: 0, levelReq: 1, rarity: RARITY.COMMON,   bonuses: { hp: 5, armor: 2 } },
  { index: 6,  recipient: 'mr_boss', filename: 'chainmail.png',                   name: 'Chainmail Shirt',           itemType: TYPE.CHEST,  classReq: 0, levelReq: 3, rarity: RARITY.UNCOMMON, bonuses: { hp: 8, armor: 4, defense: 2 } },
  { index: 7,  recipient: 'mr_boss', filename: 'ornate_mithril_breastplate.png.png', name: 'Ornate Mithril Breastplate', itemType: TYPE.CHEST, classReq: 0, levelReq: 5, rarity: RARITY.RARE, bonuses: { hp: 12, armor: 6, defense: 4, endurance: 2 } },
  { index: 8,  recipient: 'mr_boss', filename: 'copper_ring.png',                 name: 'Copper Band',               itemType: TYPE.RING,   classReq: 0, levelReq: 1, rarity: RARITY.COMMON,   bonuses: { intuition: 1 } },
  { index: 9,  recipient: 'mr_boss', filename: 'silver_signet_ring.png',          name: 'Silver Signet',             itemType: TYPE.RING,   classReq: 0, levelReq: 3, rarity: RARITY.UNCOMMON, bonuses: { intuition: 2, critChance: 2 } },
  { index: 10, recipient: 'mr_boss', filename: 'magical_gold_ring.png',           name: 'Magic Ring',                itemType: TYPE.RING,   classReq: 0, levelReq: 5, rarity: RARITY.RARE,     bonuses: { intuition: 3, critChance: 3, critMultiplier: 15 } },
  { index: 11, recipient: 'mr_boss', filename: 'wooden_buckler_shield.png',       name: 'Wooden Buckler',            itemType: TYPE.SHIELD, classReq: 0, levelReq: 1, rarity: RARITY.COMMON,   bonuses: { armor: 2, defense: 1 } },

  // ── Sx (Evasion build) ──
  { index: 12, recipient: 'sx',      filename: 'Rusty_Dagger.png',                name: 'Rusty Dagger',              itemType: TYPE.WEAPON, classReq: 0, levelReq: 1, rarity: RARITY.COMMON,   bonuses: { dexterity: 1 },                                    minDamage: 1, maxDamage: 3 },
  { index: 13, recipient: 'sx',      filename: 'Hunters_Knife.png',               name: "Hunter's Knife",            itemType: TYPE.WEAPON, classReq: 0, levelReq: 2, rarity: RARITY.COMMON,   bonuses: { dexterity: 2, evasion: 1 },                        minDamage: 2, maxDamage: 4 },
  { index: 14, recipient: 'sx',      filename: 'Twin_Stilettos.png',              name: 'Twin Stilettos',            itemType: TYPE.WEAPON, classReq: 0, levelReq: 2, rarity: RARITY.UNCOMMON, bonuses: { dexterity: 3, antiEvasion: 2 },                    minDamage: 2, maxDamage: 4 },
  { index: 15, recipient: 'sx',      filename: 'Shadow_Kris.png',                 name: 'Shadow Kris',               itemType: TYPE.WEAPON, classReq: 0, levelReq: 3, rarity: RARITY.RARE,     bonuses: { dexterity: 4, evasion: 3, critChance: 2 },         minDamage: 3, maxDamage: 6 },
  { index: 16, recipient: 'sx',      filename: 'Tattered_Cloth_Vest.png',         name: 'Tattered Cloth Vest',       itemType: TYPE.CHEST,  classReq: 0, levelReq: 1, rarity: RARITY.COMMON,   bonuses: { hp: 3, evasion: 1 } },
  { index: 17, recipient: 'sx',      filename: 'Studded_Leather_Armor.png',       name: 'Studded Leather',           itemType: TYPE.CHEST,  classReq: 0, levelReq: 2, rarity: RARITY.COMMON,   bonuses: { hp: 5, evasion: 2 } },
  { index: 18, recipient: 'sx',      filename: 'Assassins_Garb.png',              name: "Assassin's Garb",           itemType: TYPE.CHEST,  classReq: 0, levelReq: 3, rarity: RARITY.UNCOMMON, bonuses: { hp: 6, evasion: 3, dexterity: 1 } },
  { index: 19, recipient: 'sx',      filename: 'Bone_Ring.png',                   name: 'Bone Ring',                 itemType: TYPE.RING,   classReq: 0, levelReq: 1, rarity: RARITY.COMMON,   bonuses: { dexterity: 1 } },
  // Wind_Band and Phantom_Loop now have distinct PNGs — separate art per
  // item, even though stat budgets and slot are the same family.
  { index: 20, recipient: 'sx',      filename: 'Wind_Band.png',                   name: 'Wind Band',                 itemType: TYPE.RING,   classReq: 0, levelReq: 2, rarity: RARITY.UNCOMMON, bonuses: { dexterity: 2, evasion: 1 } },
  { index: 21, recipient: 'sx',      filename: 'Phantom_Loop.png',                name: 'Phantom Loop',              itemType: TYPE.RING,   classReq: 0, levelReq: 3, rarity: RARITY.RARE,     bonuses: { dexterity: 3, evasion: 2, antiCrit: 2 } },
  { index: 22, recipient: 'sx',      filename: 'Parrying_Dirk.png',               name: 'Parrying Dirk',             itemType: TYPE.WEAPON, classReq: 0, levelReq: 2, rarity: RARITY.COMMON,   bonuses: { dexterity: 2 },                                    minDamage: 1, maxDamage: 3 },
];

const PLAYER_WALLETS = {
  mr_boss: '0x06d6cb677518cc70884df24541d91d7a1d2ca5db2d8628a69568172652239624',
  sx:      '0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b',
} as const;

const DEPLOYMENT_PATH = join(__dirname, '..', 'deployment.testnet-v5.json');

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Required env var ${name} is not set. Check server/.env`);
  }
  return v.trim();
}

async function main() {
  const network = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  const packageId = envOrThrow('SUI_PACKAGE_ID');
  const adminCapId = envOrThrow('ADMIN_CAP_ID');
  const privateKey = envOrThrow('SUI_TREASURY_PRIVATE_KEY');
  const cid = envOrThrow('NFT_IPFS_CID');

  const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519, got ${scheme}`);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const sender = keypair.toSuiAddress();
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

  const gateway = `https://gateway.pinata.cloud/ipfs/${cid}`;
  console.log(`[mint-v5-catalog] Sender: ${sender}`);
  console.log(`[mint-v5-catalog] Package: ${packageId}`);
  console.log(`[mint-v5-catalog] IPFS gateway base: ${gateway}`);
  console.log(`[mint-v5-catalog] Minting ${CATALOG.length} items…`);

  type MintedItem = {
    index: number;
    name: string;
    itemType: number;
    rarity: number;
    recipient: 'mr_boss' | 'sx';
    objectId: string;
    transferDigest: string;
  };
  const minted: MintedItem[] = [];

  for (const item of CATALOG) {
    const imageUrl = `${gateway}/${encodeURIComponent(item.filename)}`;

    // Mint to the publisher (sender) first.
    const mintTx = new Transaction();
    const b = item.bonuses;
    mintTx.moveCall({
      target: `${packageId}::item::mint_item_admin`,
      arguments: [
        mintTx.object(adminCapId),
        mintTx.pure.string(item.name),
        mintTx.pure.string(imageUrl),
        mintTx.pure.u8(item.itemType),
        mintTx.pure.u8(item.classReq),
        mintTx.pure.u8(item.levelReq),
        mintTx.pure.u8(item.rarity),
        mintTx.pure.u16(b.strength       ?? 0),
        mintTx.pure.u16(b.dexterity      ?? 0),
        mintTx.pure.u16(b.intuition      ?? 0),
        mintTx.pure.u16(b.endurance      ?? 0),
        mintTx.pure.u16(b.hp             ?? 0),
        mintTx.pure.u16(b.armor          ?? 0),
        mintTx.pure.u16(b.defense        ?? 0),
        mintTx.pure.u16(b.attack         ?? 0),
        mintTx.pure.u16(b.critChance     ?? 0),
        mintTx.pure.u16(b.critMultiplier ?? 0),
        mintTx.pure.u16(b.evasion        ?? 0),
        mintTx.pure.u16(b.antiCrit       ?? 0),
        mintTx.pure.u16(b.antiEvasion    ?? 0),
        mintTx.pure.u16(item.minDamage   ?? 0),
        mintTx.pure.u16(item.maxDamage   ?? 0),
      ],
    });
    mintTx.setGasBudget(50_000_000);

    const mintResult = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: mintTx,
      options: { showEffects: true },
    });
    // Wait until the chain has fully indexed this tx before submitting the
    // next one. Without this, the next signAndExecuteTransaction picks a
    // stale gas-coin version and fails with "object version unavailable".
    await client.waitForTransaction({ digest: mintResult.digest });
    if (mintResult.effects?.status?.status !== 'success') {
      console.error(`[mint] FAIL #${item.index} ${item.name}: ${mintResult.effects?.status?.error}`);
      continue;
    }

    const created = mintResult.effects?.created ?? [];
    const newObj = created.find((c) => {
      const owner = c.owner;
      const ownerAddr = typeof owner === 'object' && owner && 'AddressOwner' in owner
        ? (owner as { AddressOwner: string }).AddressOwner
        : null;
      return ownerAddr === sender;
    });
    const objectId = newObj?.reference?.objectId ?? '';
    if (!objectId) {
      console.error(`[mint] #${item.index} ${item.name}: no created object found in effects`);
      continue;
    }

    // Transfer to the recipient. A separate tx because using the freshly-
    // minted object in the same PTB requires keeping the result handle around,
    // which complicates sequential minting; the network round-trip cost is
    // negligible for 22 items.
    const recipientAddr = PLAYER_WALLETS[item.recipient];
    const transferTx = new Transaction();
    transferTx.transferObjects(
      [transferTx.object(objectId)],
      transferTx.pure.address(recipientAddr),
    );
    transferTx.setGasBudget(20_000_000);

    const transferResult = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: transferTx,
      options: { showEffects: true },
    });
    await client.waitForTransaction({ digest: transferResult.digest });
    if (transferResult.effects?.status?.status !== 'success') {
      console.error(`[transfer] FAIL #${item.index} ${item.name}: ${transferResult.effects?.status?.error}`);
      continue;
    }

    minted.push({
      index: item.index,
      name: item.name,
      itemType: item.itemType,
      rarity: item.rarity,
      recipient: item.recipient,
      objectId,
      transferDigest: transferResult.digest,
    });
    console.log(
      `[OK] #${item.index.toString().padStart(2, ' ')} ${item.name.padEnd(28)} → ${item.recipient.padEnd(7)} ${objectId} (mint ${mintResult.digest.slice(0, 10)}…, xfer ${transferResult.digest.slice(0, 10)}…)`,
    );
  }

  // Persist back to deployment file
  try {
    const raw = readFileSync(DEPLOYMENT_PATH, 'utf8');
    const json = JSON.parse(raw);
    json.starterItemIds = minted;
    json.starterMintedAt = new Date().toISOString();
    json.nftIpfsCid = cid;
    writeFileSync(DEPLOYMENT_PATH, JSON.stringify(json, null, 2) + '\n');
    console.log(`[mint-v5-catalog] Updated ${DEPLOYMENT_PATH}`);
  } catch (err) {
    console.warn(`[mint-v5-catalog] Could not update deployment file: ${(err as Error).message}`);
  }

  console.log(`[mint-v5-catalog] Done. ${minted.length}/${CATALOG.length} items minted + transferred.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
