/**
 * v5 Sui Object Display registration.
 *
 * Creates Display<Character> and Display<Item> using the package Publisher,
 * populates the standard fields (name, description, image_url, thumbnail_url,
 * project_url, creator), bumps the version, and writes the resulting Display
 * object IDs back into deployment.testnet-v5.json.
 *
 * Reference: https://docs.sui.io/standards/display
 *
 * Run from repo root:
 *   npx ts-node scripts/setup-display.ts
 *
 * Required env (loaded from server/.env via dotenv):
 *   SUI_NETWORK              testnet | mainnet
 *   SUI_PACKAGE_ID           v5 fresh-publish package id
 *   SUI_TREASURY_PRIVATE_KEY publisher Ed25519 keypair (suiprivkey1...)
 *   PUBLISHER_OBJECT_ID      Publisher object id (transferred to publisher at init)
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { writeFileSync, readFileSync } from 'fs';

const DEPLOYMENT_PATH = join(__dirname, '..', 'deployment.testnet-v5.json');

const PROJECT_URL = 'https://github.com/Mr-Boss-AI/sui-comabts';
const CREATOR = 'SUI Combats';

// Display field templates. {name}, {level}, etc. resolve at view time from
// the underlying object's fields. Per Sui Display spec, missing fields fall
// back to literal strings.
const CHARACTER_FIELDS: Record<string, string> = {
  name: '{name}',
  description: 'SUI Combats character — Level {level}, Rating {rating}, {wins} wins / {losses} losses',
  image_url: 'https://gateway.pinata.cloud/ipfs/bafybeie6th7avaepyqcnvkdpo47qjdb6h3azhwvbz55dytekrvfmzdor2y/character_silhouette.png',
  thumbnail_url: 'https://gateway.pinata.cloud/ipfs/bafybeie6th7avaepyqcnvkdpo47qjdb6h3azhwvbz55dytekrvfmzdor2y/character_silhouette.png',
  project_url: PROJECT_URL,
  creator: CREATOR,
};

const ITEM_FIELDS: Record<string, string> = {
  name: '{name}',
  description: 'SUI Combats item — Level {level_req}, type {item_type}, rarity {rarity}',
  image_url: '{image_url}',
  thumbnail_url: '{image_url}',
  project_url: PROJECT_URL,
  creator: CREATOR,
};

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') throw new Error(`Required env var ${name} is not set`);
  return v.trim();
}

async function main() {
  const network = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  const packageId = envOrThrow('SUI_PACKAGE_ID');
  const privateKey = envOrThrow('SUI_TREASURY_PRIVATE_KEY');

  // Publisher object id — read from deployment file rather than env so the
  // common case (publish + setup_transfer_policy + setup-display) doesn't
  // require an extra .env edit.
  const deployment = JSON.parse(readFileSync(DEPLOYMENT_PATH, 'utf8')) as Record<string, unknown>;
  const publisherObjectId = String(deployment.publisherObjectId ?? '');
  if (!publisherObjectId) {
    throw new Error('publisherObjectId missing in deployment.testnet-v5.json');
  }

  const { scheme, secretKey } = decodeSuiPrivateKey(privateKey);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519, got ${scheme}`);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const sender = keypair.toSuiAddress();

  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
  console.log(`[setup-display] Sender: ${sender}`);
  console.log(`[setup-display] Package: ${packageId}`);
  console.log(`[setup-display] Publisher: ${publisherObjectId}`);

  // Both displays go in a single PTB so the Publisher object is referenced
  // once (avoids the "object version unavailable" race when txs land in
  // separate checkpoints).
  const tx = new Transaction();
  const characterType = `${packageId}::character::Character`;
  const itemType = `${packageId}::item::Item`;

  function attachDisplay(typeArg: string, fields: Record<string, string>) {
    const display = tx.moveCall({
      target: '0x2::display::new',
      typeArguments: [typeArg],
      arguments: [tx.object(publisherObjectId)],
    });
    const keys = Object.keys(fields);
    const values = keys.map((k) => fields[k]);
    tx.moveCall({
      target: '0x2::display::add_multiple',
      typeArguments: [typeArg],
      arguments: [
        display,
        tx.pure.vector('string', keys),
        tx.pure.vector('string', values),
      ],
    });
    tx.moveCall({
      target: '0x2::display::update_version',
      typeArguments: [typeArg],
      arguments: [display],
    });
    tx.transferObjects([display], tx.pure.address(sender));
  }

  attachDisplay(characterType, CHARACTER_FIELDS);
  attachDisplay(itemType, ITEM_FIELDS);
  tx.setGasBudget(100_000_000);

  const result = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  if (result.effects?.status?.status !== 'success') {
    throw new Error(`Display setup failed: ${result.effects?.status?.error}`);
  }
  console.log(`[setup-display] Display PTB landed (tx ${result.digest})`);

  // Pick out Display<Character> and Display<Item> from objectChanges.
  const changes = (result.objectChanges ?? []) as Array<Record<string, unknown>>;
  let characterDisplayId = '';
  let itemDisplayId = '';
  for (const c of changes) {
    if (c.type !== 'created') continue;
    const ot = String(c.objectType ?? '');
    const oid = String(c.objectId ?? '');
    if (ot.includes(`Display<${characterType}>`)) characterDisplayId = oid;
    if (ot.includes(`Display<${itemType}>`)) itemDisplayId = oid;
  }
  console.log(`[setup-display] Display<Character> → ${characterDisplayId}`);
  console.log(`[setup-display] Display<Item>      → ${itemDisplayId}`);

  // Persist back to the deployment file
  deployment.characterDisplayId = characterDisplayId;
  deployment.itemDisplayId = itemDisplayId;
  deployment.displaySetupAt = new Date().toISOString();
  writeFileSync(DEPLOYMENT_PATH, JSON.stringify(deployment, null, 2) + '\n');
  console.log(`[setup-display] Updated ${DEPLOYMENT_PATH}`);
  console.log(`[setup-display] Done.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
