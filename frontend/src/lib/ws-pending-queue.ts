/**
 * Pure pending-message queue for the WebSocket reconnect window.
 *
 * Bug 2026-05-04 — `useGameSocket.send()` previously called
 * `socketRef.current.send(...)` whenever `readyState === OPEN`, but
 * during the brief CONNECTING / CLOSING window after a transport blip
 * the polling effects in `GameProvider` (`get_inventory`,
 * `get_character`, `get_wager_lobby`, `get_online_players`) all fired
 * and printed `[WS] DROPPED outbound … — readyState=0` errors. The
 * fight resolved correctly because server-side combat doesn't depend
 * on those polls, but the noise was unprofessional and masked real
 * bugs in dev-tools.
 *
 * Fix 2 (Bucket 2 close-out, 2026-05-04) — `useGameSocket.send()` now
 * queues the message when the socket isn't OPEN; the `onopen` handler
 * drains the queue. Stale messages (older than `staleThresholdMs`) are
 * discarded — they're typically polling fetches that the mount-time
 * effects will re-issue anyway.
 *
 * Pure: no React, no global state, no socket reference. The hook
 * supplies the live socket via the `send` callback so this module can
 * be tested with a mock.
 */

export interface PendingMessage<T = unknown> {
  /** The encoded payload (already JSON.stringified). */
  payload: string;
  /** Wall-clock when `send` was originally called. */
  enqueuedAt: number;
  /** The original message type — kept for debug logging only; the
   *  server doesn't see this field. */
  type: string;
  /** Original raw message (for tests / logging). Type-loosened so the
   *  hook can pass any ClientMessage variant. */
  raw?: T;
}

export interface DrainResult {
  /** Number of messages successfully sent on drain. */
  sent: number;
  /** Number of messages discarded because they were older than the
   *  staleness threshold. */
  discarded: number;
}

/**
 * Drain the queue in FIFO order. For each entry:
 *   - if `now - enqueuedAt > staleThresholdMs`, skip (stale)
 *   - else call `send(payload)`; bail the rest of the drain if `send`
 *     returns false (the socket transitioned non-OPEN again).
 *
 * The input array is mutated in place — entries that were sent or
 * discarded are removed. Entries that couldn't be sent (because send
 * returned false mid-drain) remain at the front of the queue for a
 * subsequent retry.
 */
export function drainPendingMessages(
  queue: PendingMessage[],
  send: (payload: string) => boolean,
  now: number,
  staleThresholdMs: number,
): DrainResult {
  let sent = 0;
  let discarded = 0;

  while (queue.length > 0) {
    const head = queue[0];
    const age = now - head.enqueuedAt;

    if (age > staleThresholdMs) {
      queue.shift();
      discarded++;
      continue;
    }

    const ok = send(head.payload);
    if (!ok) {
      // Socket transitioned non-OPEN mid-drain. Leave the head in
      // place for a future drain attempt; bail.
      break;
    }

    queue.shift();
    sent++;
  }

  return { sent, discarded };
}

/**
 * Trim the queue if it grows beyond `maxLength` — drops the oldest
 * entries first. Defends against a runaway producer (e.g. a polling
 * effect with a bad dependency array firing every render). Returns
 * the number of entries dropped.
 */
export function capPendingQueue(
  queue: PendingMessage[],
  maxLength: number,
): number {
  if (queue.length <= maxLength) return 0;
  const dropCount = queue.length - maxLength;
  queue.splice(0, dropCount);
  return dropCount;
}
