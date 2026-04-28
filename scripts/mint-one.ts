/**
 * One-off mint helper used to recover a single item that failed in the
 * 22-item bulk run (gas-coin version race on the last cycle). Mints
 * Parrying_Dirk (#22) and transfers to Sx, then logs the object id so it
 * can be appended to deployment.testnet-v5.json by hand.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

async function main() {
  const network = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  const packageId = process.env.SUI_PACKAGE_ID!;
  const adminCapId = process.env.ADMIN_CAP_ID!;
  const cid = process.env.NFT_IPFS_CID!;
  const { scheme, secretKey } = decodeSuiPrivateKey(process.env.SUI_TREASURY_PRIVATE_KEY!);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519, got ${scheme}`);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const sender = keypair.toSuiAddress();
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

  const SX = '0xd05ae8e26e9c239b4888822c83046fe7adaac243f46888ea430d852dafb6e92b';
  const imageUrl = `https://gateway.pinata.cloud/ipfs/${cid}/Parrying_Dirk.png`;

  // Mint Parrying Dirk (#22 — Sx, weapon, lvl 2 common, dex+2)
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::item::mint_item_admin`,
    arguments: [
      tx.object(adminCapId),
      tx.pure.string('Parrying Dirk'),
      tx.pure.string(imageUrl),
      tx.pure.u8(1),     // weapon
      tx.pure.u8(0),     // class_req
      tx.pure.u8(2),     // level_req
      tx.pure.u8(1),     // common
      tx.pure.u16(0), tx.pure.u16(2), tx.pure.u16(0), tx.pure.u16(0),  // STR DEX INT END
      tx.pure.u16(0), tx.pure.u16(0), tx.pure.u16(0), tx.pure.u16(0),  // hp armor def attack
      tx.pure.u16(0), tx.pure.u16(0), tx.pure.u16(0), tx.pure.u16(0), tx.pure.u16(0),  // crit/evasion/anti
      tx.pure.u16(1),    // min damage
      tx.pure.u16(3),    // max damage
    ],
  });
  tx.setGasBudget(50_000_000);

  const mint = await client.signAndExecuteTransaction({
    signer: keypair, transaction: tx, options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: mint.digest });
  if (mint.effects?.status?.status !== 'success') {
    throw new Error(`mint failed: ${mint.effects?.status?.error}`);
  }
  const newObj = mint.effects.created?.find((c) => {
    const o = c.owner;
    return typeof o === 'object' && o && 'AddressOwner' in o &&
      (o as { AddressOwner: string }).AddressOwner === sender;
  });
  const objectId = newObj?.reference?.objectId ?? '';
  console.log(`MINT ok: ${objectId}  digest=${mint.digest}`);

  // Transfer to Sx
  const xferTx = new Transaction();
  xferTx.transferObjects([xferTx.object(objectId)], xferTx.pure.address(SX));
  xferTx.setGasBudget(20_000_000);
  const xfer = await client.signAndExecuteTransaction({
    signer: keypair, transaction: xferTx, options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: xfer.digest });
  if (xfer.effects?.status?.status !== 'success') {
    throw new Error(`transfer failed: ${xfer.effects?.status?.error}`);
  }
  console.log(`XFER ok: digest=${xfer.digest}`);
  console.log(`#22 Parrying Dirk → ${SX} ${objectId}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
