/**
 * Orphan-ACTIVE wager recovery.
 *
 * Handles the mid-fight crash scenario where:
 *   1. Player B's `accept_wager` tx landed → on-chain WagerMatch is ACTIVE
 *   2. Server held the FightState in memory + a row in `wager_in_flight`
 *   3. Server crashed before `settle_wager` ran
 *
 * The chain has a 10-minute anyone-callable safety net
 * (`cancel_expired_wager`), but that's slow + visible to no one. With
 * Supabase persistence we know exactly which wagers were in-flight at
 * crash time and can self-heal within seconds of boot by calling
 * `admin_cancel_wager` (50/50 split).
 *
 * The sweeper runs once on startup. Anything still ACTIVE on chain after
 * the configured grace window gets refunded. Rows that are stale on disk
 * but already SETTLED on chain (race: settle landed but row wasn't
 * deleted before crash) get cleaned up without a chain call.
 */
import { CONFIG } from '../config';
import {
  dbDeleteWagerInFlight,
  dbLoadStaleWagersInFlight,
  type DbWagerInFlight,
} from './db';
import { adminCancelWagerOnChain, getWagerStatus } from '../utils/sui-settle';

/**
 * Minimum age before we consider an in-flight row "stale". Set to 60s
 * so a clean restart (the row was written ~30s ago, the fight is still
 * live in some other process) doesn't get wiped out. In practice clean
 * restarts have no rows older than the previous shutdown anyway, but
 * the floor is cheap defence-in-depth.
 */
const STALE_AGE_MS = 60_000;

interface SweepResult {
  rowsScanned: number;
  cancelled: number;
  alreadySettled: number;
  errors: number;
}

/**
 * Run the orphan-active sweeper. Idempotent: each row is either
 * cancelled-and-deleted, deleted-after-discovering-already-settled, or
 * left alone (with a logged error) for the next sweep tick.
 *
 * The function awaits each row sequentially. The treasury queue
 * already serializes admin-tx execution; calling them sequentially
 * here avoids a flood of pending tasks on boot when the previous
 * crash had many in-flight wagers (rare, but bounded behaviour beats
 * unbounded behaviour).
 */
export async function sweepOrphanActiveWagers(): Promise<SweepResult> {
  const result: SweepResult = { rowsScanned: 0, cancelled: 0, alreadySettled: 0, errors: 0 };

  if (CONFIG.SUI_NETWORK !== 'testnet' && CONFIG.SUI_NETWORK !== 'mainnet') {
    console.log('[OrphanWager] Skipping sweep: unknown network');
    return result;
  }

  const rows = await dbLoadStaleWagersInFlight(STALE_AGE_MS);
  result.rowsScanned = rows.length;
  if (rows.length === 0) {
    console.log('[OrphanWager] No stale in-flight rows — clean boot');
    return result;
  }

  console.log(`[OrphanWager] Found ${rows.length} stale wager_in_flight row(s) — sweeping`);

  for (const row of rows) {
    try {
      await sweepOne(row, result);
    } catch (err: any) {
      result.errors++;
      console.error(
        `[OrphanWager] Sweep failed for ${row.wager_match_id.slice(0, 10)}…:`,
        err?.message || err,
      );
    }
  }

  console.log(
    `[OrphanWager] Sweep complete: ${result.cancelled} cancelled (50/50 refund), ` +
    `${result.alreadySettled} already settled, ${result.errors} errors`,
  );
  return result;
}

async function sweepOne(row: DbWagerInFlight, result: SweepResult): Promise<void> {
  const status = await getWagerStatus(row.wager_match_id);
  if (status === null) {
    // RPC failure — leave the row in place; next sweep tick can retry.
    result.errors++;
    console.warn(
      `[OrphanWager] getWagerStatus(${row.wager_match_id.slice(0, 10)}…) returned null — leaving row for retry`,
    );
    return;
  }

  if (status === 2 /* STATUS_SETTLED */) {
    // Settled cleanly — the row is just stale. Drop it.
    result.alreadySettled++;
    await dbDeleteWagerInFlight(row.wager_match_id);
    console.log(
      `[OrphanWager] ${row.wager_match_id.slice(0, 10)}… already SETTLED — dropping stale row`,
    );
    return;
  }

  if (status === 1 /* STATUS_ACTIVE */) {
    // Still ACTIVE → refund 50/50 via admin_cancel_wager.
    const { digest } = await adminCancelWagerOnChain(row.wager_match_id);
    await dbDeleteWagerInFlight(row.wager_match_id);
    result.cancelled++;
    console.log(
      `[OrphanWager] ${row.wager_match_id.slice(0, 10)}… ACTIVE → 50/50 refund tx=${digest}`,
    );
    return;
  }

  if (status === 0 /* STATUS_WAITING */) {
    // Strange state — row was inserted only after accept, so this
    // shouldn't happen. Log + drop the row to keep the table clean.
    console.warn(
      `[OrphanWager] ${row.wager_match_id.slice(0, 10)}… is WAITING ` +
      `(unexpected — row should have only been written post-accept). Dropping row.`,
    );
    await dbDeleteWagerInFlight(row.wager_match_id);
    return;
  }

  // Unknown status — be cautious, leave the row.
  console.warn(
    `[OrphanWager] ${row.wager_match_id.slice(0, 10)}… has status=${status} — leaving row`,
  );
  result.errors++;
}
