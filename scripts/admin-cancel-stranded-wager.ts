/**
 * One-shot — TREASURY-signed admin_cancel_wager rescue for a wager that
 * is alive on chain but invisible in the server lobby (typical drift
 * scenario: server restart wiped the in-memory lobby cache; the chain
 * registry entry survived).
 *
 * Incident this addresses (2026-05-31): Sx attempted create_wager and
 * hit EAlreadyHasOpenWager (11) because her earlier WAITING wager
 * 0x44018b2f…d6ef was still pinned in the OpenWagerRegistry, but her UI
 * showed no card (server lobby was empty after the modal-commit
 * restart). Treasury can admin-cancel any non-SETTLED wager — for
 * WAITING that's a full refund to player_a and a registry-entry remove,
 * so the caller can immediately create a new wager.
 *
 * Usage:   npx ts-node scripts/admin-cancel-stranded-wager.ts <wagerMatchId>
 * Example: npx ts-node scripts/admin-cancel-stranded-wager.ts \
 *            0x44018b2fc53d0c72045ec3a8cce23826fb321e94ff2ef11d8aec8161d2bfd6ef
 *
 * Reads server/.env for SUI_TREASURY_PRIVATE_KEY / SUI_PACKAGE_ID /
 * OPEN_WAGER_REGISTRY_ID. Imports the server's existing
 * `adminCancelWagerOnChain` so we inherit the same retry envelope +
 * registry-arg ordering as the live settle path.
 */
import { config as loadEnv } from 'dotenv';
import { join } from 'path';
loadEnv({ path: join(__dirname, '..', 'server', '.env') });

import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { adminCancelWagerOnChain, readObjectWithRetry } from '../server/src/utils/sui-settle';

async function main() {
  const wagerMatchId = process.argv[2];
  if (!wagerMatchId || !wagerMatchId.startsWith('0x')) {
    console.error(
      'Usage: npx ts-node scripts/admin-cancel-stranded-wager.ts <wagerMatchId>',
    );
    process.exit(1);
  }

  const network = (process.env.SUI_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

  console.log(`\n▸ Pre-flight: read wager ${wagerMatchId}`);
  const before = await readObjectWithRetry(wagerMatchId, { showContent: true, showType: true });
  if (!before.fields || !before.type?.includes('::arena::WagerMatch')) {
    console.error(`  ✘ Not a WagerMatch (type=${before.type})`);
    process.exit(1);
  }
  const statusBefore = Number(before.fields.status);
  const playerA = String(before.fields.player_a);
  const stakeMist = Number(before.fields.stake_amount);
  const escrowBefore = Number((before.fields.escrow as Record<string, unknown> | undefined)?.value ?? before.fields.escrow ?? 0);
  console.log(`  player_a:       ${playerA}`);
  console.log(`  status:         ${statusBefore} (${statusLabel(statusBefore)})`);
  console.log(`  stake_amount:   ${stakeMist} MIST (${(stakeMist / 1e9).toFixed(4)} SUI)`);
  console.log(`  escrow:         ${escrowBefore} MIST`);

  if (statusBefore === 2) {
    console.error('  ✘ Wager is already SETTLED — nothing to do.');
    process.exit(1);
  }

  // Snapshot player_a balance pre-cancel via the SDK client (the registry
  // remove is what unsticks Sx; the balance bump is the visible proof).
  const balBefore = await client.getBalance({ owner: playerA });
  console.log(`  player_a balance (pre):  ${balBefore.totalBalance} MIST`);

  console.log(`\n▸ admin_cancel_wager → ${wagerMatchId}`);
  const { digest } = await adminCancelWagerOnChain(wagerMatchId);
  console.log(`  tx digest: ${digest}`);

  // Re-read wager + balance post-tx to confirm the refund + status flip.
  await client.waitForTransaction({ digest });
  console.log(`\n▸ Post-flight verification`);

  const after = await readObjectWithRetry(wagerMatchId, { showContent: true, showType: true });
  const statusAfter = Number(after.fields?.status ?? -1);
  console.log(`  wager.status:   ${statusAfter} (${statusLabel(statusAfter)})`);

  const balAfter = await client.getBalance({ owner: playerA });
  const delta = BigInt(balAfter.totalBalance) - BigInt(balBefore.totalBalance);
  console.log(`  player_a balance (post): ${balAfter.totalBalance} MIST  (Δ ${delta} MIST)`);

  // Registry truth — the table SIZE should reflect the remove.
  const registryId = process.env.OPEN_WAGER_REGISTRY_ID;
  if (registryId) {
    const reg = await readObjectWithRetry(registryId, { showContent: true });
    const tableSize = Number(
      (reg.fields?.table as Record<string, unknown> | undefined)?.size ?? -1,
    );
    console.log(`  OpenWagerRegistry.table.size: ${tableSize}`);
  }

  if (statusAfter !== 2) {
    console.warn(
      '  ⚠ status did not flip to SETTLED — manual chain re-read recommended.',
    );
    process.exit(2);
  }
  console.log('\n✔ Rescue complete.\n');
}

function statusLabel(n: number): string {
  switch (n) {
    case 0: return 'WAITING';
    case 1: return 'ACTIVE';
    case 2: return 'SETTLED';
    case 3: return 'PENDING_APPROVAL';
    default: return 'UNKNOWN';
  }
}

main().catch((err) => {
  console.error('\n✘ Rescue failed:', err?.message || err);
  if (err?.stack) console.error(err.stack);
  process.exit(1);
});
