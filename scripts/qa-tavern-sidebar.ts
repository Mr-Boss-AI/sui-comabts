/**
 * Tavern player sidebar gauntlet (Bucket 3 — Tavern, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-tavern-sidebar.ts
 *
 * Pins the frontend's `groupPlayersForSidebar` helper:
 *   • Bucket boundaries match server's groupPlayersByLevelBucket
 *   • Search filter (case-insensitive substring)
 *   • Status filter (subset)
 *   • Wallet exclude filter
 *   • hideEmpty option
 *   • In-bucket sort: status priority → rating desc → name asc
 *
 * Pure JS, no DB, no WS.
 */
import {
  groupPlayersForSidebar,
  bucketKeyForLevel,
  SIDEBAR_BUCKETS,
} from '../frontend/src/lib/player-bucket';
import type { OnlinePlayer } from '../frontend/src/types/game';

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

function p(
  walletAddress: string,
  name: string,
  level: number,
  rating: number,
  status: OnlinePlayer['status'] = 'online',
): OnlinePlayer {
  return { walletAddress, name, level, rating, status };
}

function main(): void {
  // ===========================================================================
  // 1 — bucket boundaries match server brackets
  // ===========================================================================
  console.log('\n[1] bucket boundaries match server brackets');
  eq(SIDEBAR_BUCKETS.length, 6, 'six brackets');
  eq(SIDEBAR_BUCKETS[0].minLevel, 1, 'novice min=1');
  eq(SIDEBAR_BUCKETS[0].maxLevel, 3, 'novice max=3');
  eq(SIDEBAR_BUCKETS[1].minLevel, 4, 'early min=4');
  eq(SIDEBAR_BUCKETS[1].maxLevel, 6, 'early max=6');
  eq(SIDEBAR_BUCKETS[2].minLevel, 7, 'mid min=7');
  eq(SIDEBAR_BUCKETS[2].maxLevel, 9, 'mid max=9');
  eq(SIDEBAR_BUCKETS[3].minLevel, 10, 'high min=10');
  eq(SIDEBAR_BUCKETS[3].maxLevel, 14, 'high max=14');
  eq(SIDEBAR_BUCKETS[4].minLevel, 15, 'endgame min=15');
  eq(SIDEBAR_BUCKETS[4].maxLevel, 19, 'endgame max=19');
  eq(SIDEBAR_BUCKETS[5].minLevel, 20, 'hall min=20');

  // ===========================================================================
  // 2 — bucketKeyForLevel returns matching key
  // ===========================================================================
  console.log('\n[2] bucketKeyForLevel — matches server');
  eq(bucketKeyForLevel(1), 'novice', '1 → novice');
  eq(bucketKeyForLevel(6), 'early', '6 → early');
  eq(bucketKeyForLevel(7), 'mid', '7 → mid');
  eq(bucketKeyForLevel(11), 'high', '11 → high');
  eq(bucketKeyForLevel(20), 'hall', '20 → hall');

  // ===========================================================================
  // 3 — basic grouping (no filters)
  // ===========================================================================
  console.log('\n[3] basic grouping — no filters');
  const players = [
    p('0xa', 'Alice', 5, 1500),
    p('0xb', 'Bob',   5, 1100),
    p('0xc', 'Carol', 12, 1300),
    p('0xd', 'Dave',  1, 1000),
  ];
  const buckets = groupPlayersForSidebar(players);
  eq(buckets.length, 6, 'returns 6 buckets without hideEmpty');
  eq(buckets[0].players.length, 1, 'novice bucket has Dave');
  eq(buckets[1].players.length, 2, 'early bucket has Alice + Bob');
  eq(buckets[3].players.length, 1, 'high bucket has Carol');

  // ===========================================================================
  // 4 — sort: rating desc within bucket
  // ===========================================================================
  console.log('\n[4] in-bucket sort: rating desc');
  eq(buckets[1].players[0].name, 'Alice', 'Alice (1500) before Bob (1100)');
  eq(buckets[1].players[1].name, 'Bob', 'Bob second');

  // ===========================================================================
  // 5 — status priority: online > marketplace > fight > idle
  // ===========================================================================
  console.log('\n[5] sort: status priority');
  const mixed = [
    p('0x1', 'Idle',     5, 1500, 'idle'),
    p('0x2', 'Fighting', 5, 1500, 'in_fight'),
    p('0x3', 'Shopping', 5, 1500, 'in_marketplace'),
    p('0x4', 'Online',   5, 1500, 'online'),
  ];
  const mixedBuckets = groupPlayersForSidebar(mixed, { hideEmpty: true });
  eq(mixedBuckets[0].players[0].name, 'Online', 'online first');
  eq(mixedBuckets[0].players[1].name, 'Shopping', 'marketplace second');
  eq(mixedBuckets[0].players[2].name, 'Fighting', 'fighting third');
  eq(mixedBuckets[0].players[3].name, 'Idle', 'idle last');

  // ===========================================================================
  // 6 — search filter (case-insensitive substring)
  // ===========================================================================
  console.log('\n[6] search filter');
  const searched = groupPlayersForSidebar(players, { hideEmpty: true, search: 'al' });
  eq(searched.flatMap(b => b.players).length, 1, 'search "al" matches Alice only');
  const searchedUpper = groupPlayersForSidebar(players, { hideEmpty: true, search: 'BO' });
  eq(searchedUpper.flatMap(b => b.players).length, 1, 'search uppercase BO matches Bob');
  const searchedNone = groupPlayersForSidebar(players, { hideEmpty: true, search: 'zzz' });
  eq(searchedNone.length, 0, 'search "zzz" matches nobody');

  // ===========================================================================
  // 7 — status filter
  // ===========================================================================
  console.log('\n[7] status filter');
  const onlyFighting = groupPlayersForSidebar(mixed, {
    hideEmpty: true,
    statusFilter: ['in_fight'],
  });
  eq(onlyFighting.flatMap(b => b.players).length, 1, 'status=in_fight → 1 match');
  eq(onlyFighting[0].players[0].name, 'Fighting', 'matched the right player');

  const noneIdle = groupPlayersForSidebar(mixed, {
    hideEmpty: true,
    statusFilter: ['online', 'in_marketplace'],
  });
  eq(noneIdle.flatMap(b => b.players).length, 2, 'status filter union of two');

  // ===========================================================================
  // 8 — exclude filter (viewer's own wallet)
  // ===========================================================================
  console.log('\n[8] exclude filter');
  const excluded = groupPlayersForSidebar(players, {
    hideEmpty: true,
    exclude: ['0xa'],
  });
  eq(excluded.flatMap(b => b.players).length, 3, 'exclude alice → 3 left');
  // Case-insensitive
  const excludedUpper = groupPlayersForSidebar(players, {
    hideEmpty: true,
    exclude: ['0xA'],
  });
  eq(excludedUpper.flatMap(b => b.players).length, 3, 'exclude case-insensitive');

  // ===========================================================================
  // 9 — hideEmpty option
  // ===========================================================================
  console.log('\n[9] hideEmpty option');
  const single = [p('0xs', 'Solo', 5, 1000)];
  const visible = groupPlayersForSidebar(single, { hideEmpty: true });
  eq(visible.length, 1, 'only the early bucket renders');
  eq(visible[0].key, 'early', 'and it is the right one');
  const all = groupPlayersForSidebar(single);
  eq(all.length, 6, 'without hideEmpty, all 6 buckets render');

  // ===========================================================================
  // 10 — combined filters
  // ===========================================================================
  console.log('\n[10] combined search + status + exclude + hideEmpty');
  const combined = groupPlayersForSidebar(players, {
    hideEmpty: true,
    search: 'b',
    exclude: ['0xb'],
    statusFilter: ['online'],
  });
  eq(combined.flatMap(b => b.players).length, 0, 'combined filters → empty');

  const combined2 = groupPlayersForSidebar(players, {
    hideEmpty: true,
    search: 'a',
  });
  // matches Alice (level 5), Carol (12), Dave (1)
  eq(combined2.flatMap(b => b.players).length, 3, 'search "a" matches 3');

  // ===========================================================================
  // 11 — defensive: out-of-range level falls back to first bucket
  // ===========================================================================
  console.log('\n[11] defensive — out-of-range level');
  const weird = [p('0xz', 'WeirdLv', 0, 1000)];
  const weirdBuckets = groupPlayersForSidebar(weird, { hideEmpty: true });
  eq(weirdBuckets.length, 1, 'level 0 still placed somewhere');
  eq(weirdBuckets[0].key, 'novice', 'fallback bucket is novice');

  // Final
  console.log(`\n✓ Passed: ${passes}`);
  if (failures > 0) {
    console.log(`✗ Failed: ${failures}`);
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();
