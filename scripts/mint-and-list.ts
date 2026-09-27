#!/usr/bin/env tsx
/**
 * v5.3 — Mint items from a JSON catalog and list them in the TREASURY store.
 *
 *   cd server && npx tsx ../scripts/mint-and-list.ts ../items/starter-catalog.json            # dry run
 *   cd server && npx tsx ../scripts/mint-and-list.ts ../items/starter-catalog.json --execute  # for real
 *
 * Catalog entry (all stat keys optional, 0 when missing):
 *   {
 *     "name": "Iron Arming Sword",
 *     "image": "https://gateway.pinata.cloud/ipfs/<CID>/sword.png",   // or a path + IMAGE_BASE_URL
 *     "type": "weapon",            // weapon|shield|helmet|chest|gloves|boots|belt|ring|necklace|legs|bracers|earrings
 *     "twoHanded": false,          // weapons only
 *     "level": 3,
 *     "stats": { "STR": 1, "DEX": 0, "INT": 0, "END": 0, "HP": 0, "ARM": 0, "DEF": 0, "ATK": 0,
 *                "CRIT": 0, "CRITDMG": 0, "EVA": 0, "ANTICRIT": 0, "ANTIEVA": 0 },
 *     "damage": [2, 3],            // weapons only: [min, max]
 *     "price": 0.2,                // SUI
 *     "copies": 3
 *   }
 *
 * Every item is pre-checked against the on-chain limits (weapons/shields
 * level 3+, flat power ≤ cap(level), chance points ≤ 20) so a bad row fails
 * here, before any gas is spent.
 *
 * Env (server/.env): SUI_TREASURY_PRIVATE_KEY, SUI_PACKAGE_ID, ADMIN_CAP_ID,
 * KIOSK_REGISTRY_ID; optional TREASURY_KIOSK_ID / TREASURY_KIOSK_CAP_ID
 * (looked up from deployment.<net>-v5.3.json otherwise), IMAGE_BASE_URL.
 */
import { config as loadEnv } from 'dotenv';
import { join, resolve } from 'path';
import * as fs from 'fs';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const EXECUTE = process.argv.includes('--execute');
const FILE = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));
const NETWORK = (process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const BATCH = 20;
const LISTING_FEE_MIST = 10_000_000n;

const TYPES: Record<string, number> = { weapon: 1, shield: 2, helmet: 3, chest: 4, gloves: 5, boots: 6, belt: 7, ring: 8,
  necklace: 9, legs: 10, pants: 10, bracers: 11, bracelets: 11, earrings: 12 };
const STAT_ORDER = ['STR', 'DEX', 'INT', 'END', 'HP', 'ARM', 'DEF', 'ATK', 'CRIT', 'CRITDMG', 'EVA', 'ANTICRIT', 'ANTIEVA'] as const;

type Entry = { name: string; image: string; type: string; twoHanded?: boolean; level: number;
  stats?: Partial<Record<typeof STAT_ORDER[number], number>>; damage?: [number, number]; price: number; copies?: number };

function die(msg: string): never { console.error(`\n✖ ${msg}\n`); process.exit(1); }

// Mirrors contracts/sources/item.move limits.
function checkEntry(e: Entry): string | null {
  const type = TYPES[e.type];
  if (!type) return `unknown type "${e.type}"`;
  if (!e.name || e.name.length > 64) return 'name missing or too long';
  if (!(e.level >= 1 && e.level <= 20)) return 'level must be 1-20';
  if ((type === 1 || type === 2) && e.level < 3) return 'weapons and shields need level 3+';
  const s = e.stats ?? {};
  const [min, max] = e.damage ?? [0, 0];
  if (min > max) return 'damage min > max';
  if (type !== 1 && max > 0) return 'only weapons have damage';
  const flat = (s.HP ?? 0) + 7 * ((s.ARM ?? 0) + (s.DEF ?? 0) + (s.ATK ?? 0) + (s.END ?? 0)) + 6 * max + 5 * (s.STR ?? 0) + 3 * (s.DEX ?? 0);
  const cap = Math.floor((477 * e.level * e.level + 4620 * e.level + 10800) / 1000);
  if (flat > cap) return `flat power ${flat} > cap ${cap} for level ${e.level}`;
  const chance = 2 * (s.INT ?? 0) + (s.CRIT ?? 0) + (s.EVA ?? 0) + (s.ANTICRIT ?? 0) + (s.ANTIEVA ?? 0) + Math.floor((s.CRITDMG ?? 0) / 10);
  if (chance > 20) return `chance points ${chance} > 20`;
  if (!(e.price > 0)) return 'price must be > 0';
  return null;
}

async function main() {
  if (!FILE) die('usage: mint-and-list.ts <catalog.json> [--execute]');
  const entries: Entry[] = JSON.parse(fs.readFileSync(resolve(FILE), 'utf8'));
  let bad = 0;
  for (const e of entries) { const err = checkEntry(e); if (err) { bad++; console.error(`  ✖ ${e.name}: ${err}`); } }
  if (bad) die(`${bad} invalid catalog entries — nothing minted`);
  const total = entries.reduce((n, e) => n + (e.copies ?? 1), 0);
  console.log(`catalog OK: ${entries.length} designs, ${total} items`);

  const base = process.env.IMAGE_BASE_URL ?? '';
  const imageUrl = (img: string) => /^https?:\/\//.test(img) ? img : (base ? base.replace(/\/$/, '') + '/' + img.replace(/^\//, '') : die(`"${img}" is not a URL — set IMAGE_BASE_URL`));
  entries.forEach((e) => imageUrl(e.image));
  if (!EXECUTE) { console.log('Dry run OK. Re-run with --execute to mint + list.'); return; }

  const key = process.env.SUI_TREASURY_PRIVATE_KEY ?? die('SUI_TREASURY_PRIVATE_KEY missing');
  const { secretKey } = decodeSuiPrivateKey(key);
  const treasury = Ed25519Keypair.fromSecretKey(secretKey);
  const me = treasury.toSuiAddress();
  const client = new SuiJsonRpcClient({ url: process.env.SUI_RPC_URL ?? getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });
  const PKG = process.env.SUI_PACKAGE_ID ?? die('SUI_PACKAGE_ID missing');
  const ADMIN = process.env.ADMIN_CAP_ID ?? die('ADMIN_CAP_ID missing');
  let kiosk = process.env.TREASURY_KIOSK_ID, cap = process.env.TREASURY_KIOSK_CAP_ID;
  if (!kiosk || !cap) {
    const recFile = join(__dirname, '..', `deployment.${NETWORK}-v5.3.json`);
    if (!fs.existsSync(recFile)) die('TREASURY_KIOSK_ID / TREASURY_KIOSK_CAP_ID missing and no deployment record');
    const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
    kiosk = rec.treasuryKiosk; cap = rec.treasuryKioskOwnerCap;
  }

  const run = async (label: string, build: (tx: Transaction) => void) => {
    const tx = new Transaction(); build(tx);
    const res = await client.signAndExecuteTransaction({ transaction: tx, signer: treasury, options: { showEffects: true, showObjectChanges: true } });
    await client.waitForTransaction({ digest: res.digest });
    if (res.effects?.status?.status !== 'success') die(`${label} failed: ${res.effects?.status?.error}`);
    return res;
  };

  // Expand copies, then mint + list in batches.
  const queue: Entry[] = entries.flatMap((e) => Array.from({ length: e.copies ?? 1 }, () => e));
  let done = 0;
  for (let i = 0; i < queue.length; i += BATCH) {
    const chunk = queue.slice(i, i + BATCH);
    const minted = await run(`mint ${i}`, (tx) => {
      for (const e of chunk) {
        const s = e.stats ?? {};
        const [min, max] = e.damage ?? [0, 0];
        const slotType = TYPES[e.type] === 1 ? (e.twoHanded ? 2 : 0) : TYPES[e.type] === 2 ? 1 : 0;
        tx.moveCall({ target: `${PKG}::item::mint_item_admin`, arguments: [
          tx.object(ADMIN), tx.pure.string(e.name), tx.pure.string(imageUrl(e.image)),
          tx.pure.u8(TYPES[e.type]), tx.pure.u8(0), tx.pure.u8(e.level), tx.pure.u8(slotType),
          ...STAT_ORDER.map((k) => tx.pure.u16(s[k] ?? 0)), tx.pure.u16(min), tx.pure.u16(max),
        ] });
      }
    });
    const ids = (minted.objectChanges ?? []).filter((o: any) => o.type === 'created' && o.objectType?.endsWith('::item::Item')).map((o: any) => o.objectId as string);
    if (ids.length !== chunk.length) die(`minted ${ids.length}, expected ${chunk.length}`);
    await run(`list ${i}`, (tx) => {
      ids.forEach((id, j) => {
        const [fee] = tx.splitCoins(tx.gas, [tx.pure.u64(LISTING_FEE_MIST)]);
        tx.moveCall({ target: `${PKG}::marketplace::list_item`, arguments: [
          tx.object(kiosk!), tx.object(cap!), tx.object(id), tx.pure.u64(BigInt(Math.round(chunk[j].price * 1e9))), fee,
        ] });
      });
    });
    done += ids.length;
    console.log(`  ✔ ${done}/${queue.length} minted + listed`);
  }
  console.log(`\n✔ Store stocked (${me}). Items appear in the Marketplace once the server indexes the listings.`);
}

main().catch((e) => die(e?.message ?? String(e)));
