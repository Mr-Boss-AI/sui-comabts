/**
 * Orphan-wager sweep gauntlet — pure unit tests, no chain or DB calls.
 *
 *   $ cd server && npx tsx ../scripts/qa-orphan-sweep.ts
 *
 * Pins the contract for `sweepOne` (server/src/data/orphan-wager-recovery.ts)
 * which is the inner reconciliation step the boot sweeper runs against
 * every stale `wager_in_flight` row. Production wires the real chain
 * client + Supabase delete; this gauntlet injects mocks for every branch:
 *
 *   STATUS_ACTIVE   (1) → admin_cancel_wager 50/50, drop row, count.cancelled++
 *   STATUS_SETTLED  (2) → drop row only,                count.alreadySettled++
 *   STATUS_WAITING  (0) → drop row (unexpected state), no count change
 *   getWagerStatus → null (RPC fail) → leave row,       count.errors++
 *   unknown status      → leave row,                    count.errors++
 *
 * The cancellation branch is the one that makes players whole after a
 * mid-fight server crash (STATUS_v5.md 2026-04-30). If this gauntlet
 * fails, the recovery flow ships broken.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { sweepOne, type SweepDeps, type SweepResult } from '../server/src/data/orphan-wager-recovery';
import type { DbWagerInFlight } from '../server/src/data/db';

let passes = 0;
let failures = 0;

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function freshResult(): SweepResult {
  return { rowsScanned: 0, cancelled: 0, alreadySettled: 0, errors: 0 };
}

function freshRow(): DbWagerInFlight {
  return {
    wager_match_id: '0xcadbDEADBEEF0d09',
    player_a: '0xMR_BOSS',
    player_b: '0xSX',
    accepted_at_ms: Date.now() - 120_000, // 2 min old
    fight_id: null,
  };
}

interface MockState {
  cancelled: string[];
  deleted: string[];
}

function buildDeps(
  status: number | null,
  state: MockState,
  options: { adminCancelDigest?: string; throwOnCancel?: Error } = {},
): SweepDeps {
  return {
    getWagerStatus: async () => status,
    adminCancelWager: async (id) => {
      if (options.throwOnCancel) throw options.throwOnCancel;
      state.cancelled.push(id);
      return { digest: options.adminCancelDigest ?? 'TX_DIGEST_MOCK' };
    },
    deleteRow: async (id) => {
      state.deleted.push(id);
    },
  };
}

async function main(): Promise<void> {
  // ===========================================================================
  // 1 — STATUS_ACTIVE → 50/50 refund + row deleted (the BUG-FIX path)
  // ===========================================================================
  console.log('\n[1] STATUS_ACTIVE → admin_cancel_wager 50/50 + delete row');
  {
    const state: MockState = { cancelled: [], deleted: [] };
    const deps = buildDeps(1 /* ACTIVE */, state, { adminCancelDigest: '82ZB1vWqU' });
    const result = freshResult();
    await sweepOne(freshRow(), result, deps);

    eq(state.cancelled.length, 1, 'admin_cancel_wager called exactly once');
    eq(state.cancelled[0], '0xcadbDEADBEEF0d09', 'cancelled the right wager');
    eq(state.deleted.length, 1, 'row deleted exactly once');
    eq(state.deleted[0], '0xcadbDEADBEEF0d09', 'deleted the right row');
    eq(result.cancelled, 1, 'result.cancelled++');
    eq(result.alreadySettled, 0, 'result.alreadySettled untouched');
    eq(result.errors, 0, 'result.errors untouched');
  }

  // ===========================================================================
  // 2 — STATUS_SETTLED → drop stale row only, no chain call
  // ===========================================================================
  console.log('\n[2] STATUS_SETTLED → drop row only (race: settle landed pre-crash)');
  {
    const state: MockState = { cancelled: [], deleted: [] };
    const deps = buildDeps(2 /* SETTLED */, state);
    const result = freshResult();
    await sweepOne(freshRow(), result, deps);

    eq(state.cancelled.length, 0, 'NO chain call (already settled)');
    eq(state.deleted.length, 1, 'stale row dropped');
    eq(result.alreadySettled, 1, 'result.alreadySettled++');
    eq(result.cancelled, 0, 'result.cancelled untouched');
    eq(result.errors, 0, 'result.errors untouched');
  }

  // ===========================================================================
  // 3 — STATUS_WAITING (unexpected) → drop row, do not chain-call
  // ===========================================================================
  console.log('\n[3] STATUS_WAITING → drop row (unexpected state, defensive)');
  {
    const state: MockState = { cancelled: [], deleted: [] };
    const deps = buildDeps(0 /* WAITING */, state);
    const result = freshResult();
    await sweepOne(freshRow(), result, deps);

    eq(state.cancelled.length, 0, 'no chain call');
    eq(state.deleted.length, 1, 'row dropped (defensive cleanup)');
    eq(result.cancelled, 0, 'result.cancelled untouched');
    eq(result.alreadySettled, 0, 'result.alreadySettled untouched');
    eq(result.errors, 0, 'result.errors untouched (logged warn, not an error)');
  }

  // ===========================================================================
  // 4 — getWagerStatus returns null → row left for retry
  // ===========================================================================
  console.log('\n[4] getWagerStatus null (RPC fail) → leave row + result.errors++');
  {
    const state: MockState = { cancelled: [], deleted: [] };
    const deps = buildDeps(null, state);
    const result = freshResult();
    await sweepOne(freshRow(), result, deps);

    eq(state.cancelled.length, 0, 'no chain call');
    eq(state.deleted.length, 0, 'row NOT deleted — left for next sweep tick');
    eq(result.errors, 1, 'result.errors++');
    eq(result.cancelled, 0, 'result.cancelled untouched');
  }

  // ===========================================================================
  // 5 — Unknown status code → leave row defensively
  // ===========================================================================
  console.log('\n[5] Unknown status (e.g. 99) → leave row + result.errors++');
  {
    const state: MockState = { cancelled: [], deleted: [] };
    const deps = buildDeps(99, state);
    const result = freshResult();
    await sweepOne(freshRow(), result, deps);

    eq(state.cancelled.length, 0, 'no chain call');
    eq(state.deleted.length, 0, 'row NOT deleted — defensive');
    eq(result.errors, 1, 'result.errors++');
  }

  // ===========================================================================
  // 6 — Multiple rows aggregated correctly
  // ===========================================================================
  console.log('\n[6] Multiple rows: ACTIVE + SETTLED + RPC-fail → counts aggregate');
  {
    const result = freshResult();
    {
      const state: MockState = { cancelled: [], deleted: [] };
      await sweepOne(
        { ...freshRow(), wager_match_id: '0xACTIVE' },
        result,
        buildDeps(1, state),
      );
    }
    {
      const state: MockState = { cancelled: [], deleted: [] };
      await sweepOne(
        { ...freshRow(), wager_match_id: '0xSETTLED' },
        result,
        buildDeps(2, state),
      );
    }
    {
      const state: MockState = { cancelled: [], deleted: [] };
      await sweepOne(
        { ...freshRow(), wager_match_id: '0xRPCFAIL' },
        result,
        buildDeps(null, state),
      );
    }

    eq(result.cancelled, 1, 'aggregated cancelled = 1');
    eq(result.alreadySettled, 1, 'aggregated alreadySettled = 1');
    eq(result.errors, 1, 'aggregated errors = 1');
  }

  // ===========================================================================
  // 7 — adminCancel throws → propagates (caller's try/catch records error)
  // ===========================================================================
  console.log('\n[7] adminCancel throws → propagates to outer try/catch');
  {
    const state: MockState = { cancelled: [], deleted: [] };
    const deps = buildDeps(1 /* ACTIVE */, state, {
      throwOnCancel: new Error('chain RPC down'),
    });
    const result = freshResult();
    let threw = false;
    try {
      await sweepOne(freshRow(), result, deps);
    } catch (err: any) {
      threw = true;
      eq(err.message, 'chain RPC down', 'error propagated to caller');
    }
    eq(threw, true, 'sweepOne propagated the throw');
    eq(state.deleted.length, 0, 'row NOT deleted — chain call failed first');
  }

  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\n\x1b[31m✘ Gauntlet crashed:\x1b[0m', err);
  process.exit(1);
});
