/**
 * Reliable wager registration with the game server.
 *
 * Pre-fix flow:
 *   1. Sign create_wager → on-chain WagerMatch is created (real SUI locked)
 *   2. socket.send({type: 'queue_fight', wagerMatchId, ...}) — fire and forget
 *   3. Frontend assumes success because socket.readyState === OPEN at send time
 *
 * Failure mode (live test 2026-05-02, orphan 0xbdd3c596…):
 *   WebSockets have no application-level ACK in this codebase. `socket.send`
 *   returns true the moment the message is handed to the WS library, NOT
 *   when the server actually receives it. A TCP-level death between check
 *   and write (Mysten testnet drops, network blip, half-closed socket) lets
 *   the bytes be silently discarded by the OS. The on-chain wager exists,
 *   the lobby entry doesn't — orphan.
 *
 * Fix: after the WS send, await an ACK message (`wager_lobby_added` carrying
 * our wagerMatchId) with a configurable timeout. If the ACK doesn't arrive
 * we fall back to POST /api/admin/adopt-wager — a REST endpoint that has
 * TCP-level error reporting (no silent loss). The server reads chain truth,
 * inserts the lobby entry, and broadcasts the same wager_lobby_added.
 *
 * Pure function — `qa-wager-register.ts` drives every branch with mocked
 * deps + a manual scheduler.
 */

import type { ServerMessage } from "@/types/ws-messages";

export type WagerRegisterResult =
  /** Server emitted wager_lobby_added within the timeout — the WS path
   *  worked end-to-end. */
  | { kind: "ack" }
  /** WS path failed (lost or rejected); REST adopt-wager succeeded.
   *  The server will broadcast wager_lobby_added as a side effect of the
   *  adopt — caller doesn't need to await it again. */
  | { kind: "recovered"; via: "adopt-wager" }
  /** Both paths failed. Caller surfaces a sticky error with manual
   *  recovery instructions (the wager IS on chain — `reason` carries the
   *  failure detail for the toast). */
  | { kind: "failed"; reason: string };

export interface WagerRegisterDeps {
  /** Send the queue_fight WS message. Returns true if the WS layer
   *  accepted the bytes; we still wait for the ACK either way because
   *  "true" is not proof of delivery. */
  sendQueueFight: () => boolean;
  /** Subscribe to all incoming server messages. Returns an unsubscribe fn. */
  onMessage: (handler: (msg: ServerMessage) => void) => () => void;
  /** REST fallback. POSTs /api/admin/adopt-wager. */
  adoptWager: (wagerMatchId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Test seam — defaults to globalThis.setTimeout / clearTimeout. */
  setTimeoutFn?: (cb: () => void, ms: number) => unknown;
  clearTimeoutFn?: (handle: unknown) => void;
}

const DEFAULT_ACK_TIMEOUT_MS = 7_000;

export async function registerWagerWithServer(
  wagerMatchId: string,
  deps: WagerRegisterDeps,
  timeoutMs: number = DEFAULT_ACK_TIMEOUT_MS,
): Promise<WagerRegisterResult> {
  const setTimeoutFn =
    deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimeoutFn =
    deps.clearTimeoutFn ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  // Race: wager_lobby_added arrives, OR the timeout fires.
  const ackPromise = new Promise<WagerRegisterResult | "timeout">((resolve) => {
    let timer: unknown = setTimeoutFn(() => {
      timer = null;
      unsubscribe();
      resolve("timeout");
    }, timeoutMs);

    const unsubscribe = deps.onMessage((msg) => {
      if (msg.type !== "wager_lobby_added") return;
      // Server broadcasts to all clients; only the entry that matches our
      // wagerMatchId is the ACK we're waiting on. (Other players creating
      // wagers in the same window would also broadcast; we ignore those.)
      const entryId = (msg as { entry?: { wagerMatchId?: string } }).entry?.wagerMatchId;
      if (entryId !== wagerMatchId) return;

      if (timer != null) {
        clearTimeoutFn(timer);
        timer = null;
      }
      unsubscribe();
      resolve({ kind: "ack" });
    });
  });

  // Fire the WS send. If it returns false (socket closed at check time),
  // the ACK will never arrive — we'll fall through to the REST recovery
  // path when the timeout fires. We don't short-circuit on `false` because
  // adopt-wager works even when the WS is down (different connection,
  // different transport).
  deps.sendQueueFight();

  const ackResult = await ackPromise;
  if (ackResult !== "timeout") return ackResult;

  // ACK timed out. Fall back to REST recovery.
  try {
    const adoptResult = await deps.adoptWager(wagerMatchId);
    if (adoptResult.ok) {
      return { kind: "recovered", via: "adopt-wager" };
    }
    return {
      kind: "failed",
      reason:
        adoptResult.error ||
        "adopt-wager rejected the request (chain status not WAITING, or already in lobby)",
    };
  } catch (err: unknown) {
    return {
      kind: "failed",
      reason:
        (err as Error)?.message ||
        "adopt-wager request failed (server unreachable?)",
    };
  }
}

/** Compute the HTTP base URL that pairs with NEXT_PUBLIC_WS_URL. The two
 *  always live on the same host/port — just different schemes. Exported
 *  so the matchmaking-queue caller can build adopt-wager URLs without
 *  re-encoding the convention. */
export function deriveHttpBaseUrl(wsUrl: string): string {
  // ws://host:port → http://host:port ; wss:// → https://
  if (wsUrl.startsWith("wss://")) return "https://" + wsUrl.slice("wss://".length);
  if (wsUrl.startsWith("ws://")) return "http://" + wsUrl.slice("ws://".length);
  // Bare host (no scheme) — assume http for testnet dev. Mainnet sets wss
  // so this branch is testnet-only.
  return "http://" + wsUrl;
}
