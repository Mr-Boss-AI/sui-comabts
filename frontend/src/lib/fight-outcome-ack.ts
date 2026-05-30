/**
 * Per-wallet "I have seen the outcome modal" acknowledgment.
 *
 * Why this exists: the server now replays the most recent settled
 * fight on every auth handshake (`recent_fight_settled`), so a
 * player who got disconnected mid-fight (forfeit, closed tab) lands
 * back in their session and sees Victory/Defeat the first time they
 * connect after settlement (Bug 3, live test 2026-05-03). But the
 * server keeps the outcome cached — the next reconnect would replay
 * the same modal indefinitely. The client decides "I've seen this
 * one" by writing the fight id to localStorage when the modal
 * closes; subsequent `recent_fight_settled` payloads with the same
 * id are skipped.
 *
 * Storage is keyed by wallet so two-account testing on the same
 * browser doesn't cross-contaminate. The pure decision function
 * (`shouldReplayOutcome`) is what the qa gauntlet pins —
 * localStorage I/O is just the SSR-safe wrapper around it.
 */

const KEY_PREFIX = "sui-combats-ack-fight-";

function makeKey(wallet: string): string {
  return `${KEY_PREFIX}${wallet.toLowerCase()}`;
}

export function getAcknowledgedFightId(wallet: string): string | null {
  if (typeof window === "undefined") return null;
  if (!wallet) return null;
  try {
    return window.localStorage.getItem(makeKey(wallet));
  } catch {
    // localStorage can throw in private mode / quota cases; treat as
    // "no ack" — worst case the user sees the modal once more.
    return null;
  }
}

export function setAcknowledgedFightId(wallet: string, fightId: string): void {
  if (typeof window === "undefined") return;
  if (!wallet || !fightId) return;
  try {
    window.localStorage.setItem(makeKey(wallet), fightId);
  } catch {
    // Quota errors are fine to swallow — the only consequence is the
    // modal might re-show after a reconnect.
  }
}

/**
 * Pure decision: should we replay the Victory/Defeat modal for this
 * `recentFightId`?
 *
 *  - `null` / empty / undefined `recentFightId` → never replay (server
 *     didn't report any unseen fight).
 *  - matching `lastAck` → user already dismissed this exact outcome,
 *     skip.
 *  - differing `lastAck` (or no ack) → replay.
 */
export function shouldReplayOutcome(
  recentFightId: string | null | undefined,
  lastAck: string | null,
): boolean {
  if (!recentFightId) return false;
  return recentFightId !== lastAck;
}
