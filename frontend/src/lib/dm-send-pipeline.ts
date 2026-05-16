/**
 * Pure DM-send pipeline. Extracted from `dm-panel.tsx::handleSend` so the
 * orchestration is testable end-to-end with a mocked SDK — covering the
 * gap that lets a "create_channel landed but the JS promise hung" bug
 * (Bug 1, 2026-05-06) slip past the wrapper-only unit tests.
 *
 * The handleSend closure is a React component method that touches:
 *   • SDK calls (ensureChannel / resolveMemberCap / sendMessage)
 *   • WebSocket sends (register_dm_channel / notify_dm_sent)
 *   • React state (optimistic bubble, error toast, sending flag)
 *
 * Splitting the concerns:
 *   • This file owns the SDK + WS orchestration. Pure async; deps are
 *     injected so a test can swap in a hanging mock SDK and observe
 *     the failure shape directly.
 *   • The component owns React state, which is intrinsically tied to
 *     hooks and can't be tested without RTL.
 *
 * Every step in the pipeline is wrapped in a per-call timeout (the
 * `withTimeout` budgets in `lib/messaging.ts::SDK_TIMEOUT_MS`). The
 * pipeline ALSO accepts a `masterTimeoutMs` (default 90 s) that races
 * the entire flow — belt-and-braces against the case where a future
 * SDK call site is added without a per-call wrapper.
 *
 * Progress hooks (`onStep`) emit a label at each await so a developer
 * watching the browser console can see exactly which step is in flight
 * — the tool that would have pinpointed Bug 1's hang on the first
 * retest if it had existed.
 */

import { withTimeout, SDK_TIMEOUT_MS } from "./messaging";

export interface DmSendDeps {
  /** Bundle from `ensureClient(signer, address)`. Opaque to this file
   *  — pass-through to ensureChannel / resolveMemberCap / sendMessage. */
  bundle: unknown;
  /** Wraps `executeCreateChannelTransaction` + caller cap resolve. */
  ensureChannel: (
    bundle: unknown,
    peer: string,
    existingChannelId?: string,
  ) => Promise<{
    channelId: string;
    callerMemberCapId?: string;
    encryptedKeyB64?: string;
    fresh: boolean;
  }>;
  /** Resolves the caller's member cap from chain (post-create retry). */
  resolveMemberCap: (
    bundle: unknown,
    channelId: string,
    userAddress: string,
  ) => Promise<string | null>;
  /** Wraps `executeSendMessageTransaction`. */
  sendMessage: (
    bundle: unknown,
    params: { channelId: string; memberCapId: string; message: string },
  ) => Promise<{ digest: string; messageId: string }>;
  /** Pluggable WS — the panel passes `state.socket.send`. */
  wsSend: (msg: Record<string, unknown>) => void;
  /** Optional progress sink — fires at every named step. The panel
   *  uses this to emit `console.log('[dm-send] <step>')` breadcrumbs. */
  onStep?: (step: DmSendStep) => void;
}

export type DmSendStep =
  | "createChannel:start"
  | "createChannel:done"
  | "registerWs:start"
  | "registerWs:done"
  | "resolveMemberCap:start"
  | "resolveMemberCap:done"
  | "sendMessage:start"
  | "sendMessage:done"
  | "notifyWs:start"
  | "notifyWs:done"
  | "pipeline:done";

export interface DmSendParams {
  peer: string;
  myAddress: string;
  text: string;
  /** Channel id from the panel's state, if a channel for this pair
   *  already exists. When provided the pipeline skips ensureChannel. */
  existingChannelId: string | null;
  /** Member cap id from the panel's state, if known. */
  existingMemberCapId: string | null;
  /** Master budget — defaults to 90 s. Wraps the whole pipeline so a
   *  novel hang point that's not covered by per-call timeouts still
   *  surfaces an actionable error within bounded time. */
  masterTimeoutMs?: number;
}

export interface DmSendResult {
  channelId: string;
  memberCapId: string;
  digest: string;
  messageId: string;
  /** True iff the pipeline created the channel during this call (i.e.
   *  ensureChannel was hit). Drives the panel's "register first send"
   *  copy. */
  freshChannel: boolean;
}

const DEFAULT_MASTER_BUDGET_MS = 90_000;

/**
 * Send a DM end-to-end. Throws on the first failure; the caller's
 * catch handles UI state recovery (mark the optimistic bubble failed,
 * release the Sending button, surface the error toast).
 *
 * The function is pure with respect to the `deps` object: every side
 * effect goes through one of `deps.*`, never via globals. That makes
 * the test harness trivially powerful — swap one method to hang and
 * the pipeline's reaction is observable.
 */
export async function runDmSend(
  deps: DmSendDeps,
  params: DmSendParams,
): Promise<DmSendResult> {
  const masterBudget = params.masterTimeoutMs ?? DEFAULT_MASTER_BUDGET_MS;
  return withTimeout(runDmSendInner(deps, params), masterBudget, "runDmSend");
}

async function runDmSendInner(
  deps: DmSendDeps,
  params: DmSendParams,
): Promise<DmSendResult> {
  const { peer, myAddress, text, existingChannelId, existingMemberCapId } =
    params;
  const step = (s: DmSendStep) => {
    deps.onStep?.(s);
  };

  let channelId: string | null = existingChannelId;
  let memberCap: string | null = existingMemberCapId;
  let encryptedKeyB64: string | undefined;
  let freshChannel = false;

  // Stage 1: ensure a channel exists between (me, peer). Skipped on
  // subsequent sends within the same conversation (existingChannelId
  // pinned by the panel after first create).
  if (!channelId) {
    step("createChannel:start");
    const ensured = await deps.ensureChannel(deps.bundle, peer);
    step("createChannel:done");
    channelId = ensured.channelId;
    memberCap = ensured.callerMemberCapId ?? null;
    encryptedKeyB64 = ensured.encryptedKeyB64;
    freshChannel = ensured.fresh;

    // Tell the server about the new channel so the OTHER participant's
    // sidebar can light up. Sync send; queues during reconnect windows.
    step("registerWs:start");
    deps.wsSend({
      type: "register_dm_channel",
      channelId,
      walletA: myAddress,
      walletB: peer,
      memberCapA: memberCap ?? undefined,
      encryptedKeyB64,
    });
    step("registerWs:done");
  }

  // Stage 2: resolve the caller's member cap if ensureChannel didn't
  // surface it (chain indexer may need a moment after the create).
  if (!memberCap) {
    step("resolveMemberCap:start");
    memberCap = await deps.resolveMemberCap(deps.bundle, channelId!, myAddress);
    step("resolveMemberCap:done");
  }
  if (!memberCap) {
    throw new Error(
      "Member cap not yet visible on chain — try sending again in a moment.",
    );
  }

  // Stage 3: encrypt + upload + sign the on-chain send_message tx.
  step("sendMessage:start");
  const sent = await deps.sendMessage(deps.bundle, {
    channelId: channelId!,
    memberCapId: memberCap,
    message: text,
  });
  step("sendMessage:done");

  // Stage 4: tell the server so the recipient's unread badge bumps +
  // the toast surface fires. Sync; the server response (dm_unread_changed)
  // is consumed by the reducer.
  step("notifyWs:start");
  deps.wsSend({
    type: "notify_dm_sent",
    channelId: channelId!,
    recipient: peer,
  });
  step("notifyWs:done");

  step("pipeline:done");
  return {
    channelId: channelId!,
    memberCapId: memberCap,
    digest: sent.digest,
    messageId: sent.messageId,
    freshChannel,
  };
}

/** Per-call SDK timeout budget — re-exported so tests can tune it. */
export const PIPELINE_BUDGETS = {
  ...SDK_TIMEOUT_MS,
  master: DEFAULT_MASTER_BUDGET_MS,
} as const;
