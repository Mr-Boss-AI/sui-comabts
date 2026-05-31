/**
 * Wager pre-flight — dry-run before the wallet popup.
 *
 * The 2026-05-18 EMatchNotWaiting incident reached the user as the raw
 * SDK toast `Transaction resolution failed: MoveAbort in 2nd command,
 * abort code: 1, in '0xa7dc...::arena::accept_wager' (instruction 14)`.
 * That string is produced by dapp-kit's `signAndExecuteTransaction`
 * which runs an internal resolve step AFTER the user signs in the
 * wallet popup but BEFORE actual submission. So the user signs, the
 * wallet pops up, the user confirms, and only THEN do they see the
 * cryptic abort.
 *
 * This module flips the order: simulate first, surface a friendly
 * message if the simulation aborts, and only ask the user to sign
 * when the simulation reports success. Side benefit — when two
 * acceptors race for the same wager, the second one never sees the
 * wallet popup at all, just a clear "already accepted" toast.
 *
 * Reuses `assertTxSucceeded` from `tx-result.ts` so the failure-shape
 * detection (Transaction vs FailedTransaction vs success-shaped
 * abort) is identical to what we already do on the post-execute side.
 * Pinned by `scripts/qa-arena-aborts.ts`.
 */

import type { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { ARENA_ABORT_CODES, ARENA_EXPECTED_ABORT_CODES } from "./arena-aborts";
import { assertTxSucceeded } from "./tx-result";

export type PreflightResult =
  | { ok: true }
  | { ok: false; message: string; raw?: unknown };

/**
 * Run a dry-run / simulation of `tx` as `walletAddress` and translate
 * any abort into a human-readable message using `ARENA_ABORT_CODES`.
 *
 * Returns `{ ok: true }` when the simulation completes successfully.
 * Returns `{ ok: false, message }` on any abort, RPC failure, or
 * client misconfiguration. The caller decides whether to surface
 * `message` as a toast or treat it as a soft warning.
 *
 * Set `sender` rather than relying on `tx.gas` having a captured
 * sender — `Transaction` instances built by `buildAcceptWagerTx`
 * (and friends) don't set a sender until the signer wraps them, so
 * simulation needs the address handed in explicitly.
 *
 * Defensive against gRPC-client absence: a session that hasn't
 * finished hydrating `useCurrentClient()` shouldn't block the user
 * from signing — return `{ ok: true }` with a console warning. The
 * server's own chain probe in `handleWagerAccepted` is the final
 * safety net; pre-flight is UX, not authorisation.
 */
export async function simulateWagerTx(
  client: SuiGrpcClient | null,
  tx: Transaction,
  walletAddress: string,
  ctxLabel: string,
): Promise<PreflightResult> {
  if (!client) {
    console.warn(
      `[Preflight:${ctxLabel}] No gRPC client — skipping simulation. ` +
        "Server's chain probe will catch any abort post-submit.",
    );
    return { ok: true };
  }
  tx.setSenderIfNotSet(walletAddress);
  let result: unknown;
  try {
    result = await client.simulateTransaction({
      transaction: tx,
      include: { effects: true },
    });
  } catch (err: any) {
    // Network / RPC failure during simulation. Don't block the user —
    // sign-and-execute has its own retry / RPC failover; the abort
    // (if any) will surface there.
    console.warn(
      `[Preflight:${ctxLabel}] simulateTransaction threw — proceeding:`,
      err?.message || err,
    );
    return { ok: true };
  }
  // Diagnostic (2026-05-27, deepened 2026-05-31). The 2026-05-27
  // accept_wager incident logged `Raw result: {}` from
  // assertTxSucceeded — but the underlying accept tx (81M27eNDr…) had in
  // fact landed on chain. The empty-object dump turned out to be a
  // surface artifact: console.log unwrapping a class instance that has
  // no own-enumerable properties beyond the SDK's $kind discriminator
  // hidden behind getters. The 2026-05-31 create_wager incident hit the
  // SAME log line because the SDK 2.16 `ExecutionError` is an OBJECT
  // (with `.MoveAbort.abortCode`) — the old string-only path in
  // assertTxSucceeded couldn't reach it, fell through to the empty
  // fallback, and the user saw the unhelpful generic toast. Now the
  // structured-abort reader in tx-result.ts handles both shapes; the
  // diagnostic here also logs the FailedTransaction inner error shape
  // (typeof + $kind + whether MoveAbort is present) so the NEXT
  // SDK-shape drift is one log line away from a diagnosis.
  const rTyped = result as Record<string, unknown> | null;
  const failed = (rTyped as any)?.FailedTransaction;
  const failedErr = failed?.status?.error ?? failed?.error;
  console.log(
    `[Preflight:${ctxLabel}] simulateTransaction returned. ` +
      `type=${typeof result} ` +
      `keys=${rTyped && typeof rTyped === "object" ? JSON.stringify(Object.keys(rTyped)) : "(non-object)"} ` +
      `hasEffects=${!!(rTyped as any)?.effects} ` +
      `hasTransaction=${!!(rTyped as any)?.Transaction} ` +
      `$kind=${(rTyped as any)?.$kind ?? "(undef)"} ` +
      `failedErrType=${typeof failedErr} ` +
      `failedErr$kind=${(failedErr as any)?.$kind ?? "(undef)"} ` +
      `hasMoveAbort=${!!(failedErr as any)?.MoveAbort} ` +
      `abortCode=${(failedErr as any)?.MoveAbort?.abortCode ?? "(undef)"} ` +
      `raw=`,
    result,
  );
  try {
    assertTxSucceeded(result, ctxLabel, ARENA_ABORT_CODES, ARENA_EXPECTED_ABORT_CODES);
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      message: err?.message || `${ctxLabel} simulation failed`,
      raw: result,
    };
  }
}
