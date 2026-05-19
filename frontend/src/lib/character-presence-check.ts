/**
 * Pre-sign server-character presence check.
 *
 * Bug 6 (2026-05-19) defence-in-depth. The primary fix is the auth_ok
 * self-heal in `game-provider.tsx` — it covers the common case where
 * the server restarts and the client receives `auth_ok` with
 * `hasCharacter: false`. This module guards the *secondary* race: the
 * server restarts while the user is mid-form (the wager UI is already
 * open) and they click Create/Accept before the next WS reconnect
 * triggers the auth_ok handler.
 *
 * The check is a tiny round-trip — `get_character` → `character_data`
 * (success) OR `error` (failure). On failure the caller dispatches
 * `BEGIN_SERVER_REHYDRATE`, which puts the user in the loader and lets
 * the chain-check effect re-restore. The user's pending click is
 * cancelled rather than orphaned-on-chain.
 *
 * Timeout: 3 seconds. Longer than typical RTT (<200ms) but shorter
 * than a wallet popup interaction, so we don't add a perceptible
 * delay before the popup opens.
 *
 * The helper is pure (no React imports). Pinned by
 * `qa-create-wager-orphan-guard.ts`.
 */

import type { useGameSocket } from "@/hooks/useGameSocket";
import type { ServerMessage } from "@/types/ws-messages";

type Socket = ReturnType<typeof useGameSocket>;

const DEFAULT_TIMEOUT_MS = 3_000;

export type PresenceCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Round-trips a `get_character` request and resolves once the server
 * answers — either with `character_data` (ok) or with an `error`
 * payload (treated as "server lost the record"). A timeout resolves to
 * { ok: false, reason: 'timeout' }.
 *
 * Caller pattern (from handleAcceptWager / handleQueue):
 *
 *   const presence = await verifyServerHasCharacter({ socket });
 *   if (!presence.ok) {
 *     dispatch({ type: 'BEGIN_SERVER_REHYDRATE' });
 *     dispatch({ type: 'SET_ERROR', message:
 *       'Reconnecting your character — try again in a moment.' });
 *     return;
 *   }
 *   // ...proceed to sign.
 *
 * Idempotent: emitting BEGIN_SERVER_REHYDRATE when the server already
 * knows us is harmless (the chain-check no-ops out via its in-flight
 * guard + the SET_CHARACTER overwrite from the server's response).
 */
export async function verifyServerHasCharacter(args: {
  socket: Socket;
  timeoutMs?: number;
}): Promise<PresenceCheckResult> {
  const { socket } = args;
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!socket.connected || !socket.authenticated) {
    return {
      ok: false,
      reason: "Server connection is still coming up — try again in a moment.",
    };
  }

  return new Promise<PresenceCheckResult>((resolve) => {
    let settled = false;
    const finish = (result: PresenceCheckResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const detach = socket.addHandler((msg: ServerMessage) => {
      // character_data — server has the record, we're good.
      if (msg.type === "character_data") {
        finish({ ok: true });
        return;
      }
      // Any error in the response window is treated as "no character
      // server-side". The error copy varies (`Character not found`,
      // `Not authenticated. Send auth_request first.`, …) but the
      // remedy is the same: trigger BEGIN_SERVER_REHYDRATE upstream.
      if (msg.type === "error") {
        finish({
          ok: false,
          reason: (msg as { type: "error"; message?: unknown }).message
            ? String((msg as { message?: unknown }).message)
            : "Server reported no active character.",
        });
      }
    });

    const timer = setTimeout(() => {
      finish({
        ok: false,
        reason:
          "Server didn't respond in time — try again or refresh the page.",
      });
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      detach();
    }

    socket.send({ type: "get_character" } as never);
  });
}
