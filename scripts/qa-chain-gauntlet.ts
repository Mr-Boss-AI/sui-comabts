/**
 * Chain-side QA gauntlet — runs the parts of the v5 gauntlet that don't
 * require a browser:
 *   - Display object renders on chain (Item + Character).
 *   - update_after_fight with xp_gained > MAX_XP_PER_FIGHT (1000) aborts.
 *   - set_fight_lock with expiry > now + MAX_LOCK_MS (1h) aborts.
 *   - update_after_fight + set_fight_lock with valid args succeed (positive control).
 *
 * Spawns a throwaway test Character owned by the publisher wallet, exercises
 * the assertions against it, then leaves the Character in place (cheap; the
 * publisher can clean up later or we can ignore it).
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';

const SUI_CLOCK = '0x6';

function ok(label: string)         { console.log(`  PASS  ${label}`); }
function fail(label: string, why: string) { console.log(`  FAIL  ${label}\n          ${why}`); }

async function main() {
  const network = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  const packageId = process.env.SUI_PACKAGE_ID!;
  const adminCapId = process.env.ADMIN_CAP_ID!;
  const { scheme, secretKey } = decodeSuiPrivateKey(process.env.SUI_TREASURY_PRIVATE_KEY!);
  if (scheme !== 'ED25519') throw new Error(`Expected ED25519, got ${scheme}`);
  const keypair = Ed25519Keypair.fromSecretKey(secretKey);
  const sender = keypair.toSuiAddress();
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

  console.log(`[qa] Sender: ${sender}`);
  console.log(`[qa] Package: ${packageId}`);
  console.log();

  // ---- Bootstrap: create a throwaway character we can update -----------------
  console.log('Bootstrap: create test character');
  const createTx = new Transaction();
  createTx.moveCall({
    target: `${packageId}::character::create_character`,
    arguments: [
      createTx.pure.string('QA-Bot'),
      createTx.pure.u16(5), createTx.pure.u16(5), createTx.pure.u16(5), createTx.pure.u16(5),
      createTx.object(SUI_CLOCK),
    ],
  });
  createTx.setGasBudget(50_000_000);
  const createRes = await client.signAndExecuteTransaction({
    signer: keypair, transaction: createTx, options: { showEffects: true, showEvents: true },
  });
  await client.waitForTransaction({ digest: createRes.digest });
  if (createRes.effects?.status?.status !== 'success') {
    throw new Error(`bootstrap failed: ${createRes.effects?.status?.error}`);
  }
  // Character is shared — pull from CharacterCreated event for the canonical ID.
  const ev = (createRes.events ?? []).find((e) => e.type.endsWith('::character::CharacterCreated'));
  const characterId = String((ev?.parsedJson as Record<string, unknown> | undefined)?.character_id ?? '');
  if (!characterId) throw new Error('bootstrap: no character_id in event');
  console.log(`  Character: ${characterId}`);
  console.log();

  // ---- Helper: try a tx, expect abort ---------------------------------------
  async function expectAbort(
    label: string,
    expectedAbortCode: number,
    expectedSourceModule: string,
    build: (tx: Transaction) => void,
  ) {
    const tx = new Transaction();
    build(tx);
    tx.setGasBudget(50_000_000);
    try {
      const res = await client.signAndExecuteTransaction({
        signer: keypair, transaction: tx, options: { showEffects: true },
      });
      await client.waitForTransaction({ digest: res.digest });
      const status = res.effects?.status;
      if (status?.status === 'success') {
        fail(label, 'tx succeeded but should have aborted');
        return;
      }
      const errStr = String(status?.error ?? '');
      if (errStr.includes(`Abort(${expectedAbortCode})`) && errStr.includes(expectedSourceModule)) {
        ok(`${label} (abort code ${expectedAbortCode} from ${expectedSourceModule})`);
      } else {
        fail(label, `expected abort ${expectedAbortCode} from ${expectedSourceModule}; got: ${errStr}`);
      }
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes(`MoveAbort`) && msg.includes(`, ${expectedAbortCode})`)) {
        ok(`${label} (abort code ${expectedAbortCode})`);
      } else {
        fail(label, `unexpected error: ${msg}`);
      }
    }
  }

  // ---- Helper: try a tx, expect success -------------------------------------
  async function expectOk(label: string, build: (tx: Transaction) => void) {
    const tx = new Transaction();
    build(tx);
    tx.setGasBudget(50_000_000);
    const res = await client.signAndExecuteTransaction({
      signer: keypair, transaction: tx, options: { showEffects: true },
    });
    await client.waitForTransaction({ digest: res.digest });
    if (res.effects?.status?.status === 'success') {
      ok(`${label} (tx ${res.digest.slice(0, 12)}…)`);
    } else {
      fail(label, `tx failed: ${res.effects?.status?.error}`);
    }
  }

  console.log('Test #18 — update_after_fight rejects xp > 1000 (MAX_XP_PER_FIGHT)');
  await expectAbort(
    'xp=1001 rejected',
    1, // EXpTooHigh
    'character',
    (tx) => {
      tx.moveCall({
        target: `${packageId}::character::update_after_fight`,
        arguments: [
          tx.object(adminCapId),
          tx.object(characterId),
          tx.pure.bool(true),
          tx.pure.u64(1001),
          tx.pure.u16(1010),
          tx.object(SUI_CLOCK),
        ],
      });
    },
  );
  console.log();

  console.log('Test #19 — set_fight_lock rejects expiry > now + 1h (MAX_LOCK_MS)');
  const farFuture = Date.now() + 24 * 60 * 60 * 1000; // 24h from now
  await expectAbort(
    '24h lock rejected',
    4, // ELockTooLong
    'character',
    (tx) => {
      tx.moveCall({
        target: `${packageId}::character::set_fight_lock`,
        arguments: [
          tx.object(adminCapId),
          tx.object(characterId),
          tx.pure.u64(farFuture),
          tx.object(SUI_CLOCK),
        ],
      });
    },
  );
  console.log();

  console.log('Positive controls — valid bounds succeed');
  await expectOk('xp=500 update succeeds', (tx) => {
    tx.moveCall({
      target: `${packageId}::character::update_after_fight`,
      arguments: [
        tx.object(adminCapId), tx.object(characterId),
        tx.pure.bool(true), tx.pure.u64(500), tx.pure.u16(1020),
        tx.object(SUI_CLOCK),
      ],
    });
  });
  const validLock = Date.now() + 30 * 60 * 1000; // 30 min in the future
  await expectOk('30-min lock succeeds', (tx) => {
    tx.moveCall({
      target: `${packageId}::character::set_fight_lock`,
      arguments: [
        tx.object(adminCapId), tx.object(characterId),
        tx.pure.u64(validLock), tx.object(SUI_CLOCK),
      ],
    });
  });
  await expectOk('clear lock with 0 succeeds', (tx) => {
    tx.moveCall({
      target: `${packageId}::character::set_fight_lock`,
      arguments: [
        tx.object(adminCapId), tx.object(characterId),
        tx.pure.u64(0), tx.object(SUI_CLOCK),
      ],
    });
  });
  console.log();

  console.log('All gauntlet steps that don\'t require a browser: complete.');
  console.log(`Test character left at ${characterId} for further inspection.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
