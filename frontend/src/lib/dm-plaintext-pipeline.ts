/**
 * Plaintext DM transport pipeline. Mirror of `dm-send-pipeline.ts`
 * (the encrypted Sui Stack Messaging path) but for plain WebSocket +
 * Supabase persistence — the transport we ship by default while the
 * encrypted SDK remains in alpha.
 *
 * Bug 1's failure mode (alpha SDK hangs before the wallet popup,
 * UI sticks on "Signing…") doesn't apply here: the round-trip is
 * a single WS request + echo, no chain interaction, no Walrus
 * upload, no Seal session-key warmup. Latency floor is the WS
 * RTT — single-digit milliseconds on testnet.
 *
 * The pipeline is still extracted (vs. inlined in `DmPanel`) for the
 * same reason the encrypted version is: the panel's React state
 * lifecycle is hard to test without RTL, but the pure async
 * orchestration is trivial to gauntlet with mocked WS deps.
 *
 * Usage from the panel:
 *   const result = await runPlaintextDmSend(deps, { peer, body });
 *
 * Deps abstract the WS surface so a test can swap in a fake socket
 * that resolves / rejects / hangs at will.
 */

import { SDK_TIMEOUT_MS } from "./messaging";
import type { DmMessageWire } from "@/types/ws-messages";

/** Independent timeout for the WS round-trip. The server-side
 *  insert + fan-out is fast (Supabase round-trip + WS send),
 *  but a hung server or dropped socket should surface within a
 *  few seconds, not hang the panel. Re-uses the existing
 *  `withTimeout` helper from the encrypted path so the failure
 *  shape is identical. */
const PLAINTEXT_SEND_TIMEOUT_MS = 8_000;
const PLAINTEXT_HISTORY_TIMEOUT_MS = 8_000;

export interface PlaintextDmDeps {
  /** Send a JSON-shaped message over the WS. Async-fire-and-forget;
   *  the response is consumed via `subscribe`. */
  wsSend: (msg: Record<string, unknown>) => void;
  /** Subscribe to incoming WS messages for the duration of the
   *  request. Returns an unsubscribe function. The pipeline calls
   *  it on resolve/reject so the listener doesn't leak across
   *  sends. */
  subscribe: (
    handler: (msg: Record<string, unknown>) => void,
  ) => () => void;
  /** Optional progress sink — drives the panel's console
   *  breadcrumbs ([dm-plaintext] sendStart, sendDone, etc.). */
  onStep?: (step: PlaintextDmStep) => void;
  /** Override per-call timeout (used by tests). */
  timeoutMs?: number;
}

export type PlaintextDmStep =
  | "send:start"
  | "send:done"
  | "send:error"
  | "history:start"
  | "history:done"
  | "history:error";

export interface PlaintextDmSendParams {
  peerWallet: string;
  body: string;
  /** Caller-supplied client id — the server echoes it back on
   *  `dm_message_sent` so the panel matches the confirmed message
   *  to its optimistic bubble. Caller can pre-generate one and
   *  attach it to the optimistic bubble's id. */
  clientId: string;
}

export interface PlaintextDmHistoryParams {
  peerWallet: string;
  limit?: number;
  beforeId?: string;
}

export interface PlaintextDmHistoryResult {
  channelId: string | null;
  messages: DmMessageWire[];
  hasMore: boolean;
}

/**
 * Send one plaintext DM. Resolves with the server-confirmed message
 * (real id, server timestamp) when the echo arrives. Rejects on
 * server error, wsSend throw, or timeout. The subscriber is ALWAYS
 * cleaned up regardless of how the promise settles — including the
 * timeout path. Earlier wrappings used the generic `withTimeout`
 * helper that didn't have access to the inner cleanup function;
 * the pipeline owns the timeout itself so cleanup is always called.
 */
export function runPlaintextDmSend(
  deps: PlaintextDmDeps,
  params: PlaintextDmSendParams,
): Promise<DmMessageWire> {
  const budget = deps.timeoutMs ?? PLAINTEXT_SEND_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = deps.subscribe((msg) => {
      if (settled) return;
      const t = (msg as { type?: string }).type;
      if (
        t === "dm_message_sent" &&
        (msg as { clientId?: string }).clientId === params.clientId &&
        (msg as { message?: unknown }).message
      ) {
        finish(() => {
          deps.onStep?.("send:done");
          resolve((msg as { message: DmMessageWire }).message);
        });
        return;
      }
      // Server can reject the send with an `error` payload. The
      // server doesn't currently echo a clientId on the error
      // path; we accept any error after our send as ours, since
      // multiple in-flight sends per panel is rare in practice.
      if (t === "error" && typeof (msg as { message?: unknown }).message === "string") {
        finish(() => {
          deps.onStep?.("send:error");
          reject(
            new Error(
              `DM send rejected: ${(msg as { message: string }).message}`,
            ),
          );
        });
      }
    });
    function finish(cb: () => void) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanup();
      cb();
    }
    timer = setTimeout(() => {
      finish(() => {
        deps.onStep?.("send:error");
        reject(
          new Error(
            `runPlaintextDmSend timed out after ${Math.round(budget / 1000)}s — server did not respond`,
          ),
        );
      });
    }, budget);
    deps.onStep?.("send:start");
    try {
      deps.wsSend({
        type: "dm_send",
        clientId: params.clientId,
        peerWallet: params.peerWallet,
        body: params.body,
      });
    } catch (err: unknown) {
      finish(() => {
        deps.onStep?.("send:error");
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }
  });
}

/**
 * Fetch a chronological page of history. Resolves with the server's
 * `dm_history` payload (channelId may be null if no channel exists
 * yet — drives the panel's empty state). Same cleanup-on-every-path
 * pattern as runPlaintextDmSend.
 */
export function runPlaintextDmHistory(
  deps: PlaintextDmDeps,
  params: PlaintextDmHistoryParams,
): Promise<PlaintextDmHistoryResult> {
  const budget = deps.timeoutMs ?? PLAINTEXT_HISTORY_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const peerLower = params.peerWallet.toLowerCase();
    const cleanup = deps.subscribe((msg) => {
      if (settled) return;
      const t = (msg as { type?: string }).type;
      if (
        t === "dm_history" &&
        typeof (msg as { peerWallet?: unknown }).peerWallet === "string" &&
        (msg as { peerWallet: string }).peerWallet.toLowerCase() === peerLower
      ) {
        finish(() => {
          deps.onStep?.("history:done");
          resolve({
            channelId:
              ((msg as { channelId?: string | null }).channelId as
                | string
                | null) ?? null,
            messages:
              ((msg as { messages?: DmMessageWire[] }).messages as
                | DmMessageWire[]
                | undefined) ?? [],
            hasMore: !!(msg as { hasMore?: unknown }).hasMore,
          });
        });
        return;
      }
      if (t === "error" && typeof (msg as { message?: unknown }).message === "string") {
        finish(() => {
          deps.onStep?.("history:error");
          reject(
            new Error(
              `dm_history rejected: ${(msg as { message: string }).message}`,
            ),
          );
        });
      }
    });
    function finish(cb: () => void) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanup();
      cb();
    }
    timer = setTimeout(() => {
      finish(() => {
        deps.onStep?.("history:error");
        reject(
          new Error(
            `runPlaintextDmHistory timed out after ${Math.round(budget / 1000)}s — server did not respond`,
          ),
        );
      });
    }, budget);
    deps.onStep?.("history:start");
    try {
      deps.wsSend({
        type: "dm_history",
        peerWallet: params.peerWallet,
        limit: params.limit,
        beforeId: params.beforeId,
      });
    } catch (err: unknown) {
      finish(() => {
        deps.onStep?.("history:error");
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    }
  });
}

/** Per-step budget — exported for tests + the panel's diagnostic banner. */
export const PLAINTEXT_DM_BUDGETS = {
  send: PLAINTEXT_SEND_TIMEOUT_MS,
  history: PLAINTEXT_HISTORY_TIMEOUT_MS,
  // Re-export the master/createChannel budgets so the panel can
  // reuse one unified budget panel regardless of transport.
  master: SDK_TIMEOUT_MS.sendMessage,
} as const;
