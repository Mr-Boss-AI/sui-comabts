/**
 * Lv6-Lv8 NFT catalog minter — 9 items minted to TREASURY's kiosk and listed on
 * the marketplace for browse / buy / equip-replace testing by Mr_Boss + Sx.
 *
 * Goals:
 *   1. Test the marketplace UI with higher-Lv items (Lv6-8) the players don't
 *      yet own.
 *   2. Test how the UI renders DUPLICATE listings (Dancer's Aegis × 2 — same
 *      stats, same image, two different prices).
 *   3. Provide gear that Mr_Boss + Sx can buy and slot in to validate the
 *      equip-replace flow against new on-chain NFTs.
 *
 * Architecture:
 *   - Step 0: discover-or-create TREASURY's kiosk (the publisher wallet has no
 *     kiosk in the v5 deploy yet — `getOwnedObjects` confirms 0 KioskOwnerCaps
 *     at script-write time).
 *   - Step 1..N: per item, two txs:
 *       (a) mint_item_admin            — Item lands in TREASURY's wallet
 *       (b) marketplace::list_item     — place + list in TREASURY's kiosk
 *     `mint_item_admin` is `public fun ... transfer::public_transfer(item, owner)`,
 *     which gives no PTB result handle, so a single mint+list PTB is impossible
 *     without a contract change. Two txs per item is the only path.
 *   - waitForTransaction between every tx to dodge the gas-coin version race
 *     that bit the original v5 catalog run (cf. scripts/mint-one.ts comment).
 *   - Per-item try/catch: a single failure logs and continues; the batch never
 *     aborts. The end-of-run report prints success / fail counts plus every
 *     captured object id.
 *
 * Run from repo root:
 *   ./server/node_modules/.bin/tsx scripts/mint-lv6-8-catalog.ts
 *
 * Required env (loaded from server/.env via dotenv):
 *   SUI_NETWORK              testnet | mainnet
 *   SUI_PACKAGE_ID           v5 fresh-publish package id
 *   ADMIN_CAP_ID             AdminCap object id held by treasury
 *   SUI_TREASURY_PRIVATE_KEY treasury Ed25519 keypair (suiprivkey1...)
 *   PLATFORM_TREASURY        treasury address (listing-fee recipient)
 */
// Run with `NODE_PATH=server/node_modules` (or from /server) so the SDK +
// dotenv resolve. qa-mint-catalog.ts uses the same NODE_PATH invocation;
// see the bottom of this file for the full command line.
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { writeFileSync, readFileSync, existsSync } from 'fs';

// ===== Constants from item.move =====
export const TYPE = {
  WEAPON: 1, SHIELD: 2, HELMET: 3, CHEST: 4, GLOVES: 5,
  BOOTS: 6, BELT: 7, RING: 8, NECKLACE: 9,
} as const;

export const RARITY = {
  COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5,
} as const;

// ===== Constants from marketplace.move =====
const LISTING_FEE_MIST = 10_000_000n; // 0.01 SUI flat per list call

// ===== Catalog spec =====
//
// All bonus values are u16 stat-bonus integers as the chain stores them. For
// crit_multiplier_bonus the unit is *basis points of multiplier* — e.g. 25 →
// +0.25× crit damage. evasion / crit_chance are integer percent points.
//
// Index 7 + 8 are intentional duplicates of Dancer's Aegis with identical
// stats, identical image, but different list prices. The on-chain NFT name
// is "Dancer's Aegis" for both — the "(A)" / "(B)" suffix is script-only.

export interface ItemBonuses {
  strength?: number;
  dexterity?: number;
  intuition?: number;
  endurance?: number;
  hp?: number;
  armor?: number;
  defense?: number;
  attack?: number;
  critChance?: number;
  critMultiplier?: number;
  evasion?: number;
  antiCrit?: number;
  antiEvasion?: number;
}

export interface CatalogItem {
  index: number;             // 1..9, script-only ordering key
  variantTag: string;        // e.g. "(A)" / "(B)" for the two shields, "" otherwise
  filename: string;          // exact-case PNG filename inside the Pinata folder
  name: string;              // on-chain NFT name (duplicates allowed)
  itemType: number;          // TYPE.* (1..9)
  classReq: number;
  levelReq: number;          // ≤ 20 (MAX_LEVEL_REQ)
  rarity: number;            // RARITY.* (1..5)
  bonuses: ItemBonuses;      // each bonus ≤ 1000 (MAX_BONUS)
  minDamage?: number;
  maxDamage?: number;
  priceSui: number;          // listing price in SUI
}

export const PINATA_CID = 'bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i';

export const CATALOG: CatalogItem[] = [
  {
    index: 1, variantTag: '',
    filename: 'Bloodletter_Gauntlets.png',
    name: 'Bloodletter Gauntlets',
    itemType: TYPE.GLOVES, classReq: 0, levelReq: 6, rarity: RARITY.EPIC,
    bonuses: { critChance: 8, critMultiplier: 25, attack: 4, antiEvasion: 3 },
    priceSui: 0.12,
  },
  {
    index: 2, variantTag: '',
    filename: 'Shadowstep_Wraps.png',
    name: 'Shadowstep Wraps',
    itemType: TYPE.GLOVES, classReq: 0, levelReq: 6, rarity: RARITY.EPIC,
    bonuses: { evasion: 6, dexterity: 3, defense: 4 },
    priceSui: 0.08,
  },
  {
    index: 3, variantTag: '',
    filename: 'Skullsplitter_Helm.png',
    name: 'Skullsplitter Helm',
    itemType: TYPE.HELMET, classReq: 0, levelReq: 7, rarity: RARITY.EPIC,
    bonuses: { hp: 25, critChance: 5, critMultiplier: 20, intuition: 4 },
    priceSui: 0.22,
  },
  {
    index: 4, variantTag: '',
    filename: 'Hunters_Hood.png',
    name: "Hunter's Hood",
    itemType: TYPE.HELMET, classReq: 0, levelReq: 7, rarity: RARITY.EPIC,
    bonuses: { hp: 20, evasion: 5, antiCrit: 4, dexterity: 3 },
    priceSui: 0.18,
  },
  {
    index: 5, variantTag: '',
    filename: 'Pendant_of_Wrath.png',
    name: 'Pendant of Wrath',
    itemType: TYPE.NECKLACE, classReq: 0, levelReq: 8, rarity: RARITY.LEGENDARY,
    bonuses: { intuition: 6, critChance: 6, critMultiplier: 30, attack: 5 },
    priceSui: 0.3,
  },
  {
    index: 6, variantTag: '',
    filename: 'Whisperwind_Amulet.png',
    name: 'Whisperwind Amulet',
    itemType: TYPE.NECKLACE, classReq: 0, levelReq: 8, rarity: RARITY.LEGENDARY,
    bonuses: { dexterity: 6, evasion: 7, defense: 5, endurance: 3 },
    priceSui: 0.3,
  },
  {
    index: 7, variantTag: '(A)',
    filename: 'Dancers_Aegis.png',
    name: "Dancer's Aegis",
    itemType: TYPE.SHIELD, classReq: 0, levelReq: 6, rarity: RARITY.EPIC,
    bonuses: { armor: 4, defense: 8, evasion: 5, dexterity: 3, endurance: 2 },
    priceSui: 0.15,
  },
  {
    index: 8, variantTag: '(B)',
    filename: 'Dancers_Aegis.png',                     // same file as (A)
    name: "Dancer's Aegis",                            // same on-chain name as (A)
    itemType: TYPE.SHIELD, classReq: 0, levelReq: 6, rarity: RARITY.EPIC,
    bonuses: { armor: 4, defense: 8, evasion: 5, dexterity: 3, endurance: 2 }, // identical
    priceSui: 0.17,                                    // different price (UI-distinguish test)
  },
  {
    index: 9, variantTag: '',
    filename: 'Skullcrusher_Maul.png',
    name: 'Skullcrusher Maul',
    itemType: TYPE.WEAPON, classReq: 0, levelReq: 6, rarity: RARITY.EPIC,
    // No slot_type field on Item yet — currently slottable as mainhand, offhand
    // stays free. The "occupies both hands" mechanic is a v5.1+ design seed
    // (see project_slot_type_seed.md memory + STATUS.md backlog).
    bonuses: { strength: 5, intuition: 3, critChance: 5, critMultiplier: 30 },
    minDamage: 8, maxDamage: 14,
    priceSui: 0.5,
  },
];

const DEPLOYMENT_PATH = join(__dirname, '..', 'deployment.testnet-v5.json');

// ============================================================================
// Helpers
// ============================================================================

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Required env var ${name} is not set. Check server/.env`);
  }
  return v.trim();
}

/** SUI (number) → MIST (bigint), rounded down at 9 decimals. */
export function suiToMist(sui: number): bigint {
  if (!Number.isFinite(sui) || sui <= 0) return 0n;
  const fixed = sui.toFixed(9);
  const [whole, frac = ''] = fixed.split('.');
  return BigInt(whole) * 1_000_000_000n + BigInt((frac + '000000000').slice(0, 9));
}

function mistToSui(mist: bigint | number | string): string {
  const n = typeof mist === 'bigint' ? Number(mist) : Number(mist);
  return (n / 1_000_000_000).toFixed(9).replace(/\.?0+$/, '');
}

function pinataUrl(filename: string): string {
  // Filenames are ASCII-safe (underscores + alphanum), but encode anyway as
  // defense in depth — protects against future filenames with apostrophes etc.
  return `https://gateway.pinata.cloud/ipfs/${PINATA_CID}/${encodeURIComponent(filename)}`;
}

// ============================================================================
// Pre-flight catalog validation (mirrors qa-mint-catalog.ts assertions —
// duplicated here so a script invocation in isolation also fails fast)
// ============================================================================

const MAX_BONUS = 1000;     // item.move::MAX_BONUS
const MAX_LEVEL_REQ = 20;   // item.move::MAX_LEVEL_REQ

function validateCatalog(): void {
  const errors: string[] = [];

  for (const item of CATALOG) {
    const tag = `#${item.index} ${item.name}${item.variantTag ? ' ' + item.variantTag : ''}`;

    if (item.itemType < TYPE.WEAPON || item.itemType > TYPE.NECKLACE) {
      errors.push(`${tag}: invalid itemType ${item.itemType} (must be 1..9)`);
    }
    if (item.rarity < RARITY.COMMON || item.rarity > RARITY.LEGENDARY) {
      errors.push(`${tag}: invalid rarity ${item.rarity} (must be 1..5)`);
    }
    if (item.levelReq > MAX_LEVEL_REQ) {
      errors.push(`${tag}: levelReq ${item.levelReq} > MAX_LEVEL_REQ ${MAX_LEVEL_REQ}`);
    }
    if (item.classReq < 0) {
      errors.push(`${tag}: classReq ${item.classReq} negative`);
    }

    for (const [k, v] of Object.entries(item.bonuses)) {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        errors.push(`${tag}: bonus ${k}=${v} not a finite number`);
        continue;
      }
      if (v < 0 || v > MAX_BONUS) {
        errors.push(`${tag}: bonus ${k}=${v} out of [0..${MAX_BONUS}]`);
      }
    }

    const minD = item.minDamage ?? 0;
    const maxD = item.maxDamage ?? 0;
    if (minD > maxD) {
      errors.push(`${tag}: minDamage ${minD} > maxDamage ${maxD}`);
    }
    if (maxD > MAX_BONUS) {
      errors.push(`${tag}: maxDamage ${maxD} > ${MAX_BONUS}`);
    }
    // Weapons must have damage range; non-weapons must not
    if (item.itemType === TYPE.WEAPON) {
      if (maxD === 0) errors.push(`${tag}: weapon with zero maxDamage`);
    } else if (minD !== 0 || maxD !== 0) {
      errors.push(`${tag}: non-weapon with damage range ${minD}-${maxD}`);
    }

    if (item.priceSui <= 0) {
      errors.push(`${tag}: priceSui ${item.priceSui} not positive`);
    }
    if (!item.filename.endsWith('.png')) {
      errors.push(`${tag}: filename ${item.filename} not a .png`);
    }
  }

  if (errors.length > 0) {
    console.error('[mint-lv6-8] Catalog validation FAILED:');
    for (const e of errors) console.error('  - ' + e);
    throw new Error('Catalog validation failed — refusing to mint.');
  }
  console.log(`[mint-lv6-8] Catalog validation OK (${CATALOG.length} items).`);
}

// ============================================================================
// Kiosk discovery / creation
// ============================================================================

interface KioskInfo {
  kioskId: string;
  capId: string;
  created: boolean;
  digest?: string;
}

async function discoverOrCreateKiosk(
  client: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  packageId: string,
): Promise<KioskInfo> {
  const sender = keypair.toSuiAddress();

  // 1. Try to discover an existing KioskOwnerCap.
  const owned = await client.getOwnedObjects({
    owner: sender,
    filter: { StructType: '0x2::kiosk::KioskOwnerCap' },
    options: { showContent: true, showType: true },
    limit: 50,
  });

  for (const r of owned.data) {
    const data = r.data;
    if (!data) continue;
    const content = data.content as { dataType?: string; fields?: Record<string, unknown> } | undefined;
    if (content?.dataType !== 'moveObject') continue;
    const forKiosk = content.fields?.for;
    if (typeof forKiosk === 'string' && forKiosk.startsWith('0x')) {
      console.log(`[kiosk] Reusing existing TREASURY kiosk: ${forKiosk}`);
      console.log(`[kiosk]   cap object: ${data.objectId}`);
      return { kioskId: forKiosk, capId: data.objectId, created: false };
    }
  }

  // 2. None found — create one.
  console.log('[kiosk] No KioskOwnerCap found for TREASURY — creating one…');
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::marketplace::create_player_kiosk`,
    arguments: [],
  });
  tx.setGasBudget(50_000_000);

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: result.digest });

  if (result.effects?.status?.status !== 'success') {
    throw new Error(`create_player_kiosk failed: ${result.effects?.status?.error}`);
  }

  let kioskId = '';
  let capId = '';
  for (const c of result.effects?.created ?? []) {
    const owner = c.owner;
    if (typeof owner === 'object' && owner !== null) {
      if ('Shared' in (owner as object)) {
        kioskId = c.reference.objectId;
      } else if ('AddressOwner' in (owner as object)) {
        capId = c.reference.objectId;
      }
    }
  }

  if (!kioskId || !capId) {
    throw new Error(
      `Could not extract kiosk + cap IDs from create_player_kiosk effects (digest=${result.digest})`,
    );
  }

  console.log(`[kiosk] Created TREASURY kiosk: ${kioskId}`);
  console.log(`[kiosk]   cap object:           ${capId}`);
  console.log(`[kiosk]   create digest:        ${result.digest}`);
  return { kioskId, capId, created: true, digest: result.digest };
}

// ============================================================================
// Per-item: mint then list
// ============================================================================

interface MintResult {
  index: number;
  variantTag: string;
  name: string;
  itemType: number;
  rarity: number;
  levelReq: number;
  filename: string;
  imageUrl: string;
  priceSui: number;
  priceMist: string;
  objectId: string;
  mintDigest: string;
  listDigest: string;
}

async function mintAndList(
  item: CatalogItem,
  client: SuiJsonRpcClient,
  keypair: Ed25519Keypair,
  packageId: string,
  adminCapId: string,
  kioskId: string,
  capId: string,
  treasuryAddr: string,
): Promise<MintResult> {
  const sender = keypair.toSuiAddress();
  const imageUrl = pinataUrl(item.filename);
  const b = item.bonuses;

  // ----- Step (a): mint_item_admin -----
  const mintTx = new Transaction();
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

  const mintRes = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: mintTx,
    options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: mintRes.digest });
  if (mintRes.effects?.status?.status !== 'success') {
    throw new Error(`mint failed: ${mintRes.effects?.status?.error}`);
  }

  // The newly minted Item is the only created object owned by sender that
  // isn't gas-related. `mint_item_admin` ends with `public_transfer(item, sender)`.
  const created = mintRes.effects?.created ?? [];
  const mintedObj = created.find((c) => {
    const o = c.owner;
    return typeof o === 'object' && o !== null && 'AddressOwner' in (o as object) &&
      (o as { AddressOwner: string }).AddressOwner === sender;
  });
  const objectId = mintedObj?.reference?.objectId ?? '';
  if (!objectId) {
    throw new Error(`mint produced no AddressOwner-owned object (digest=${mintRes.digest})`);
  }

  // ----- Step (b): marketplace::list_item -----
  const priceMist = suiToMist(item.priceSui);
  const listTx = new Transaction();
  const [feeCoin] = listTx.splitCoins(listTx.gas, [listTx.pure.u64(LISTING_FEE_MIST)]);
  listTx.moveCall({
    target: `${packageId}::marketplace::list_item`,
    arguments: [
      listTx.object(kioskId),
      listTx.object(capId),
      listTx.object(objectId),
      listTx.pure.u64(priceMist),
      feeCoin,
      listTx.pure.address(treasuryAddr),
    ],
  });
  listTx.setGasBudget(50_000_000);

  const listRes = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: listTx,
    options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: listRes.digest });
  if (listRes.effects?.status?.status !== 'success') {
    throw new Error(`list failed (item ${objectId} minted; recover via kiosk place + list manually): ${listRes.effects?.status?.error}`);
  }

  return {
    index: item.index,
    variantTag: item.variantTag,
    name: item.name,
    itemType: item.itemType,
    rarity: item.rarity,
    levelReq: item.levelReq,
    filename: item.filename,
    imageUrl,
    priceSui: item.priceSui,
    priceMist: priceMist.toString(),
    objectId,
    mintDigest: mintRes.digest,
    listDigest: listRes.digest,
  };
}

// ============================================================================
// Deployment.json patcher
// ============================================================================

interface CatalogV51Block {
  mintedAt: string;
  pinataCid: string;
  recipient: 'treasury';
  treasuryAddress: string;
  kiosk: { kioskId: string; capId: string; createdThisRun: boolean; createDigest?: string };
  items: Array<MintResult & { variantTag: string }>;
}

function persistDeploymentBlock(block: CatalogV51Block): void {
  if (!existsSync(DEPLOYMENT_PATH)) {
    console.warn(`[mint-lv6-8] ${DEPLOYMENT_PATH} not found — skipping deployment patch.`);
    return;
  }
  const raw = readFileSync(DEPLOYMENT_PATH, 'utf8');
  const json = JSON.parse(raw);
  json.nft_catalog_v5_1 = block;
  writeFileSync(DEPLOYMENT_PATH, JSON.stringify(json, null, 2) + '\n');
  console.log(`[mint-lv6-8] Updated ${DEPLOYMENT_PATH}::nft_catalog_v5_1`);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  validateCatalog();

  const network = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  const packageId = envOrThrow('SUI_PACKAGE_ID');
  const adminCapId = envOrThrow('ADMIN_CAP_ID');
  const treasuryAddr = envOrThrow('PLATFORM_TREASURY');
  const privateKey = envOrThrow('SUI_TREASURY_PRIVATE_KEY');

  const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519 key, got ${scheme}`);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const sender = keypair.toSuiAddress();
  if (sender.toLowerCase() !== treasuryAddr.toLowerCase()) {
    throw new Error(
      `SUI_TREASURY_PRIVATE_KEY decodes to ${sender} but PLATFORM_TREASURY is ${treasuryAddr} — mismatch.`,
    );
  }
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

  console.log('────────────────────────────────────────────────────────────');
  console.log(' SUI Combats — Lv6-Lv8 NFT catalog mint+list');
  console.log('────────────────────────────────────────────────────────────');
  console.log(` Network:   ${network}`);
  console.log(` Sender:    ${sender}`);
  console.log(` Package:   ${packageId}`);
  console.log(` AdminCap:  ${adminCapId}`);
  console.log(` Pinata:    https://gateway.pinata.cloud/ipfs/${PINATA_CID}/`);
  console.log(` Items:     ${CATALOG.length}  (one duplicate shield pair)`);

  // Balance pre-check (informational — chain will gas-fail if too low).
  const balPre = await client.getBalance({ owner: sender });
  console.log(` Treasury balance pre-run: ${mistToSui(balPre.totalBalance)} SUI`);

  // Step 0 — discover or create kiosk
  const kiosk = await discoverOrCreateKiosk(client, keypair, packageId);

  // Step 1..N — mint + list each item
  const results: MintResult[] = [];
  const failures: Array<{ item: CatalogItem; error: string }> = [];

  for (const item of CATALOG) {
    const tag = `#${item.index}${item.variantTag ? ' ' + item.variantTag : '   '}`;
    process.stdout.write(`[mint+list] ${tag} ${item.name.padEnd(28)} `);
    try {
      const r = await mintAndList(
        item, client, keypair, packageId, adminCapId,
        kiosk.kioskId, kiosk.capId, treasuryAddr,
      );
      results.push(r);
      process.stdout.write(
        `→ ${r.objectId.slice(0, 10)}…${r.objectId.slice(-4)}` +
        `  @ ${r.priceSui} SUI  ` +
        `(mint ${r.mintDigest.slice(0, 8)}…, list ${r.listDigest.slice(0, 8)}…)\n`,
      );
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      process.stdout.write(`× ${msg}\n`);
      failures.push({ item, error: msg });
    }
  }

  // Persist results to deployment.testnet-v5.json
  if (results.length > 0) {
    persistDeploymentBlock({
      mintedAt: new Date().toISOString(),
      pinataCid: PINATA_CID,
      recipient: 'treasury',
      treasuryAddress: treasuryAddr,
      kiosk: {
        kioskId: kiosk.kioskId,
        capId: kiosk.capId,
        createdThisRun: kiosk.created,
        createDigest: kiosk.digest,
      },
      items: results,
    });
  }

  // Final balance + summary
  const balPost = await client.getBalance({ owner: sender });
  const spent = (Number(balPre.totalBalance) - Number(balPost.totalBalance)) / 1_000_000_000;

  console.log('────────────────────────────────────────────────────────────');
  console.log(` Treasury balance post-run: ${mistToSui(balPost.totalBalance)} SUI`);
  console.log(` Spent: ~${spent.toFixed(6)} SUI (gas + ${results.length} × 0.01 listing fee)`);
  console.log(` Minted+listed: ${results.length}/${CATALOG.length}`);
  if (failures.length > 0) {
    console.log(' Failures:');
    for (const f of failures) {
      console.log(`   #${f.item.index} ${f.item.name}${f.item.variantTag ? ' ' + f.item.variantTag : ''}: ${f.error}`);
    }
  }
  console.log('────────────────────────────────────────────────────────────');

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

// Only run main when invoked directly — qa-mint-catalog.ts imports the
// catalog symbols above without firing the chain calls.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
