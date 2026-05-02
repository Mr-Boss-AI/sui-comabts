/**
 * Stat-points drift gauntlet (BUG 1, live test 2026-05-02).
 *
 *   $ cd server && npx tsx ../scripts/qa-stat-points.ts
 *
 * Sx_v5.1 hit `MoveAbort code 2 (ENotEnoughPoints)` trying to spend 3
 * unallocated stat points. The server's `applyXp` had already
 * incremented her server-side `unallocatedPoints` to 3 the instant the
 * fight ended, but the on-chain `update_after_fight` (which actually
 * grants the points to the Character NFT) was still queued behind
 * `settle_wager` + the opponent's `update_after_fight` in the treasury
 * queue. Modal showed "+3 to allocate" → user clicked → Slush dry-ran
 * against the still-old chain object (0 unallocated) → abort.
 *
 * Fix: the modal clamps to `min(server, chain)` via
 * `effectiveUnallocatedPoints`. Chain is the contract's source of
 * truth for `allocate_points`; offering more than chain has lets the
 * UI stage a doomed transaction.
 *
 * This gauntlet pins the predicate's contract — every drift case the
 * UI relies on. Pure function, no chain or DB calls.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  effectiveUnallocatedPoints,
  isAwaitingChainCatchup,
} from '../frontend/src/lib/stat-points';

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

function main(): void {
  // ===========================================================================
  // 1 — agreement (no drift): both sources match
  // ===========================================================================
  console.log('\n[1] Agreement — server and chain match');
  eq(effectiveUnallocatedPoints(0, 0), 0, '0/0 → 0');
  eq(effectiveUnallocatedPoints(3, 3), 3, '3/3 → 3 (the post-catchup case)');
  eq(effectiveUnallocatedPoints(9, 9), 9, '9/9 → 9');
  eq(isAwaitingChainCatchup(0, 0), false, '0/0 → not awaiting');
  eq(isAwaitingChainCatchup(3, 3), false, '3/3 → not awaiting');

  // ===========================================================================
  // 2 — ⚡ THE BUG: server ahead of chain → clamp to chain (smaller)
  // ===========================================================================
  console.log('\n[2] ⚡ BUG 1 reproduction — server ahead of chain → return chain');
  eq(
    effectiveUnallocatedPoints(3, 0),
    0,
    'server=3, chain=0 → 0 (the EXACT Sx_v5.1 abort scenario)',
  );
  eq(
    effectiveUnallocatedPoints(6, 3),
    3,
    'server=6, chain=3 → 3 (mid-catchup, chain ahead by one tx)',
  );
  eq(
    effectiveUnallocatedPoints(9, 0),
    0,
    'server=9, chain=0 → 0 (multi-level catchup)',
  );
  eq(isAwaitingChainCatchup(3, 0), true, '3/0 → awaiting');
  eq(isAwaitingChainCatchup(6, 3), true, '6/3 → awaiting');

  // ===========================================================================
  // 3 — chain ahead of server (rare — admin grant on chain that hasn't
  //   propagated back to server yet) → return server (the smaller)
  // ===========================================================================
  console.log('\n[3] Chain ahead of server — return server (still safe)');
  eq(
    effectiveUnallocatedPoints(0, 3),
    0,
    'server=0, chain=3 → 0 (avoid promising points server doesn\'t track)',
  );
  eq(isAwaitingChainCatchup(0, 3), false, '0/3 → NOT awaiting (different drift direction)');

  // ===========================================================================
  // 4 — chain unavailable (RPC down at boot) → fall back to server
  //   The wallet popup gate prevents a doomed tx; we still want the badge
  //   to render something rather than 0.
  // ===========================================================================
  console.log('\n[4] Chain unavailable — fall back to server');
  eq(effectiveUnallocatedPoints(3, null), 3, 'chain=null → server (3)');
  eq(effectiveUnallocatedPoints(3, undefined), 3, 'chain=undefined → server (3)');
  eq(effectiveUnallocatedPoints(0, null), 0, 'both 0/null → 0');
  eq(isAwaitingChainCatchup(3, null), false, 'no chain data → NOT awaiting');
  eq(isAwaitingChainCatchup(3, undefined), false, 'undefined chain → NOT awaiting');

  // ===========================================================================
  // 5 — Defensive: server unavailable → 0
  // ===========================================================================
  console.log('\n[5] Defensive: server unavailable');
  eq(effectiveUnallocatedPoints(null, 3), 0, 'server=null, chain=3 → 0');
  eq(effectiveUnallocatedPoints(undefined, 3), 0, 'server=undefined, chain=3 → 0');
  eq(effectiveUnallocatedPoints(null, null), 0, 'both null → 0');

  // ===========================================================================
  // 6 — Defensive: NaN / negative / non-integer noise
  // ===========================================================================
  console.log('\n[6] Sanitization — NaN, negative, fractional');
  eq(effectiveUnallocatedPoints(Number.NaN, 3), 0, 'NaN server → 0 (clamped)');
  eq(effectiveUnallocatedPoints(3, Number.NaN), 0, 'NaN chain → 0 (clamped)');
  eq(effectiveUnallocatedPoints(-1, 3), 0, 'negative server → 0 (clamped)');
  eq(effectiveUnallocatedPoints(3, -1), 0, 'negative chain → 0 (clamped)');
  eq(effectiveUnallocatedPoints(3.7, 3), 3, 'fractional server floored to 3');
  eq(effectiveUnallocatedPoints(3, 3.9), 3, 'fractional chain floored to 3');

  // ===========================================================================
  // 7 — ⚡ End-to-end timeline: simulate a fight ending → server bumps →
  //   chain catches up → modal switches from clamp to full value
  // ===========================================================================
  console.log('\n[7] ⚡ Timeline simulation — fight end → chain catchup → full unlock');
  // t=0: pre-fight
  let server = 0;
  let chain: number | null = 0;
  eq(effectiveUnallocatedPoints(server, chain), 0, '[t=0] pre-fight: 0');

  // t=fight_end+δ: server applyXp bumps optimistically; chain unchanged
  server = 3;
  // chain still 0
  eq(effectiveUnallocatedPoints(server, chain), 0, '[t=fight_end] modal CLAMPS to 0 (no doomed tx)');
  eq(isAwaitingChainCatchup(server, chain), true, '[t=fight_end] banner shows "catching up"');

  // t=settle_wager_done: still no character update
  // (no state change)

  // t=update_after_fight_winner_done: chain finally has +3
  chain = 3;
  eq(effectiveUnallocatedPoints(server, chain), 3, '[t=update_done] modal NOW offers all 3');
  eq(isAwaitingChainCatchup(server, chain), false, '[t=update_done] banner hidden');

  // t=user spends all 3
  server = 0;
  chain = 0;
  eq(effectiveUnallocatedPoints(server, chain), 0, '[t=spent] back to 0');

  console.log(`\n${failures === 0 ? '\x1b[32m✔' : '\x1b[31m✘'} ${passes} pass / ${failures} fail\x1b[0m\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
