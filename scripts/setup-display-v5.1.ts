#!/usr/bin/env tsx
/**
 * v5.1 — Create Display<Character> and Display<Item> via the Publisher.
 * Mirrors v5.0 schema (Pinata-hosted images + standard NFT display fields).
 *
 * Run from server/:
 *   cd ~/sui-comabts/server && npx tsx ../scripts/setup-display-v5.1.ts
 *
 * Env: SUI_TREASURY_PRIVATE_KEY (TREASURY also holds the Publisher).
 *      SUI_PACKAGE_ID            (set from deployment.testnet-v5.1.json)
 *      V51_PUBLISHER_ID          (the Publisher object id)
 */

import 'dotenv/config';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const PKG = process.env.SUI_PACKAGE_ID!;
const PUBLISHER = process.env.V51_PUBLISHER_ID || process.env.PUBLISHER_OBJECT_ID!;
const TRZ_KEY = process.env.SUI_TREASURY_PRIVATE_KEY!;
if (!PKG || !PUBLISHER || !TRZ_KEY) {
  console.error('Missing env: SUI_PACKAGE_ID, V51_PUBLISHER_ID (or PUBLISHER_OBJECT_ID), SUI_TREASURY_PRIVATE_KEY required.');
  process.exit(1);
}

async function main() {
  const network = (process.env.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });
  const { scheme, secretKey } = decodeSuiPrivateKey(TRZ_KEY);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519, got ${scheme}`);
  const treasury = Ed25519Keypair.fromSecretKey(secretKey);
  console.log(`[display] TREASURY=${treasury.toSuiAddress()}  pkg=${PKG.slice(0, 14)}…`);

  // ===== Display<Character> =====
  {
    console.log('[display] Setting up Display<Character>…');
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
          // No per-character image yet — placeholder NFT artwork on testnet.
          // v5.1 catalog uses the v5.0 Pinata CID so character portraits resolve
          // to a generic placeholder until per-character portraits are added.
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
    tx.transferObjects([display], tx.pure.address(treasury.toSuiAddress()));
    const result = await client.signAndExecuteTransaction({
      transaction: tx, signer: treasury, options: { showEffects: true, showObjectChanges: true },
    });
    if (result.effects?.status?.status !== 'success') {
      console.error(`  FAIL: ${result.effects?.status?.error}`); process.exit(2);
    }
    const created = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('display::Display'),
    ) as any;
    console.log(`  OK    Display<Character>  id=${created?.objectId}`);
    console.log(`        digest=${result.digest}`);
  }

  // ===== Display<Item> =====
  // Use the item's image_url field directly (NFTs were minted with Pinata URLs).
  {
    console.log('[display] Setting up Display<Item>…');
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
    tx.transferObjects([display], tx.pure.address(treasury.toSuiAddress()));
    const result = await client.signAndExecuteTransaction({
      transaction: tx, signer: treasury, options: { showEffects: true, showObjectChanges: true },
    });
    if (result.effects?.status?.status !== 'success') {
      console.error(`  FAIL: ${result.effects?.status?.error}`); process.exit(2);
    }
    const created = result.objectChanges?.find(
      (c: any) => c.type === 'created' && c.objectType?.includes('display::Display'),
    ) as any;
    console.log(`  OK    Display<Item>       id=${created?.objectId}`);
    console.log(`        digest=${result.digest}`);
  }
}

main().catch((err) => {
  console.error('[display] uncaught:', err?.message || err);
  process.exit(1);
});
