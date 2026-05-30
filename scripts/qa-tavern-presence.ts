/**
 * Presence service gauntlet (Bucket 3 — Tavern, 2026-05-06).
 *
 *   $ cd server && npx tsx ../scripts/qa-tavern-presence.ts
 *
 * Pins the in-memory presence service from `server/src/data/presence.ts`:
 *   • upsertPresence — insert/update detection, status derivation
 *   • derivePlayerStatus — pure status logic
 *   • groupPlayersByLevelBucket — bucketing by level brackets
 *   • sweepStalePresence — TTL-based eviction
 *   • toWire — wire-shape conversion
 *   • room transitions, fight transitions, idle transitions
 *
 * Pure JS, no DB, no WS.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  upsertPresence,
  removePresence,
  heartbeat,
  derivePlayerStatus,
  groupPlayersByLevelBucket,
  sweepStalePresence,
  bucketKeyForLevel,
  getOnlinePlayers,
  toWire,
  PRESENCE_STALE_MS,
  _testResetPresence,
  _testSnapshot,
} from '../server/src/data/presence';

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
function truthy(v: unknown, label: string): void {
  if (v) ok(label);
  else fail(label, `expected truthy, got ${JSON.stringify(v)}`);
}
function falsy(v: unknown, label: string): void {
  if (!v) ok(label);
  else fail(label, `expected falsy, got ${JSON.stringify(v)}`);
}

function main(): void {
  // ===========================================================================
  // 1 — derivePlayerStatus: pure logic
  // ===========================================================================
  console.log('\n[1] derivePlayerStatus — pure status derivation');
  const now = 1_000_000_000_000;
  eq(derivePlayerStatus('tavern', undefined, now, now), 'online',
    'fresh tavern → online');
  eq(derivePlayerStatus('tavern', 'fight-1', now, now), 'in_fight',
    'fightId set → in_fight regardless of room');
  eq(derivePlayerStatus('fight', undefined, now, now), 'in_fight',
    'fight room → in_fight even without fightId');
  eq(derivePlayerStatus('marketplace', undefined, now, now), 'in_marketplace',
    'marketplace room → in_marketplace');
  eq(derivePlayerStatus('marketplace', 'fight-x', now, now), 'in_fight',
    'fight beats marketplace');
  eq(derivePlayerStatus('tavern', undefined, now - 35_000, now), 'idle',
    'lastSeen >30s ago → idle');
  eq(derivePlayerStatus('tavern', undefined, now - 29_000, now), 'online',
    'lastSeen <30s ago → online');
  eq(derivePlayerStatus('character', undefined, now, now), 'online',
    'character room counts as online');
  eq(derivePlayerStatus('arena', undefined, now, now), 'online',
    'arena room counts as online');
  eq(derivePlayerStatus('hall_of_fame', undefined, now, now), 'online',
    'hall_of_fame room counts as online');

  // ===========================================================================
  // 2 — bucketKeyForLevel: pure bracket math
  // ===========================================================================
  console.log('\n[2] bucketKeyForLevel — bracket math');
  eq(bucketKeyForLevel(1), 'novice', 'L1 → novice');
  eq(bucketKeyForLevel(3), 'novice', 'L3 → novice (upper bound)');
  eq(bucketKeyForLevel(4), 'early', 'L4 → early');
  eq(bucketKeyForLevel(6), 'early', 'L6 → early');
  eq(bucketKeyForLevel(7), 'mid', 'L7 → mid');
  eq(bucketKeyForLevel(9), 'mid', 'L9 → mid');
  eq(bucketKeyForLevel(10), 'high', 'L10 → high');
  eq(bucketKeyForLevel(14), 'high', 'L14 → high');
  eq(bucketKeyForLevel(15), 'endgame', 'L15 → endgame');
  eq(bucketKeyForLevel(19), 'endgame', 'L19 → endgame');
  eq(bucketKeyForLevel(20), 'hall', 'L20 → hall');
  eq(bucketKeyForLevel(0), 'novice', 'L0 (defensive) → novice');

  // ===========================================================================
  // 3 — groupPlayersByLevelBucket: bucketing + sort
  // ===========================================================================
  console.log('\n[3] groupPlayersByLevelBucket — group + sort');
  const players = [
    { walletAddress: '0xa', name: 'A', level: 5,  rating: 1100, status: 'online' as const, currentRoom: 'tavern' as const },
    { walletAddress: '0xb', name: 'B', level: 5,  rating: 1500, status: 'online' as const, currentRoom: 'tavern' as const },
    { walletAddress: '0xc', name: 'C', level: 12, rating: 1300, status: 'online' as const, currentRoom: 'tavern' as const },
    { walletAddress: '0xd', name: 'D', level: 1,  rating: 1000, status: 'online' as const, currentRoom: 'tavern' as const },
  ];
  const buckets = groupPlayersByLevelBucket(players);
  eq(buckets.length, 6, 'always 6 buckets');
  eq(buckets[0].players.length, 1, 'novice has 1 (D)');
  eq(buckets[1].players.length, 2, 'early has 2 (A, B)');
  eq(buckets[3].players.length, 1, 'high has 1 (C)');
  eq(buckets[1].players[0].name, 'B', 'sort by rating desc within bucket (B 1500 > A 1100)');
  eq(buckets[1].players[1].name, 'A', 'sort by rating desc within bucket (A 1100)');

  // ===========================================================================
  // 4 — upsertPresence: insert vs update detection
  // ===========================================================================
  console.log('\n[4] upsertPresence — insert/update detection');
  _testResetPresence();
  const r1 = upsertPresence({ walletAddress: '0x1', characterName: 'P1', level: 5, rating: 1100, room: 'tavern' });
  truthy(r1.inserted, 'first call → inserted=true');
  truthy(r1.statusChanged, 'first call → statusChanged=true');
  truthy(r1.roomChanged, 'first call → roomChanged=true');
  eq(r1.row.status, 'online', 'first call → status=online');

  const r2 = upsertPresence({ walletAddress: '0x1' });
  falsy(r2.inserted, 'second call → inserted=false');
  falsy(r2.statusChanged, 'idempotent heartbeat → statusChanged=false');
  falsy(r2.roomChanged, 'idempotent heartbeat → roomChanged=false');

  const r3 = upsertPresence({ walletAddress: '0x1', room: 'marketplace' });
  truthy(r3.statusChanged, 'room change → statusChanged=true');
  truthy(r3.roomChanged, 'room change → roomChanged=true');
  eq(r3.row.status, 'in_marketplace', 'marketplace room → status=in_marketplace');

  const r4 = upsertPresence({ walletAddress: '0x1', fightId: 'fight-1' });
  truthy(r4.statusChanged, 'fight start → statusChanged=true');
  eq(r4.row.status, 'in_fight', 'fightId set → status=in_fight');

  const r5 = upsertPresence({ walletAddress: '0x1', fightId: null, room: 'tavern' });
  truthy(r5.statusChanged, 'fight end → statusChanged=true');
  eq(r5.row.status, 'online', 'fightId cleared + tavern → status=online');

  // ===========================================================================
  // 5 — heartbeat: refreshes without state change
  // ===========================================================================
  console.log('\n[5] heartbeat — refreshes lastSeenAt only');
  _testResetPresence();
  upsertPresence({ walletAddress: '0xH', characterName: 'H', level: 1, rating: 1000 });
  const beat1 = heartbeat('0xH', 1000);
  truthy(beat1, 'heartbeat for known wallet → result');
  const beat2 = heartbeat('0xUNKNOWN');
  eq(beat2, null, 'heartbeat for unknown wallet → null');

  // ===========================================================================
  // 6 — sweepStalePresence: TTL eviction
  // ===========================================================================
  console.log('\n[6] sweepStalePresence — drops rows older than PRESENCE_STALE_MS');
  _testResetPresence();
  const t = 2_000_000_000_000;
  upsertPresence({ walletAddress: '0xS1', now: t - PRESENCE_STALE_MS - 1_000 });
  upsertPresence({ walletAddress: '0xS2', now: t - 10_000 });
  const dropped = sweepStalePresence(t);
  eq(dropped.length, 1, 'one stale wallet dropped');
  eq(dropped[0], '0xS1', 'older wallet dropped, fresher kept');
  eq(_testSnapshot().length, 1, 'snapshot has 1 row remaining');

  // ===========================================================================
  // 7 — getOnlinePlayers: snapshot order
  // ===========================================================================
  console.log('\n[7] getOnlinePlayers — sort by level desc');
  _testResetPresence();
  upsertPresence({ walletAddress: '0xP1', characterName: 'P1', level: 3,  rating: 1000 });
  upsertPresence({ walletAddress: '0xP2', characterName: 'P2', level: 12, rating: 1200 });
  upsertPresence({ walletAddress: '0xP3', characterName: 'P3', level: 5,  rating: 1500 });
  const players2 = getOnlinePlayers();
  eq(players2.length, 3, 'three players online');
  eq(players2[0].level, 12, 'highest-level first');
  eq(players2[2].level, 3, 'lowest-level last');

  // ===========================================================================
  // 8 — toWire: wire-shape parity
  // ===========================================================================
  console.log('\n[8] toWire — wire-shape parity');
  _testResetPresence();
  upsertPresence({
    walletAddress: '0xW',
    characterName: 'Wirey',
    level: 7,
    rating: 1234,
    room: 'arena',
  });
  const w = toWire(_testSnapshot()[0]);
  eq(w.walletAddress, '0xW', 'walletAddress preserved');
  eq(w.name, 'Wirey', 'characterName → name');
  eq(w.level, 7, 'level preserved');
  eq(w.rating, 1234, 'rating preserved');
  eq(w.status, 'online', 'arena room → online');
  eq(w.currentRoom, 'arena', 'currentRoom preserved');
  eq(w.fightId, undefined, 'no fightId → undefined');

  // ===========================================================================
  // 9 — removePresence
  // ===========================================================================
  console.log('\n[9] removePresence — drops + returns prior row');
  _testResetPresence();
  upsertPresence({ walletAddress: '0xR', characterName: 'R', level: 2, rating: 1000 });
  const removed = removePresence('0xR');
  truthy(removed, 'removePresence returned a row');
  eq(removePresence('0xR'), null, 'second remove returns null');
  eq(_testSnapshot().length, 0, 'snapshot empty after remove');

  // ===========================================================================
  // 10 — multi-bucket scenario
  // ===========================================================================
  console.log('\n[10] full sidebar scenario — multi-bucket render');
  _testResetPresence();
  for (let i = 1; i <= 20; i++) {
    upsertPresence({
      walletAddress: `0xAddr${i.toString().padStart(2, '0')}`,
      characterName: `Player${i}`,
      level: i,
      rating: 1000 + i * 10,
    });
  }
  const allBuckets = groupPlayersByLevelBucket(getOnlinePlayers());
  eq(allBuckets[0].players.length, 3,  'novice 1-3 → 3 players');
  eq(allBuckets[1].players.length, 3,  'early 4-6 → 3 players');
  eq(allBuckets[2].players.length, 3,  'mid 7-9 → 3 players');
  eq(allBuckets[3].players.length, 5,  'high 10-14 → 5 players');
  eq(allBuckets[4].players.length, 5,  'endgame 15-19 → 5 players');
  eq(allBuckets[5].players.length, 1,  'hall 20 → 1 player');

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
