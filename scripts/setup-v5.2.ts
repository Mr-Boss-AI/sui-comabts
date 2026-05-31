#!/usr/bin/env tsx
/**
 * v5.2 — Post-publish setup: TransferPolicy + Display objects.
 *
 * Runs three transactions against the v5.2 package:
 *   1) marketplace::setup_transfer_policy(publisher)
 *      Creates TransferPolicy<Item> (shared) and TransferPolicyCap
 *      (→ TREASURY), wires the 2.5% royalty rule (250 BPS, 1000 MIST min).
 *      Mirrors v5.1's policy exactly — same const values come from
 *      marketplace.move (ROYALTY_BPS, ROYALTY_MIN_MIST).
 *   2) display::new_with_fields<Character>(publisher, keys, values)
 *      Same 4-field schema as v5.1: name / description / image_url / link.
 *   3) display::new_with_fields<Item>(publisher, keys, values)
 *      Same 4-field schema as v5.1.
 *
 * All three move objects to TREASURY (or share, for the policy). Total
 * gas: ~0.01 SUI based on v5.1 history.
 *
 * Run from server/:
 *   cd ~/sui-comabts/server && \
 *     SUI_PACKAGE_ID=0x9c01ad55dd3aecafe671758fe4c9837b9fdfef1739793eb6bc094cc476f7d38f \
 *     V52_PUBLISHER_ID=0x4010478364ea545645200d43c6080c5f48218b45bbbc9b82d9a4748aece2bd9e \
 *     npx tsx ../scripts/setup-v5.2.ts
 *
 * Env:
 *   SUI_TREASURY_PRIVATE_KEY   suiprivkey1... (in server/.env)
 *   SUI_PACKAGE_ID             v5.2 fresh-publish package id
 *   V52_PUBLISHER_ID           v5.2 Publisher object id (fallback: PUBLISHER_OBJECT_ID)
 *   SUI_NETWORK                testnet | mainnet (default: testnet)
 */

import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const PKG = process.env.SUI_PACKAGE_ID!;
const PUBLISHER = process.env.V52_PUBLISHER_ID || process.env.PUBLISHER_OBJECT_ID!;
const TRZ_KEY = process.env.SUI_TREASURY_PRIVATE_KEY!;
if (!PKG || !PUBLISHER || !TRZ_KEY) {
  console.error(
    'Missing env: SUI_PACKAGE_ID, V52_PUBLISHER_ID (or PUBLISHER_OBJECT_ID), SUI_TREASURY_PRIVATE_KEY required.',
  );
  process.exit(1);
}

async function main() {
  const network = (process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as
    | 'mainnet'
    | 'testnet';
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
  const { scheme, secretKey } = decodeSuiPrivateKey(TRZ_KEY);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519, got ${scheme}`);
  const treasury = Ed25519Keypair.fromSecretKey(secretKey);
  const treasuryAddr = treasury.toSuiAddress();
  console.log(`[setup-v5.2] TREASURY=${treasuryAddr}  pkg=${PKG.slice(0, 14)}…`);
  console.log(`[setup-v5.2] PUBLISHER=${PUBLISHER.slice(0, 14)}…`);

  // ===== 1) TransferPolicy<Item> + royalty rule =====
  let policyId: string | undefined;
  let policyCapId: string | undefined;
  let policyDigest: string | undefined;
  {
    console.log('[setup-v5.2] (1/3) marketplace::setup_transfer_policy…');
    const tx = new Transaction();
    tx.setGasBudget(150_000_000n);
    tx.moveCall({
      target: `${PKG}::marketplace::setup_transfer_policy`,
      arguments: [tx.object(PUBLISHER)],
    });
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: treasury,
      options: { showEffects: true, showObjectChanges: true },
    });
    if (result.effects?.status?.status !== 'success') {
      console.error(`  FAIL: ${result.effects?.status?.error}`);
      process.exit(2);
    }
    policyDigest = result.digest;
    for (const c of result.objectChanges ?? []) {
      if (c.type !== 'created') continue;
      const t = (c as any).objectType ?? '';
      if (t.includes('transfer_policy::TransferPolicy<')) policyId = (c as any).objectId;
      else if (t.includes('transfer_policy::TransferPolicyCap<')) policyCapId = (c as any).objectId;
    }
    console.log(`  OK    TransferPolicy<Item>     ${policyId}`);
    console.log(`  OK    TransferPolicyCap<Item>  ${policyCapId}`);
    console.log(`        digest=${policyDigest}`);
  }

  // ===== 2) Display<Character> =====
  let displayCharId: string | undefined;
  let displayCharDigest: string | undefined;
  {
    console.log('[setup-v5.2] (2/3) Display<Character>…');
    const tx = new Transaction();
    tx.setGasBudget(150_000_000n);
    const [display] = tx.moveCall({
      target: '0x2::display::new_with_fields',
      typeArguments: [`${PKG}::character::Character`],
      arguments: [
        tx.object(PUBLISHER),
        tx.pure.vector('string', ['name', 'description', 'image_url', 'link']),
        tx.pure.vector('string', [
          '{name}',
          'SUI Combats — Lv{level} fighter, {wins}W / {losses}L / {draws}D, {rating} ELO',
          // Same placeholder portrait as v5.1.
          'https://gateway.pinata.cloud/ipfs/bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy/character.png',
          'https://testnet.suivision.xyz/object/{id}',
        ]),
      ],
    });
    tx.moveCall({
      target: '0x2::display::update_version',
      typeArguments: [`${PKG}::character::Character`],
      arguments: [display],
    });
    tx.transferObjects([display], tx.pure.address(treasuryAddr));
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: treasury,
      options: { showEffects: true, showObjectChanges: true },
    });
    if (result.effects?.status?.status !== 'success') {
      console.error(`  FAIL: ${result.effects?.status?.error}`);
      process.exit(2);
    }
    displayCharDigest = result.digest;
    const created = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('display::Display'),
    ) as any;
    displayCharId = created?.objectId;
    console.log(`  OK    Display<Character>       ${displayCharId}`);
    console.log(`        digest=${displayCharDigest}`);
  }

  // ===== 3) Display<Item> =====
  let displayItemId: string | undefined;
  let displayItemDigest: string | undefined;
  {
    console.log('[setup-v5.2] (3/3) Display<Item>…');
    const tx = new Transaction();
    tx.setGasBudget(150_000_000n);
    const [display] = tx.moveCall({
      target: '0x2::display::new_with_fields',
      typeArguments: [`${PKG}::item::Item`],
      arguments: [
        tx.object(PUBLISHER),
        tx.pure.vector('string', ['name', 'description', 'image_url', 'link']),
        tx.pure.vector('string', [
          '{name}',
          'SUI Combats item — Lv{level_req}+ required.',
          '{image_url}',
          'https://testnet.suivision.xyz/object/{id}',
        ]),
      ],
    });
    tx.moveCall({
      target: '0x2::display::update_version',
      typeArguments: [`${PKG}::item::Item`],
      arguments: [display],
    });
    tx.transferObjects([display], tx.pure.address(treasuryAddr));
    const result = await client.signAndExecuteTransaction({
      transaction: tx,
      signer: treasury,
      options: { showEffects: true, showObjectChanges: true },
    });
    if (result.effects?.status?.status !== 'success') {
      console.error(`  FAIL: ${result.effects?.status?.error}`);
      process.exit(2);
    }
    displayItemDigest = result.digest;
    const created = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('display::Display'),
    ) as any;
    displayItemId = created?.objectId;
    console.log(`  OK    Display<Item>            ${displayItemId}`);
    console.log(`        digest=${displayItemDigest}`);
  }

  console.log('');
  console.log('[setup-v5.2] ALL DONE — copy these into deployment.testnet-v5.2.json:');
  console.log(JSON.stringify(
    {
      transferPolicy: {
        policy: policyId,
        policyCap: policyCapId,
        setupDigest: policyDigest,
      },
      display: {
        character: displayCharId,
        item: displayItemId,
        characterDigest: displayCharDigest,
        itemDigest: displayItemDigest,
      },
    },
    null,
    2,
  ));
}

main().catch((err) => {
  console.error('[setup-v5.2] uncaught:', err?.message || err);
  process.exit(1);
});
