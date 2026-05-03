/**
 * Per-wallet "most recent settled fight" cache.
 *
 * Why this exists: when Player A's socket dies mid-fight and the
 * 60 s reconnect grace expires, `finishFight` fires `sendToWallet`
 * for both wallets — but A's socket is gone, so the message vanishes
 * into the OS buffer. A reopens the tab some time later, lands on
 * the character page, and learns about losing the wager only by
 * scrolling Fight History (live test 2026-05-03, Bug 3). Same
 * happens to a player who closes the tab right before settlement.
 *
 * Fix: record the outcome for both wallets at `finishFight` time;
 * replay it via a `recent_fight_settled` WS message after `auth_ok`
 * on the next session. Frontend uses localStorage to dedupe — once
 * the player has explicitly closed the modal, the ack is recorded
 * and subsequent reconnects skip the replay.
 *
 * In-memory only. Cleared on server restart — acceptable for testnet
 * polish; mainnet can promote to Supabase if persistence matters.
 */
import type { FightState, LootBoxResult } from '../types';

export interface RecentOutcome {
  /** `fight.id` — used by the frontend dedupe to decide replay. */
  fightId: string;
  /** Snapshot of `FightState` at settlement (status='finished'). */
  fight: FightState;
  /** Per-wallet loot: each wallet records its own xp / rating delta. */
  loot: LootBoxResult;
  /** ms since epoch — surfaced for diagnostics, not yet acted on (a
   *  future TTL eviction could use this). */
  settledAt: number;
}

const recentOutcomes = new Map<string, RecentOutcome>();

export function recordRecentOutcome(walletAddress: string, outcome: RecentOutcome): void {
  if (!walletAddress) return;
  recentOutcomes.set(walletAddress, outcome);
}

export function getRecentOutcome(walletAddress: string): RecentOutcome | undefined {
  if (!walletAddress) return undefined;
  return recentOutcomes.get(walletAddress);
}

/** Removed an entry — currently called by tests; the live runtime
 *  keeps entries until restart since the dedupe lives client-side. */
export function clearRecentOutcome(walletAddress: string): void {
  recentOutcomes.delete(walletAddress);
}

/** Test-only: wipe the entire cache so each gauntlet section starts clean. */
export function resetRecentOutcomesForTesting(): void {
  recentOutcomes.clear();
}

/** Test-only: how many wallets currently have a recorded outcome. */
export function recentOutcomeCountForTesting(): number {
  return recentOutcomes.size;
}
