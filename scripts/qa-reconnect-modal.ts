/**
 * Reconnect-outcome-replay gauntlet (Bug 3, 2026-05-03).
 *
 *   $ cd server && npx tsx ../scripts/qa-reconnect-modal.ts
 *
 * Repro: Player A's tab closed mid-fight, the 60 s reconnect grace
 * timer expired, the server forfeited the fight. `finishFight`
 * called `sendToWallet` for both wallets, but A's socket was already
 * dead — the message vanished into the OS buffer. A reopened the
 * tab; the character page rendered silently. The only way A learned
 * about the loss was scrolling Fight History.
 *
 * Fix:
 *   - Server caches per-wallet `RecentOutcome` at settle time
 *     (`server/src/data/recent-outcomes.ts`).
 *   - On the next `auth_ok` for that wallet, the server emits
 *     `recent_fight_settled` carrying the `fight` + per-wallet `loot`.
 *   - Frontend dedupes via localStorage ack
 *     (`frontend/src/lib/fight-outcome-ack.ts::shouldReplayOutcome`)
 *     so the modal pops once and stays gone.
 *
 * This gauntlet pins both halves: the server's record/get/clear
 * semantics and the frontend's pure dedupe decision. Pure JS, no
 * sockets.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  recordRecentOutcome,
  getRecentOutcome,
  clearRecentOutcome,
  resetRecentOutcomesForTesting,
  recentOutcomeCountForTesting,
  type RecentOutcome,
  type RecentOutcomeFight,
  type RecentOutcomeLoot,
} from '../server/src/data/recent-outcomes';
import { shouldReplayOutcome } from '../frontend/src/lib/fight-outcome-ack';

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

function mkFight(id: string, winner: string | null = null): RecentOutcomeFight {
  return {
    id,
    type: 'wager',
    status: 'finished',
    winner,
    turn: 1,
  };
}

function mkOutcome(fightId: string, xp: number, rating: number): RecentOutcome {
  const loot: RecentOutcomeLoot = { xpGained: xp, ratingChange: rating };
  return {
    fightId,
    fight: mkFight(fightId),
    loot,
    settledAt: Date.now(),
  };
}

function main(): void {
  // ===========================================================================
  // 1 — record + get round-trip
  // ===========================================================================
  console.log('\n[1] Server cache — record + get round-trip');
  resetRecentOutcomesForTesting();
  const w1 = '0xaaa';
  const o1 = mkOutcome('fight-1', 50, 12);
  recordRecentOutcome(w1, o1);
  const got = getRecentOutcome(w1);
  if (!got) fail('round-trip', 'getRecentOutcome returned undefined');
  else {
    ok('record + get returns an entry');
    eq(got.fightId, 'fight-1', 'fightId preserved');
    eq(got.loot.xpGained, 50, 'loot.xpGained preserved');
    eq(got.loot.ratingChange, 12, 'loot.ratingChange preserved');
  }

  // ===========================================================================
  // 2 — multi-wallet isolation (winner + loser get distinct loot)
  // ===========================================================================
  console.log('\n[2] Multi-wallet isolation');
  resetRecentOutcomesForTesting();
  const winnerW = '0xwin';
  const loserW = '0xlose';
  recordRecentOutcome(winnerW, mkOutcome('match-7', 80, 18));
  recordRecentOutcome(loserW, mkOutcome('match-7', 20, -18));
  const wOut = getRecentOutcome(winnerW);
  const lOut = getRecentOutcome(loserW);
  eq(wOut?.loot.xpGained, 80, 'winner sees winner loot');
  eq(lOut?.loot.xpGained, 20, 'loser sees loser loot');
  eq(wOut?.loot.ratingChange, 18, 'winner rating +18');
  eq(lOut?.loot.ratingChange, -18, 'loser rating -18');
  eq(wOut?.fightId, lOut?.fightId, 'both wallets agree on the fight id');

  // ===========================================================================
  // 3 — unknown wallet returns undefined (no cross-talk)
  // ===========================================================================
  console.log('\n[3] Unknown wallet → undefined');
  eq(getRecentOutcome('0xneverseen'), undefined, 'never-seen wallet returns undefined');
  eq(getRecentOutcome(''), undefined, 'empty-string wallet returns undefined');

  // ===========================================================================
  // 4 — overwrite semantics (a wallet's NEXT fight replaces the old entry)
  // ===========================================================================
  console.log('\n[4] Overwriting same wallet keeps only the latest');
  resetRecentOutcomesForTesting();
  const w = '0xpopular';
  recordRecentOutcome(w, mkOutcome('first', 10, 5));
  recordRecentOutcome(w, mkOutcome('second', 20, 8));
  const after = getRecentOutcome(w);
  eq(after?.fightId, 'second', 'second record wins');
  eq(after?.loot.xpGained, 20, 'second loot xp');
  eq(recentOutcomeCountForTesting(), 1, 'still only one entry for this wallet');

  // ===========================================================================
  // 5 — clearRecentOutcome removes the entry
  // ===========================================================================
  console.log('\n[5] clearRecentOutcome');
  resetRecentOutcomesForTesting();
  recordRecentOutcome('0xx', mkOutcome('clearable', 5, 5));
  eq(getRecentOutcome('0xx')?.fightId, 'clearable', 'recorded');
  clearRecentOutcome('0xx');
  eq(getRecentOutcome('0xx'), undefined, 'cleared');
  eq(recentOutcomeCountForTesting(), 0, 'count back to 0');
  // Clearing a wallet that doesn't exist is a no-op (defensive)
  clearRecentOutcome('0xnever');
  eq(recentOutcomeCountForTesting(), 0, 'clear of unknown wallet is a no-op');

  // ===========================================================================
  // 6 — resetRecentOutcomesForTesting wipes everything
  // ===========================================================================
  console.log('\n[6] resetRecentOutcomesForTesting');
  recordRecentOutcome('0xa', mkOutcome('a', 1, 1));
  recordRecentOutcome('0xb', mkOutcome('b', 2, 2));
  recordRecentOutcome('0xc', mkOutcome('c', 3, 3));
  eq(recentOutcomeCountForTesting(), 3, '3 entries before reset');
  resetRecentOutcomesForTesting();
  eq(recentOutcomeCountForTesting(), 0, 'all wiped');

  // ===========================================================================
  // 7 — empty wallet doesn't get a record (defensive against bad inputs)
  // ===========================================================================
  console.log('\n[7] Defensive: empty wallet is rejected silently');
  resetRecentOutcomesForTesting();
  recordRecentOutcome('', mkOutcome('rejected', 1, 1));
  eq(recentOutcomeCountForTesting(), 0, 'empty wallet does not record');

  // ===========================================================================
  // 8 — ⚡ pure dedupe decision (the actual replay gate)
  // ===========================================================================
  console.log('\n[8] ⚡ shouldReplayOutcome — the actual dedupe');
  // A fresh wallet has never acked anything → server reports a fight → replay.
  eq(shouldReplayOutcome('fight-99', null), true,
     'no ack at all → REPLAY (the user hasn\'t seen this one)');
  // After the user dismissed the modal, ack === recentFightId → skip.
  eq(shouldReplayOutcome('fight-99', 'fight-99'), false,
     'ack matches → SKIP (user already saw it)');
  // The user dismissed an OLDER fight; a newer one settled offline → replay.
  eq(shouldReplayOutcome('fight-100', 'fight-99'), true,
     'newer fight than last ack → REPLAY');
  // Server reports nothing recent → never replay (no payload to show).
  eq(shouldReplayOutcome(null, 'anything'), false, 'null recent → SKIP');
  eq(shouldReplayOutcome(undefined, null), false, 'undefined recent → SKIP');
  eq(shouldReplayOutcome('', 'anything'), false, 'empty-string recent → SKIP');

  // ===========================================================================
  // 9 — full live-bug repro: forfeit during disconnect, then reconnect
  // ===========================================================================
  console.log('\n[9] ⚡ Full live-bug repro');
  resetRecentOutcomesForTesting();
  // (a) Player A is in a wager fight, disconnects, grace timer expires,
  //     finishFight runs, server records the outcome.
  const playerA = '0xa';
  const playerB = '0xb';
  recordRecentOutcome(playerA, mkOutcome('forfeit-fight', 5, -25)); // A lost
  recordRecentOutcome(playerB, mkOutcome('forfeit-fight', 50, 25)); // B won

  // (b) Player A reopens the tab. They have no localStorage ack yet
  //     (this is a fresh session). Server sends recent_fight_settled.
  const aRecent = getRecentOutcome(playerA);
  if (!aRecent) {
    fail('repro: A has a recent outcome', 'getRecentOutcome returned undefined');
  } else {
    ok('A has a recent outcome cached');
    eq(shouldReplayOutcome(aRecent.fightId, null), true,
       'fresh ack=null → REPLAY (modal pops)');
  }

  // (c) A dismisses the modal — frontend writes ack=fightId. A reconnects
  //     again later (refresh, network blip). Server still has the outcome.
  const aRecent2 = getRecentOutcome(playerA);
  eq(shouldReplayOutcome(aRecent2!.fightId, 'forfeit-fight'), false,
     'after-ack reconnect → SKIP (no double-pop)');

  // (d) A new fight settles for A. The cached outcome is overwritten with
  //     the new fight id. Even though A had previously acked the OLD id,
  //     the new id != old ack → modal pops for the new fight.
  recordRecentOutcome(playerA, mkOutcome('new-fight', 60, 15));
  const aFresh = getRecentOutcome(playerA);
  eq(shouldReplayOutcome(aFresh!.fightId, 'forfeit-fight'), true,
     'NEW fight id while ack still points at OLD → REPLAY');

  // ===========================================================================
  // Summary
  // ===========================================================================
  resetRecentOutcomesForTesting();
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`reconnect-modal gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
