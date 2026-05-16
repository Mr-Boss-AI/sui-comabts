/**
 * Sui transaction-result helpers (frontend) — Phase A, 2026-05-17.
 *
 * The `@mysten/dapp-kit-core` `CurrentAccountSigner.signAndExecuteTransaction`
 * resolves with one of two shapes depending on chain outcome:
 *
 *   Success: `{ $kind: 'Transaction', Transaction: { effects, digest, ... } }`
 *   Failure: `{ $kind: 'FailedTransaction', FailedTransaction: { error, ... } }`
 *
 * Some wallets ALSO route a successful execution through with a non-success
 * `effects.status.status` (e.g. an abort with `code: N`). Both paths look
 * "successful" to a naïve digest-extraction call. This module consolidates
 * the unwrap logic so every call site shares a single trustworthy check:
 *
 *   const result = await signer.signAndExecuteTransaction({ transaction });
 *   assertTxSucceeded(result, "accept_wager");
 *   const digest = extractTxDigest(result);
 *
 * Extracted from `useEquipmentActions.ts::assertTxSucceeded` (pre-Phase-A
 * only call site) so the wager-create + wager-accept paths in
 * `matchmaking-queue.tsx` share the same FailedTransaction branching that
 * the equipment loadout already had. Bug B in
 * `STATE_OF_PROJECT_2026-05-16.md` was the missing branching in the wager
 * paths; this module is its single source of truth.
 *
 * Pure: no React, no chain calls, no globals. Pinned by structural QA in
 * `scripts/qa-wager-accept-gate.ts` and `scripts/qa-equip-picker.ts`.
 */

/**
 * Optional per-call-site abort-code humanizer. The Move-side abort codes
 * are per-module (equipment.move uses 0-6 for one set of slot errors,
 * arena.move would use a different set, etc.), so the lookup is injected
 * rather than hardcoded. Callers that don't care about specific codes
 * pass `undefined` and get the raw "Abort code N" fallback.
 */
export type AbortCodeMap = Record<number, string>;

/**
 * Parse a raw error string (from `result.effects.status.error`,
 * `FailedTransaction.error`, or a thrown `Error.message`) and produce a
 * human-readable message. Returns `null` when the string doesn't match
 * any known pattern — callers should fall back to the raw string or a
 * generic "transaction aborted" copy.
 */
export function humanizeChainError(
  errStr: string,
  abortCodes?: AbortCodeMap,
): string | null {
  if (!errStr) return null;

  // Pre-execution: item is attached as a DOF to a parent object, can't be
  // passed as a tx input. Hits when local state thinks an item is free
  // but on-chain it is still equipped under a different slot.
  if (
    errStr.includes("owned by object") &&
    errStr.includes("cannot be used as input")
  ) {
    return (
      "An item in the loadout is already equipped on-chain under a different slot. " +
      "Refresh inventory and stage again."
    );
  }

  // Full MoveAbort with module + function + instruction
  const moveAbortMatch = errStr.match(
    /abort code[:\s]+(\d+)[^']*'[^']*::([^:']+)::([^']+)'(?:\s*\(instruction (\d+)\))?/,
  );
  if (moveAbortMatch) {
    const [, codeStr, module, fn, instr] = moveAbortMatch;
    const code = Number(codeStr);
    const humanMsg = abortCodes?.[code] ?? `Abort code ${code}`;
    const location = instr ? `${module}::${fn}:${instr}` : `${module}::${fn}`;
    return `${humanMsg} (at ${location})`;
  }

  const bareCodeMatch = errStr.match(/abort code[:\s]+(\d+)/i);
  if (bareCodeMatch) {
    const code = Number(bareCodeMatch[1]);
    return abortCodes?.[code] ?? `Abort code ${code}`;
  }

  return null;
}

/**
 * Throws a human-readable `Error` if the tx result indicates failure.
 * Silent on success. The `ctxLabel` (e.g. `"accept_wager"`) is included
 * in the thrown message so the call-site is obvious in the catch block.
 *
 * Recognised failure shapes (in priority order):
 *   1. `effects.status.status !== "success"` (success-shaped wrapper, abort)
 *   2. `result.$kind === "FailedTransaction"` (top-level failure wrapper)
 *   3. `result.FailedTransaction.error` (legacy / wallet-specific)
 *
 * Treats any `result.$kind === "Transaction"` without an embedded
 * `FailedTransaction` as success — matches the post-Phase-A SDK shape
 * we get from `CurrentAccountSigner.signAndExecuteTransaction`.
 */
export function assertTxSucceeded(
  result: unknown,
  ctxLabel: string,
  abortCodes?: AbortCodeMap,
): void {
  const r = result as Record<string, any> | null | undefined;
  if (!r) {
    throw new Error(`${ctxLabel} returned no result`);
  }

  const txData = r.Transaction || r;
  const status = txData?.effects?.status || r.effects?.status;

  // Happy path — explicit success in the effects, or a Transaction wrapper
  // with no FailedTransaction sibling.
  if (status && (status.status === "success" || status === "success")) return;
  if (r.$kind === "Transaction" && !r.FailedTransaction) return;

  const errStr: string =
    (status && typeof status.error === "string" && status.error) ||
    (typeof r.FailedTransaction?.error === "string" && r.FailedTransaction.error) ||
    (typeof r.FailedTransaction?.errorMessage === "string" && r.FailedTransaction.errorMessage) ||
    (typeof r.FailedTransaction?.cause === "string" && r.FailedTransaction.cause) ||
    (typeof r.error === "string" && r.error) ||
    (typeof r.message === "string" && r.message) ||
    "";

  console.error(`[Tx:${ctxLabel}] Aborted. Raw result:`, r);
  const humanized = humanizeChainError(errStr, abortCodes);
  throw new Error(
    humanized
      ? `${ctxLabel} failed: ${humanized}`
      : errStr
        ? `${ctxLabel} failed: ${errStr}`
        : `${ctxLabel} aborted on-chain (see console for raw result)`,
  );
}

/**
 * Extract the tx digest from either result shape. Returns `null` if no
 * digest is present (e.g. the SDK swallowed it). Callers that need the
 * digest should `assertTxSucceeded(...)` first.
 */
export function extractTxDigest(result: unknown): string | null {
  const r = result as Record<string, any> | null | undefined;
  if (!r) return null;
  const txData = r.Transaction || r;
  const digest =
    txData?.digest || txData?.effects?.transactionDigest || r.digest || null;
  return typeof digest === "string" ? digest : null;
}
