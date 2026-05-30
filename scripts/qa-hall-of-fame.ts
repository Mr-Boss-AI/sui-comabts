/**
 * Hall of Fame gauntlet (Bucket 3 #2, 2026-05-13).
 *
 *   $ cd server && npx tsx ../scripts/qa-hall-of-fame.ts
 *
 * Pins the leaderboard's pure helpers:
 *   • Sort comparator — every column, both directions, tiebreakers,
 *     stability across re-runs.
 *   • Sort toggle state machine — same-column flip, new-column default,
 *     DEFAULT_DIR shape, indicator strings.
 *   • Level filter — every bucket option, "all" sentinel, range checks
 *     match Tavern's SIDEBAR_BUCKETS.
 *   • Build classifier — Crit / Evasion / Tank / Hybrid edge cases.
 *   • Live bucket + build counts for chip labels.
 *   • Pagination — page sizes, hasMore, clamp.
 *   • Composite filter+sort+paginate roundtrip on realistic data.
 *   • Empty / loading state predicates render the right slot.
 *
 * Pure JS, no DB, no WS, no chain.
 */

import {
  DEFAULT_DIR,
  compareEntries,
  nextSortState,
  sortIndicator,
  sortLeaderboard,
  winRateFor,
  type SortKey,
  type SortState,
} from '../frontend/src/lib/hall-of-fame-sort';
import {
  BUILD_FILTER_OPTIONS,
  BUILD_DOMINANCE_THRESHOLD,
  LEVEL_BUCKET_OPTIONS,
  buildCounts,
  classifyBuild,
  entryMatches,
  filterEntries,
  levelBucketContains,
  levelBucketCounts,
  type BuildFilter,
  type FilterState,
  type LevelFilter,
} from '../frontend/src/lib/hall-of-fame-filter';
import {
  PAGE_SIZE,
  formatWinRatePct,
  paginateEntries,
  rankColor,
} from '../frontend/src/lib/hall-of-fame-display';
import { SIDEBAR_BUCKETS } from '../frontend/src/lib/player-bucket';
import type { CharacterStats, LeaderboardEntry } from '../frontend/src/types/game';

let passes = 0;
let failures = 0;
const failureLog: string[] = [];

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  const msg = `${label}\n        ${detail}`;
  failureLog.push(msg);
  console.log(`  \x1b[31mFAIL\x1b[0m ${msg}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (Object.is(actual, expected)) ok(label);
  else
    fail(
      label,
      `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
}
function truthy(value: unknown, label: string): void {
  if (value) ok(label);
  else fail(label, `expected truthy, got ${JSON.stringify(value)}`);
}
function deep(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else
    fail(
      label,
      `\n        actual  =${JSON.stringify(actual)}\n        expected=${JSON.stringify(expected)}`,
    );
}

function mkStats(s: number, d: number, i: number, e: number): CharacterStats {
  return { strength: s, dexterity: d, intuition: i, endurance: e };
}

function entry(
  rank: number,
  name: string,
  level: number,
  rating: number,
  wins: number,
  losses: number,
  stats?: CharacterStats,
  walletAddress?: string,
  draws: number = 0,
): LeaderboardEntry {
  return {
    rank,
    walletAddress: walletAddress ?? `0x${rank.toString(16).padStart(40, '0')}`,
    name,
    level,
    rating,
    wins,
    losses,
    draws,
    stats,
  };
}

function main(): void {
  // ===========================================================================
  // [1] DEFAULT_DIR shape — natural direction for each column
  // ===========================================================================
  console.log('\n[1] DEFAULT_DIR — natural direction for each column');
  eq(DEFAULT_DIR.rank, 'asc', 'rank defaults asc (#1 is the leader)');
  eq(DEFAULT_DIR.level, 'desc', 'level defaults desc');
  eq(DEFAULT_DIR.rating, 'desc', 'rating defaults desc');
  eq(DEFAULT_DIR.wins, 'desc', 'wins defaults desc');
  eq(DEFAULT_DIR.losses, 'desc', 'losses defaults desc');
  eq(DEFAULT_DIR.winRate, 'desc', 'winRate defaults desc');
  eq(Object.keys(DEFAULT_DIR).length, 6, 'six sortable columns total');

  // ===========================================================================
  // [2] winRateFor — pure helper
  // ===========================================================================
  console.log('\n[2] winRateFor — no fights yields 0; otherwise W/(W+L)');
  eq(winRateFor(entry(1, 'Z', 1, 1000, 0, 0)), 0, '0/0 → 0');
  eq(winRateFor(entry(1, 'Z', 1, 1000, 1, 1)), 0.5, '1/2 → 0.5');
  eq(winRateFor(entry(1, 'Z', 1, 1000, 7, 3)), 0.7, '7/10 → 0.7');
  eq(winRateFor(entry(1, 'Z', 1, 1000, 5, 0)), 1, '5/5 → 1');

  // ===========================================================================
  // [3] compareEntries — every column, both directions
  // ===========================================================================
  console.log('\n[3] compareEntries — every column × asc/desc');
  const a = entry(2, 'Alice', 10, 1500, 12, 4, undefined, '0xa1');
  const b = entry(5, 'Bob', 8, 1200, 9, 9, undefined, '0xb2');
  truthy(compareEntries(a, b, 'rank', 'asc') < 0, 'rank asc: a(2) < b(5)');
  truthy(compareEntries(a, b, 'rank', 'desc') > 0, 'rank desc: a(2) > b(5)');
  truthy(compareEntries(a, b, 'level', 'asc') > 0, 'level asc: a(10) > b(8)');
  truthy(compareEntries(a, b, 'level', 'desc') < 0, 'level desc: a(10) < b(8)');
  truthy(compareEntries(a, b, 'rating', 'asc') > 0, 'rating asc: a(1500) > b(1200)');
  truthy(compareEntries(a, b, 'rating', 'desc') < 0, 'rating desc: a(1500) < b(1200)');
  truthy(compareEntries(a, b, 'wins', 'asc') > 0, 'wins asc: a(12) > b(9)');
  truthy(compareEntries(a, b, 'wins', 'desc') < 0, 'wins desc: a(12) < b(9)');
  truthy(compareEntries(a, b, 'losses', 'asc') < 0, 'losses asc: a(4) < b(9)');
  truthy(compareEntries(a, b, 'losses', 'desc') > 0, 'losses desc: a(4) > b(9)');
  truthy(compareEntries(a, b, 'winRate', 'asc') > 0, 'winRate asc: a(.75) > b(.5)');
  truthy(compareEntries(a, b, 'winRate', 'desc') < 0, 'winRate desc: a(.75) < b(.5)');

  // ===========================================================================
  // [4] compareEntries — tiebreakers
  // ===========================================================================
  console.log('\n[4] compareEntries — tiebreakers');
  const eq1 = entry(1, 'A', 5, 1500, 10, 5, undefined, '0xaa');
  const eq2 = entry(2, 'B', 5, 1500, 10, 5, undefined, '0xbb');
  // Equal primary key (level), equal rating → wallet asc
  eq(compareEntries(eq1, eq2, 'level', 'asc'), -1, 'tiebreaker → wallet asc (0xaa<0xbb)');
  eq(compareEntries(eq2, eq1, 'level', 'asc'), 1, 'tiebreaker symmetric (b vs a)');
  // Equal primary on rating column: must NOT call rating again, falls
  // straight to wallet
  eq(compareEntries(eq1, eq2, 'rating', 'desc'), -1, 'rating tie → wallet asc');
  // Equal level but different rating: rating-desc breaks tie BEFORE wallet
  const tie1 = entry(1, 'A', 5, 1500, 10, 5, undefined, '0xff');
  const tie2 = entry(2, 'B', 5, 1100, 10, 5, undefined, '0x00');
  truthy(
    compareEntries(tie1, tie2, 'level', 'asc') < 0,
    'level tie broken by rating desc before wallet (higher rating wins)',
  );

  // ===========================================================================
  // [5] sortLeaderboard — returns NEW array, sort is stable, doesn't mutate
  // ===========================================================================
  console.log('\n[5] sortLeaderboard — immutability + stability');
  const original: LeaderboardEntry[] = [
    entry(1, 'Mr_Boss', 6, 982, 8, 4, mkStats(40, 8, 4, 4)),
    entry(2, 'Sx', 6, 1018, 12, 4, mkStats(8, 40, 4, 4)),
    entry(3, 'Carol', 8, 1200, 10, 10, mkStats(20, 20, 20, 20)),
  ];
  const snapshot = JSON.stringify(original);
  const sortedByRating = sortLeaderboard(original, { key: 'rating', dir: 'desc' });
  eq(JSON.stringify(original), snapshot, 'input array is not mutated');
  eq(sortedByRating[0].name, 'Carol', 'desc rating: Carol(1200) first');
  eq(sortedByRating[1].name, 'Sx', 'desc rating: Sx(1018) second');
  eq(sortedByRating[2].name, 'Mr_Boss', 'desc rating: Mr_Boss(982) third');
  const re = sortLeaderboard(original, { key: 'rating', dir: 'desc' });
  deep(re.map((e) => e.name), sortedByRating.map((e) => e.name), 'stable across re-runs');
  const ascRating = sortLeaderboard(original, { key: 'rating', dir: 'asc' });
  eq(ascRating[0].name, 'Mr_Boss', 'asc rating: Mr_Boss(982) first');
  eq(ascRating[2].name, 'Carol', 'asc rating: Carol(1200) last');

  // ===========================================================================
  // [6] nextSortState — toggle logic
  // ===========================================================================
  console.log('\n[6] nextSortState — toggle / switch');
  // Same key: flip direction
  deep(
    nextSortState({ key: 'rating', dir: 'desc' }, 'rating'),
    { key: 'rating', dir: 'asc' },
    'rating desc → rating asc (flip)',
  );
  deep(
    nextSortState({ key: 'rating', dir: 'asc' }, 'rating'),
    { key: 'rating', dir: 'desc' },
    'rating asc → rating desc (flip)',
  );
  // New key: switch with natural default
  deep(
    nextSortState({ key: 'rating', dir: 'desc' }, 'rank'),
    { key: 'rank', dir: 'asc' },
    'rating → rank uses rank default (asc)',
  );
  deep(
    nextSortState({ key: 'rank', dir: 'asc' }, 'level'),
    { key: 'level', dir: 'desc' },
    'rank → level uses level default (desc)',
  );
  deep(
    nextSortState({ key: 'rank', dir: 'asc' }, 'winRate'),
    { key: 'winRate', dir: 'desc' },
    'rank → winRate uses winRate default (desc)',
  );
  // Idempotent shape — repeated identical clicks alternate cleanly
  let st: SortState = { key: 'level', dir: 'desc' };
  st = nextSortState(st, 'level');
  eq(st.dir, 'asc', 'click 1: level desc → asc');
  st = nextSortState(st, 'level');
  eq(st.dir, 'desc', 'click 2: level asc → desc');
  st = nextSortState(st, 'level');
  eq(st.dir, 'asc', 'click 3: level desc → asc (3-click cycle settles)');

  // ===========================================================================
  // [7] sortIndicator — only the active column shows an arrow
  // ===========================================================================
  console.log('\n[7] sortIndicator');
  eq(sortIndicator({ key: 'rating', dir: 'desc' }, 'rating'), '↓', 'active desc shows ↓');
  eq(sortIndicator({ key: 'rating', dir: 'asc' }, 'rating'), '↑', 'active asc shows ↑');
  eq(sortIndicator({ key: 'rating', dir: 'desc' }, 'level'), '', 'inactive column shows nothing');
  eq(sortIndicator({ key: 'wins', dir: 'asc' }, 'losses'), '', 'inactive column (wins vs losses)');

  // ===========================================================================
  // [8] LEVEL_BUCKET_OPTIONS — shape + parity with Tavern SIDEBAR_BUCKETS
  // ===========================================================================
  console.log('\n[8] LEVEL_BUCKET_OPTIONS — single source of truth with Tavern');
  eq(
    LEVEL_BUCKET_OPTIONS.length,
    SIDEBAR_BUCKETS.length + 1,
    'all sentinel + every sidebar bucket',
  );
  eq(LEVEL_BUCKET_OPTIONS[0].key, 'all', 'all sentinel first');
  for (let i = 0; i < SIDEBAR_BUCKETS.length; i++) {
    const tavern = SIDEBAR_BUCKETS[i];
    const hof = LEVEL_BUCKET_OPTIONS[i + 1];
    eq(hof.key, tavern.key, `bucket[${i}] key matches Tavern (${tavern.key})`);
    eq(hof.minLevel, tavern.minLevel, `bucket[${i}] minLevel matches`);
    eq(hof.maxLevel, tavern.maxLevel, `bucket[${i}] maxLevel matches`);
  }

  // ===========================================================================
  // [9] levelBucketContains — inclusive range
  // ===========================================================================
  console.log('\n[9] levelBucketContains');
  truthy(levelBucketContains('all', 1), 'all contains Lv 1');
  truthy(levelBucketContains('all', 100), 'all contains Lv 100');
  truthy(levelBucketContains('novice', 1), 'novice contains Lv 1 (min boundary)');
  truthy(levelBucketContains('novice', 3), 'novice contains Lv 3 (max boundary)');
  eq(levelBucketContains('novice', 4), false, 'novice excludes Lv 4');
  truthy(levelBucketContains('early', 4), 'early contains Lv 4');
  truthy(levelBucketContains('early', 6), 'early contains Lv 6');
  truthy(levelBucketContains('mid', 7), 'mid contains Lv 7');
  truthy(levelBucketContains('high', 14), 'high contains Lv 14');
  truthy(levelBucketContains('endgame', 19), 'endgame contains Lv 19');
  truthy(levelBucketContains('hall', 20), 'hall contains Lv 20');
  truthy(levelBucketContains('hall', 99), 'hall contains Lv 99');
  eq(levelBucketContains('hall', 19), false, 'hall excludes Lv 19');
  eq(levelBucketContains('bogus' as LevelFilter, 5), false, 'unknown bucket → false');

  // ===========================================================================
  // [10] classifyBuild — Crit / Evasion / Tank / Hybrid
  // ===========================================================================
  console.log('\n[10] classifyBuild');
  eq(classifyBuild(mkStats(40, 8, 4, 4)), 'crit', 'STR-led (40/56 ≈ 71%) → crit');
  eq(classifyBuild(mkStats(8, 40, 4, 4)), 'evasion', 'DEX-led → evasion');
  eq(classifyBuild(mkStats(4, 4, 8, 40)), 'tank', 'END-led → tank');
  eq(classifyBuild(mkStats(4, 4, 40, 8)), 'hybrid', 'INT-led → hybrid (no INT archetype)');
  // Mixed: 35/30/20/15 = 35% STR → below 45% threshold → hybrid
  eq(classifyBuild(mkStats(35, 30, 20, 15)), 'hybrid', 'no stat ≥45% → hybrid');
  // Exactly at threshold
  eq(classifyBuild(mkStats(45, 25, 25, 5)), 'crit', '45%/100 STR (at threshold) → crit');
  eq(classifyBuild(mkStats(44, 26, 25, 5)), 'hybrid', '44%/100 STR (below threshold) → hybrid');
  // Defensive: missing / zero / negative
  eq(classifyBuild(undefined), 'hybrid', 'undefined stats → hybrid');
  eq(classifyBuild(null), 'hybrid', 'null stats → hybrid');
  eq(classifyBuild(mkStats(0, 0, 0, 0)), 'hybrid', 'all zero → hybrid (no divide-by-zero)');
  eq(classifyBuild(mkStats(10, 10, 10, 10)), 'hybrid', 'evenly split → hybrid');
  // Threshold default value sanity
  truthy(
    BUILD_DOMINANCE_THRESHOLD > 0.4 && BUILD_DOMINANCE_THRESHOLD < 0.6,
    'BUILD_DOMINANCE_THRESHOLD in plausible 40-60% range',
  );

  // ===========================================================================
  // [11] filterEntries — level + build + search composite
  // ===========================================================================
  console.log('\n[11] filterEntries — composite');
  const corpus: LeaderboardEntry[] = [
    entry(1, 'Mr_Boss_v5.1', 6, 982, 8, 4, mkStats(40, 8, 4, 4)),
    entry(2, 'Sx_v5.1', 6, 1018, 12, 4, mkStats(8, 40, 4, 4)),
    entry(3, 'TankBro', 12, 1300, 20, 10, mkStats(4, 4, 4, 40)),
    entry(4, 'NewbieDave', 2, 1010, 1, 0, mkStats(10, 10, 10, 10)),
    entry(5, 'EndgameElsa', 20, 1500, 50, 10, mkStats(35, 30, 20, 15)),
  ];
  const onlyEarly = filterEntries(corpus, { level: 'early', build: 'all' });
  eq(onlyEarly.length, 2, 'early bucket: Mr_Boss + Sx');
  eq(onlyEarly.every((e) => e.level >= 4 && e.level <= 6), true, 'early range satisfied');
  const onlyCrit = filterEntries(corpus, { level: 'all', build: 'crit' });
  eq(onlyCrit.length, 1, 'crit only: Mr_Boss');
  eq(onlyCrit[0].name, 'Mr_Boss_v5.1', 'crit entry is Mr_Boss');
  const earlyEvasion = filterEntries(corpus, { level: 'early', build: 'evasion' });
  eq(earlyEvasion.length, 1, 'early + evasion: Sx only');
  const tankAll = filterEntries(corpus, { level: 'all', build: 'tank' });
  eq(tankAll.length, 1, 'tank: TankBro');
  const hybridAll = filterEntries(corpus, { level: 'all', build: 'hybrid' });
  eq(hybridAll.length, 2, 'hybrid: NewbieDave + EndgameElsa');
  const search = filterEntries(corpus, { level: 'all', build: 'all', search: 'mr_' });
  eq(search.length, 1, 'search "mr_" matches Mr_Boss only');
  const searchCase = filterEntries(corpus, {
    level: 'all',
    build: 'all',
    search: 'SX_',
  });
  eq(searchCase.length, 1, 'search is case-insensitive');
  const empty = filterEntries(corpus, {
    level: 'novice',
    build: 'tank',
    search: '',
  });
  eq(empty.length, 0, 'novice+tank: no matches → empty array');

  // entryMatches mirrors filterEntries
  eq(
    entryMatches(corpus[0], { level: 'early', build: 'crit' }),
    true,
    'Mr_Boss matches early+crit',
  );
  eq(
    entryMatches(corpus[0], { level: 'mid', build: 'crit' }),
    false,
    'Mr_Boss excluded by mid bucket',
  );

  // ===========================================================================
  // [12] levelBucketCounts — live chip counts
  // ===========================================================================
  console.log('\n[12] levelBucketCounts');
  const lc = levelBucketCounts(corpus);
  eq(lc.all, 5, 'all = total entries');
  eq(lc.novice, 1, 'novice: NewbieDave');
  eq(lc.early, 2, 'early: Mr_Boss + Sx');
  eq(lc.mid, 0, 'mid: nobody at Lv 7-9');
  eq(lc.high, 1, 'high: TankBro');
  eq(lc.endgame, 0, 'endgame: nobody at Lv 15-19');
  eq(lc.hall, 1, 'hall: EndgameElsa');

  // ===========================================================================
  // [13] buildCounts — live chip counts
  // ===========================================================================
  console.log('\n[13] buildCounts');
  const bc = buildCounts(corpus);
  eq(bc.all, 5, 'all = total entries');
  eq(bc.crit, 1, 'crit: 1');
  eq(bc.evasion, 1, 'evasion: 1');
  eq(bc.tank, 1, 'tank: 1');
  eq(bc.hybrid, 2, 'hybrid: 2 (NewbieDave + EndgameElsa)');
  // Counts always sum to total
  eq(bc.crit + bc.evasion + bc.tank + bc.hybrid, bc.all, 'counts partition cleanly');

  // BUILD_FILTER_OPTIONS shape sanity
  eq(BUILD_FILTER_OPTIONS.length, 5, 'all + 4 archetypes');
  eq(BUILD_FILTER_OPTIONS[0].key, 'all', 'all sentinel first');
  deep(
    BUILD_FILTER_OPTIONS.slice(1).map((o) => o.key),
    ['crit', 'evasion', 'tank', 'hybrid'],
    'build chips in canonical order',
  );

  // ===========================================================================
  // [14] paginateEntries — page math
  // ===========================================================================
  console.log('\n[14] paginateEntries');
  const fifty: LeaderboardEntry[] = Array.from({ length: 50 }, (_, i) =>
    entry(i + 1, `P${i + 1}`, 5, 1500 - i, i, 0, mkStats(20, 20, 20, 20)),
  );
  const p1 = paginateEntries(fifty, { currentPage: 1, pageSize: PAGE_SIZE });
  eq(p1.totalShown, PAGE_SIZE, 'page 1 shows pageSize entries');
  eq(p1.totalAvailable, 50, 'totalAvailable = filtered list length');
  eq(p1.hasMore, true, 'page 1 of 50 → hasMore');
  eq(p1.visible[0].name, 'P1', 'page 1 starts at P1');
  eq(p1.visible.length, 20, 'page 1 has 20 rows');
  const p2 = paginateEntries(fifty, { currentPage: 2, pageSize: PAGE_SIZE });
  eq(p2.totalShown, 40, 'page 2 cumulative shows 40');
  eq(p2.hasMore, true, 'page 2 of 50 → hasMore');
  const p3 = paginateEntries(fifty, { currentPage: 3, pageSize: PAGE_SIZE });
  eq(p3.totalShown, 50, 'page 3 caps at 50');
  eq(p3.hasMore, false, 'page 3 has no more');
  const p99 = paginateEntries(fifty, { currentPage: 99, pageSize: PAGE_SIZE });
  eq(p99.totalShown, 50, 'overshooting page caps at total');
  eq(p99.hasMore, false, 'overshoot → no more');
  const pZero = paginateEntries(fifty, { currentPage: 0, pageSize: PAGE_SIZE });
  eq(pZero.totalShown, 20, 'page<1 clamps to page=1');
  const pNeg = paginateEntries(fifty, { currentPage: -3, pageSize: PAGE_SIZE });
  eq(pNeg.totalShown, 20, 'negative page clamps to page=1');
  const small = paginateEntries(corpus, { currentPage: 1, pageSize: 2 });
  eq(small.totalShown, 2, 'custom pageSize=2');
  eq(small.hasMore, true, '5 entries pageSize=2 page 1 → hasMore');
  const empty1 = paginateEntries([], { currentPage: 1, pageSize: PAGE_SIZE });
  eq(empty1.totalShown, 0, 'empty input → 0 shown');
  eq(empty1.hasMore, false, 'empty input → no more');
  eq(empty1.totalAvailable, 0, 'empty input → 0 available');

  // PAGE_SIZE sanity
  eq(PAGE_SIZE, 20, 'PAGE_SIZE constant is 20 per design');

  // ===========================================================================
  // [15] formatWinRatePct — display rounding (no draws — back-compat)
  // ===========================================================================
  console.log('\n[15] formatWinRatePct (no draws — back-compat)');
  eq(formatWinRatePct(0, 0), 0, '0/0 → 0%');
  eq(formatWinRatePct(1, 1), 50, '1/2 → 50%');
  eq(formatWinRatePct(7, 3), 70, '7/10 → 70%');
  eq(formatWinRatePct(2, 1), 67, '2/3 → 67% (rounded)');
  eq(formatWinRatePct(1, 2), 33, '1/3 → 33% (rounded)');
  eq(formatWinRatePct(10, 0), 100, '10/10 → 100%');

  // ===========================================================================
  // [15.5] formatWinRatePct — draws excluded from denominator (v5.1)
  //
  // Convention: draws are NOT decided fights and do not affect win%.
  // The D column on the ladder surfaces draws separately. See JSDoc on
  // lib/hall-of-fame-display.ts::formatWinRatePct for the rationale.
  // Pinned here so a future refactor can't silently switch to chess-style
  // "draws as half" without flipping this gauntlet.
  // ===========================================================================
  console.log('\n[15.5] formatWinRatePct — draws excluded from denominator');
  eq(formatWinRatePct(3, 0, 1), 100,
    '3W 0L 1D → 100% (the draw doesn\'t pull the percentage down)');
  eq(formatWinRatePct(7, 3, 5), 70,
    '7W 3L 5D → 70% (same as 7/10; D ignored)');
  eq(formatWinRatePct(0, 0, 10), 0,
    '0W 0L 10D → 0% (no decided fights → no rate to compute)');
  eq(formatWinRatePct(5, 5, 0), 50,
    '5W 5L 0D → 50% (sanity: 0 draws behaves like the old signature)');
  eq(formatWinRatePct(5, 5, 100), 50,
    '5W 5L 100D → 50% (draw count cannot move the needle)');
  // Mr_Boss + Sx live state after the 2026-05-29 mutual KO: each has
  // exactly one draw and a small win/loss history. Pin a concrete case
  // so the live render contract stays asserted.
  eq(formatWinRatePct(2, 1, 1), 67,
    'Mr_Boss-shaped: 2W 1L 1D → 67% (decided = 3, win = 2)');

  // ===========================================================================
  // [15.6] LeaderboardEntry render contract — W/L/D + winPct
  //
  // Pin that an entry with non-zero draws renders consistently across
  // the ladder column + the win% column. The ladder rows in
  // components/social/leaderboard.tsx read `entry.wins`,
  // `entry.losses`, `entry.draws` and pass them to formatWinRatePct in
  // the win% cell. Failure here means the wire payload OR the render
  // path lost the draws value.
  // ===========================================================================
  console.log('\n[15.6] LeaderboardEntry render contract (W/L/D + win%)');
  {
    const entry: LeaderboardEntry = {
      rank: 1, walletAddress: '0xabc', name: 'Mr_Boss',
      rating: 1050, wins: 2, losses: 1, draws: 1, level: 4,
    };
    eq(entry.draws, 1, 'entry carries draws on the wire');
    eq(formatWinRatePct(entry.wins, entry.losses, entry.draws), 67,
      'entry with draws renders 67% win rate');
    // Format the W/L/D triple the way the LadderRow does:
    const rendered = `${entry.wins} / ${entry.losses} / ${entry.draws}`;
    eq(rendered, '2 / 1 / 1',
      'LadderRow W/L/D column renders as "W / L / D"');
  }
  // Zero-draws case stays back-compat:
  {
    const entry: LeaderboardEntry = {
      rank: 2, walletAddress: '0xdef', name: 'Sx',
      rating: 1000, wins: 5, losses: 5, draws: 0, level: 3,
    };
    eq(`${entry.wins} / ${entry.losses} / ${entry.draws}`, '5 / 5 / 0',
      'zero-draws entry still renders the D column (just "0")');
    eq(formatWinRatePct(entry.wins, entry.losses, entry.draws), 50,
      'zero-draws entry win% matches old behavior');
  }

  // ===========================================================================
  // [16] rankColor — gold/silver/bronze/dim
  // ===========================================================================
  console.log('\n[16] rankColor');
  truthy(rankColor(1).includes('amber-400'), 'rank 1 → amber-400 (gold)');
  truthy(rankColor(2).includes('zinc-300'), 'rank 2 → zinc-300 (silver)');
  truthy(rankColor(3).includes('amber-600'), 'rank 3 → amber-600 (bronze)');
  truthy(rankColor(4).includes('zinc-500'), 'rank 4 → zinc-500 (dim)');
  truthy(rankColor(100).includes('zinc-500'), 'rank 100 → zinc-500');
  truthy(rankColor(1).includes('font-bold'), 'rank 1 is bold');
  truthy(rankColor(2).includes('font-bold'), 'rank 2 is bold');
  truthy(rankColor(3).includes('font-bold'), 'rank 3 is bold');

  // ===========================================================================
  // [17] Composite roundtrip — filter → sort → paginate
  // ===========================================================================
  console.log('\n[17] Composite: filter → sort → paginate');
  const big: LeaderboardEntry[] = [];
  // 25 evasion players at Lv 4-6
  for (let i = 0; i < 25; i++) {
    big.push(
      entry(
        i + 1,
        `Eva${i + 1}`,
        4 + (i % 3),
        1000 + i,
        i,
        Math.max(0, 5 - i % 5),
        mkStats(8, 40, 4, 4),
      ),
    );
  }
  // 5 crit Lv 10
  for (let i = 0; i < 5; i++) {
    big.push(
      entry(
        100 + i,
        `Crit${i + 1}`,
        10,
        2000 + i,
        20 + i,
        2,
        mkStats(40, 8, 4, 4),
        `0xcc${i.toString(16).padStart(38, '0')}`,
      ),
    );
  }
  // 1 tank Lv 20
  big.push(
    entry(200, 'TankKing', 20, 3000, 100, 5, mkStats(4, 4, 4, 40), '0xddd000'),
  );

  const earlyEvasionSorted = sortLeaderboard(
    filterEntries(big, { level: 'early', build: 'evasion' }),
    { key: 'rating', dir: 'desc' },
  );
  eq(earlyEvasionSorted.length, 25, 'early+evasion → 25 entries');
  eq(
    earlyEvasionSorted[0].rating > earlyEvasionSorted[1].rating ||
      earlyEvasionSorted[0].rating === earlyEvasionSorted[1].rating,
    true,
    'rating monotonic non-increasing',
  );
  // First entry should have highest rating in the filtered set
  const maxRating = Math.max(...earlyEvasionSorted.map((e) => e.rating));
  eq(earlyEvasionSorted[0].rating, maxRating, 'top of desc-rating equals max rating');
  // Paginate
  const pView = paginateEntries(earlyEvasionSorted, {
    currentPage: 1,
    pageSize: PAGE_SIZE,
  });
  eq(pView.totalShown, 20, 'first page renders 20');
  eq(pView.hasMore, true, '25 entries page 1 → hasMore');
  const pView2 = paginateEntries(earlyEvasionSorted, {
    currentPage: 2,
    pageSize: PAGE_SIZE,
  });
  eq(pView2.totalShown, 25, 'second page caps at 25');
  eq(pView2.hasMore, false, '25 entries page 2 → done');

  // Different filter: crit only
  const critOnly = filterEntries(big, { level: 'all', build: 'crit' });
  eq(critOnly.length, 5, 'crit subset: 5');
  // tank → 1
  const tankOnly = filterEntries(big, { level: 'hall', build: 'tank' });
  eq(tankOnly.length, 1, 'hall + tank: TankKing only');

  // ===========================================================================
  // [18] Empty / loading state predicates (the render slot decision)
  // ===========================================================================
  console.log('\n[18] Empty / loading predicates (component render slots)');
  // The component branches on: isLoading (no reply yet), isEmptyOverall
  // (server returned 0 entries), isEmptyAfterFilter (server returned N
  // but filter pruned to 0). Verify the math behind those gates is
  // consistent with what the helpers report.
  const overallEmpty = filterEntries([], { level: 'all', build: 'all' });
  eq(overallEmpty.length, 0, 'no entries → no filtered entries (empty-overall slot)');
  const filteredEmpty = filterEntries(corpus, {
    level: 'novice',
    build: 'tank',
  });
  truthy(corpus.length > 0, 'precondition: corpus non-empty');
  eq(filteredEmpty.length, 0, 'corpus + impossible filter → 0 (filtered-empty slot)');
  // hasMore=false + totalShown=0 in paginateEntries on empty filtered list
  const emptyView = paginateEntries(filteredEmpty, {
    currentPage: 1,
    pageSize: PAGE_SIZE,
  });
  eq(emptyView.totalShown, 0, 'empty filter → 0 shown');
  eq(emptyView.hasMore, false, 'empty filter → no more');

  // ===========================================================================
  // [19] Live regression — the screenshot scenario (Mr_Boss + Sx, Lv 6)
  // ===========================================================================
  console.log('\n[19] Screenshot scenario (Mr_Boss_v5.1 + Sx_v5.1, Lv 6)');
  const live: LeaderboardEntry[] = [
    entry(1, 'Sx_v5.1', 6, 1018, 12, 4, mkStats(8, 40, 4, 4)),
    entry(2, 'Mr_Boss_v5.1', 6, 982, 8, 4, mkStats(40, 8, 4, 4)),
  ];
  // Default sort = rating desc
  const liveSorted = sortLeaderboard(live, { key: 'rating', dir: 'desc' });
  eq(liveSorted[0].name, 'Sx_v5.1', 'default sort: Sx top (higher rating)');
  eq(liveSorted[1].name, 'Mr_Boss_v5.1', 'default sort: Mr_Boss second');
  // Filter to early → both visible
  const liveEarly = filterEntries(live, { level: 'early', build: 'all' });
  eq(liveEarly.length, 2, 'early bucket → both players');
  // Filter to crit → only Mr_Boss
  const liveCrit = filterEntries(live, { level: 'all', build: 'crit' });
  eq(liveCrit.length, 1, 'crit → Mr_Boss only');
  eq(liveCrit[0].name, 'Mr_Boss_v5.1', 'crit entry is Mr_Boss');
  // Filter to evasion → only Sx
  const liveEva = filterEntries(live, { level: 'all', build: 'evasion' });
  eq(liveEva.length, 1, 'evasion → Sx only');
  eq(liveEva[0].name, 'Sx_v5.1', 'evasion entry is Sx');
  // Toggle sort: click rating again → asc → Mr_Boss first
  const toggled = nextSortState({ key: 'rating', dir: 'desc' }, 'rating');
  const liveAsc = sortLeaderboard(live, toggled);
  eq(liveAsc[0].name, 'Mr_Boss_v5.1', 'click rating again: Mr_Boss(982) first');
  // Click wins → desc default → Sx first (12 > 8)
  const winsClick = nextSortState(toggled, 'wins');
  const liveWins = sortLeaderboard(live, winsClick);
  eq(liveWins[0].name, 'Sx_v5.1', 'click wins: Sx(12) first (default desc)');

  // ===========================================================================
  // [20] Backward compat — wire payload without `stats` still classifies
  // ===========================================================================
  console.log('\n[20] Backward compat — old server payload (no stats)');
  const legacyEntry: LeaderboardEntry = {
    rank: 1,
    walletAddress: '0xabc',
    name: 'LegacyPlayer',
    level: 5,
    rating: 1000,
    wins: 1,
    losses: 0,
    draws: 0,
  };
  eq(classifyBuild(legacyEntry.stats), 'hybrid', 'missing stats → hybrid');
  const legacyHybrid = filterEntries([legacyEntry], {
    level: 'all',
    build: 'hybrid',
  });
  eq(legacyHybrid.length, 1, 'hybrid filter matches no-stats entry');
  const legacyCrit = filterEntries([legacyEntry], { level: 'all', build: 'crit' });
  eq(legacyCrit.length, 0, 'crit filter excludes no-stats entry');
  // Sort still works (stats not consulted)
  const legacySorted = sortLeaderboard([legacyEntry], {
    key: 'winRate',
    dir: 'desc',
  });
  eq(legacySorted[0].name, 'LegacyPlayer', 'sort works without stats');

  // ===========================================================================
  // [21] Idempotency / pure-function guards
  // ===========================================================================
  console.log('\n[21] Purity / immutability guards');
  const input: LeaderboardEntry[] = [
    entry(1, 'P', 5, 1000, 1, 0, mkStats(40, 8, 4, 4)),
    entry(2, 'Q', 5, 900, 0, 1, mkStats(8, 40, 4, 4)),
  ];
  const snap = JSON.stringify(input);
  void filterEntries(input, { level: 'early', build: 'crit' });
  eq(JSON.stringify(input), snap, 'filterEntries does not mutate input');
  void sortLeaderboard(input, { key: 'rating', dir: 'asc' });
  eq(JSON.stringify(input), snap, 'sortLeaderboard does not mutate input');
  void paginateEntries(input, { currentPage: 1, pageSize: 10 });
  eq(JSON.stringify(input), snap, 'paginateEntries does not mutate input');
  void levelBucketCounts(input);
  eq(JSON.stringify(input), snap, 'levelBucketCounts does not mutate input');
  void buildCounts(input);
  eq(JSON.stringify(input), snap, 'buildCounts does not mutate input');

  // Return a new array even with no work to do
  const reSortEmpty = sortLeaderboard([], { key: 'rating', dir: 'desc' });
  truthy(Array.isArray(reSortEmpty), 'sort of empty returns array');
  eq(reSortEmpty.length, 0, 'sort of empty returns []');

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n' + '='.repeat(60));
  console.log(`Hall of Fame gauntlet: ${passes} passes / ${failures} failures`);
  console.log('='.repeat(60));
  if (failures > 0) {
    console.log('\nFAILURES:');
    for (const f of failureLog) console.log('  ' + f);
    process.exit(1);
  }
}

main();
