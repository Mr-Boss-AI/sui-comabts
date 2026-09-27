#!/usr/bin/env tsx
/**
 * v5.3 — ONE-SHOT fresh publish + setup on testnet (or mainnet).
 *
 *   cd server && npx tsx ../scripts/deploy-v5.3.ts            # dry run: builds + checks only
 *   cd server && npx tsx ../scripts/deploy-v5.3.ts --execute  # publishes for real
 *
 * Needs: the `sui` CLI on PATH (only to BUILD the bytecode — no CLI keystore
 * is used), and SUI_TREASURY_PRIVATE_KEY in server/.env. The key MUST be the
 * TREASURY wallet hardcoded in contracts/sources/arena.move (the script
 * checks) — settlement, guild fees and war payouts all route there.
 *
 * Transactions (all signed by TREASURY, ~0.3–0.6 SUI gas total):
 *   1. publish package            → AdminCap, Publisher, UpgradeCap, CharacterRegistry,
 *                                   OpenWagerRegistry, KioskRegistry, WarRegistry
 *   2. guild::create_guild_registry(AdminCap)                → GuildRegistry
 *   3. marketplace::setup_transfer_policy(Publisher)         → TransferPolicy<Item> + cap (2.5% royalty)
 *   4. display<Character> + display<Item>
 *   5. marketplace::create_or_get_player_kiosk(KioskRegistry) → TREASURY store kiosk
 *
 * Writes deployment.testnet-v5.3.json and prints the server + frontend env
 * blocks to paste (Railway Variables tab / Vercel env / local .env files).
 */
import { config as loadEnv } from 'dotenv';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const EXECUTE = process.argv.includes('--execute');
const NETWORK = (process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const SUI_BIN = process.env.SUI_BIN ?? 'sui';
const ROOT = resolve(__dirname, '..');
// Test-only overrides (localnet rehearsal): a contracts copy whose TREASURY
// matches the local key, a custom RPC, and where to write the record.
const CONTRACTS = process.env.CONTRACTS_DIR ?? join(ROOT, 'contracts');
const RPC_URL = process.env.SUI_RPC_URL;

function die(msg: string): never { console.error(`\n✖ ${msg}\n`); process.exit(1); }

async function main() {
  const key = process.env.SUI_TREASURY_PRIVATE_KEY;
  if (!key) die('SUI_TREASURY_PRIVATE_KEY missing in server/.env');
  const { scheme, secretKey } = decodeSuiPrivateKey(key);
  if (scheme !== 'ED25519') die(`expected ED25519 key, got ${scheme}`);
  const treasury = Ed25519Keypair.fromSecretKey(secretKey);
  const me = treasury.toSuiAddress();

  const arena = fs.readFileSync(join(CONTRACTS, 'sources/arena.move'), 'utf8');
  const hard = arena.match(/const TREASURY: address = @(0x[0-9a-f]+);/)?.[1];
  if (!hard) die('could not read TREASURY from arena.move');
  if (hard.toLowerCase() !== me.toLowerCase()) die(`key is ${me} but arena.move TREASURY is ${hard}`);

  const client = new SuiJsonRpcClient({ url: RPC_URL ?? getJsonRpcFullnodeUrl(NETWORK), network: NETWORK });
  const bal = BigInt((await client.getBalance({ owner: me })).totalBalance);
  console.log(`network   ${NETWORK}\ntreasury  ${me}\nbalance   ${Number(bal) / 1e9} SUI`);
  if (bal < 1_000_000_000n) die('need at least 1 SUI on TREASURY for gas');

  console.log('\n[1/5] building contracts …');
  const out = execSync(`${SUI_BIN} move build --dump-bytecode-as-base64 --path ${CONTRACTS}`, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024,
  });
  const { modules, dependencies } = JSON.parse(out.slice(out.indexOf('{')));
  console.log(`          ${modules.length} modules ready`);
  if (!EXECUTE) {
    console.log('\nDry run OK. Re-run with --execute to publish.\n');
    return;
  }

  const run = async (label: string, build: (tx: Transaction) => void) => {
    const tx = new Transaction();
    build(tx);
    const res = await client.signAndExecuteTransaction({
      transaction: tx, signer: treasury, options: { showEffects: true, showObjectChanges: true },
    });
    await client.waitForTransaction({ digest: res.digest });
    if (res.effects?.status?.status !== 'success') die(`${label} failed: ${res.effects?.status?.error} (${res.digest})`);
    console.log(`          ✔ ${label}  ${res.digest}`);
    return res;
  };
  const created = (res: any, suffix: string) => {
    const o = (res.objectChanges ?? []).find((c: any) => c.type === 'created' && c.objectType?.endsWith(suffix));
    if (!o) die(`no created ${suffix}`);
    return o.objectId as string;
  };

  console.log('[1/5] publishing …');
  const pub = await run('publish', (tx) => { const [cap] = tx.publish({ modules, dependencies }); tx.transferObjects([cap], me); });
  const PKG = (pub.objectChanges ?? []).find((o: any) => o.type === 'published') as any;
  const ids: Record<string, string> = {
    packageId: PKG.packageId,
    adminCap: created(pub, '::character::AdminCap'),
    publisher: created(pub, '::package::Publisher'),
    upgradeCap: created(pub, '::package::UpgradeCap'),
    characterRegistry: created(pub, '::character::CharacterRegistry'),
    openWagerRegistry: created(pub, '::arena::OpenWagerRegistry'),
    kioskRegistry: created(pub, '::marketplace::KioskRegistry'),
    warRegistry: created(pub, '::guild_war::WarRegistry'),
  };
  const t = (m: string, f: string) => `${ids.packageId}::${m}::${f}`;

  console.log('[2/5] guild registry …');
  const g = await run('create_guild_registry', (tx) => {
    tx.moveCall({ target: t('guild', 'create_guild_registry'), arguments: [tx.object(ids.adminCap), tx.object(ids.characterRegistry)] });
  });
  ids.guildRegistry = created(g, '::guild::GuildRegistry');

  console.log('[3/5] transfer policy (2.5% royalty) …');
  const tp = await run('setup_transfer_policy', (tx) => {
    tx.moveCall({ target: t('marketplace', 'setup_transfer_policy'), arguments: [tx.object(ids.publisher)] });
  });
  ids.transferPolicy = created(tp, '::transfer_policy::TransferPolicy<' + ids.packageId + '::item::Item>');
  ids.transferPolicyCap = created(tp, '::transfer_policy::TransferPolicyCap<' + ids.packageId + '::item::Item>');

  console.log('[4/5] display objects …');
  const disp = await run('display<Character> + display<Item>', (tx) => {
    const keys = ['name', 'description', 'image_url', 'link'];
    for (const [type, values] of [
      [`${ids.packageId}::character::Character`, ['{name}', 'SUI Combats fighter — level {level}.',
        'https://gateway.pinata.cloud/ipfs/bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy/character.png',
        `https://${NETWORK}.suivision.xyz/object/{id}`]],
      [`${ids.packageId}::item::Item`, ['{name}', 'SUI Combats item — level {level_req}+ required.', '{image_url}',
        `https://${NETWORK}.suivision.xyz/object/{id}`]],
    ] as [string, string[]][]) {
      const d = tx.moveCall({ target: '0x2::display::new_with_fields', typeArguments: [type],
        arguments: [tx.object(ids.publisher), tx.pure.vector('string', keys), tx.pure.vector('string', values)] });
      tx.moveCall({ target: '0x2::display::update_version', typeArguments: [type], arguments: [d] });
      tx.transferObjects([d], me);
    }
  });
  void disp;

  console.log('[5/5] TREASURY store kiosk …');
  const k = await run('create_or_get_player_kiosk', (tx) => {
    tx.moveCall({ target: t('marketplace', 'create_or_get_player_kiosk'), arguments: [tx.object(ids.kioskRegistry)] });
  });
  ids.treasuryKiosk = created(k, '::kiosk::Kiosk');
  ids.treasuryKioskOwnerCap = created(k, '::kiosk::KioskOwnerCap');

  const record = { version: 'v5.3', network: NETWORK, treasury: me, publishedAt: new Date().toISOString(),
    supersedes: 'deployment.testnet-v5.2.json', ...ids };
  const file = process.env.DEPLOY_OUT ?? join(ROOT, `deployment.${NETWORK}-v5.3.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');

  console.log(`\n✔ Deployed. Record: ${file}\n`);
  console.log('──── server env (Railway → Variables, one key at a time) ────');
  console.log(`SUI_PACKAGE_ID=${ids.packageId}
ADMIN_CAP_ID=${ids.adminCap}
PUBLISHER_OBJECT_ID=${ids.publisher}
TRANSFER_POLICY_ID=${ids.transferPolicy}
TRANSFER_POLICY_CAP_ID=${ids.transferPolicyCap}
CHARACTER_REGISTRY_ID=${ids.characterRegistry}
OPEN_WAGER_REGISTRY_ID=${ids.openWagerRegistry}
KIOSK_REGISTRY_ID=${ids.kioskRegistry}
GUILD_REGISTRY_ID=${ids.guildRegistry}
WAR_REGISTRY_ID=${ids.warRegistry}
PLATFORM_TREASURY=${me}`);
  console.log('\n──── frontend env (Vercel / frontend/.env.local) ────');
  console.log(`NEXT_PUBLIC_SUI_PACKAGE_ID=${ids.packageId}
NEXT_PUBLIC_TRANSFER_POLICY_ID=${ids.transferPolicy}
NEXT_PUBLIC_CHARACTER_REGISTRY_ID=${ids.characterRegistry}
NEXT_PUBLIC_OPEN_WAGER_REGISTRY_ID=${ids.openWagerRegistry}
NEXT_PUBLIC_KIOSK_REGISTRY_ID=${ids.kioskRegistry}
NEXT_PUBLIC_GUILD_REGISTRY_ID=${ids.guildRegistry}
NEXT_PUBLIC_WAR_REGISTRY_ID=${ids.warRegistry}
NEXT_PUBLIC_TREASURY_ADDRESS=${me}`);
}

main().catch((e) => die(e?.message ?? String(e)));
