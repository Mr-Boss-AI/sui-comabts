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
 * Structured Move-abort information lifted from the SDK 2.16
 * `ExecutionError` envelope. Same fields humanizeChainError would have
 * regex-extracted from a string, but available here directly when the
 * SDK gives us the typed shape.
 */
export interface StructuredAbort {
  abortCode: number;
  module?: string;
  functionName?: string;
  instruction?: number;
}

/**
 * SDK 2.16 ExecutionError shape (subset). When `simulateTransaction` or
 * `signAndExecuteTransaction` aborts, the inner Transaction's
 * `status.error` is an object of this shape — NOT a string. The 2026-05-31
 * incident traced to this: the `create_wager` simulate aborted with
 * EAlreadyHasOpenWager but `assertTxSucceeded` only read `error` as a
 * string, so the empty fallback fired and the user saw the generic
 * "aborted on-chain (see console for raw result)" toast instead of
 * "You already have an open wager…".
 */
export interface ExecutionErrorLike {
  message?: string;
  command?: number;
  $kind?: string;
  MoveAbort?: {
    abortCode?: string | number;
    location?: {
      package?: string;
      module?: string;
      function?: number;
      functionName?: string;
      instruction?: number;
    };
  };
}

/**
 * Read a structured Move abort from an SDK ExecutionError-shaped value.
 * Returns null if the shape isn't recognized (e.g. SizeError, RPC
 * failure, or just a string error from a legacy wallet path).
 */
export function readStructuredAbort(err: unknown): StructuredAbort | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as ExecutionErrorLike;
  // The $kind discriminator is the canonical signal. We also accept a
  // bare `MoveAbort` field for defence-in-depth (some intermediate
  // wrappers strip the discriminator).
  if (e.$kind !== 'MoveAbort' && !e.MoveAbort) return null;
  const ma = e.MoveAbort;
  if (!ma) return null;
  const codeRaw = ma.abortCode;
  const code = typeof codeRaw === 'number' ? codeRaw : codeRaw != null ? Number(codeRaw) : NaN;
  if (!Number.isFinite(code)) return null;
  return {
    abortCode: code,
    module: ma.location?.module,
    functionName: ma.location?.functionName,
    instruction: ma.location?.instruction,
  };
}

/**
 * Format a structured abort into the same wire-shape string the regex
 * branch in `humanizeChainError` produces. Keeps the call-site format
 * identical regardless of which envelope path produced the abort, so
 * downstream log readers / tests don't need to fork.
 */
export function formatStructuredAbort(
  abort: StructuredAbort,
  abortCodes?: AbortCodeMap,
): string {
  const humanMsg = abortCodes?.[abort.abortCode] ?? `Abort code ${abort.abortCode}`;
  if (abort.module && abort.functionName) {
    const loc = abort.instruction != null
      ? `${abort.module}::${abort.functionName}:${abort.instruction}`
      : `${abort.module}::${abort.functionName}`;
    return `${humanMsg} (at ${loc})`;
  }
  return humanMsg;
}

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
 * **v5.1 SDK 2.16 shape (canonical):**
 * `simulateTransaction` and `signAndExecuteTransaction` return a discriminated
 * union typed as `SimulateTransactionResult<Include>` in
 * `@mysten/sui/dist/cjs/client/types.d.ts:350-362`:
 *
 *   { $kind: 'Transaction',        Transaction:        Transaction<Include>, FailedTransaction?: never, commandResults }
 * | { $kind: 'FailedTransaction',  FailedTransaction: Transaction<Include>, Transaction?: never,        commandResults }
 *
 * Where the inner `Transaction<Include>` has shape
 * `{ digest, signatures, status: ExecutionStatus, effects?: TransactionEffects, ... }`
 * — `status` lives at the top of the inner Transaction, NOT at `.effects.status`.
 * `.effects` is only present when `include: { effects: true }` was passed.
 *
 * This function reads in the following priority order:
 *   1. `result.$kind === "FailedTransaction"` → ABORT (read error from
 *      FailedTransaction.status or .error)
 *   2. `result.$kind === "Transaction"` → SUCCESS short-circuit (the type
 *      union guarantees the inner status is success-flavoured)
 *   3. Legacy / non-discriminated shapes (pre-2.16 SDK or wallet-specific):
 *      try `.effects.status`, `.Transaction.effects.status`, `.error`, `.message`.
 *      These paths exist as a safety net only — current SDK never hits them.
 *
 * 2026-05-27 incident note: pre-hardening, the function fell through the
 * legacy paths when the SDK shape changed in 2.16, accidentally landing on
 * the `$kind === "Transaction"` short-circuit at the end. Behaviourally
 * correct (success → silent) but logically reading the wrong field. This
 * version reads the canonical 2.16 discriminator first.
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

  // v5.1 canonical 2.16 path — discriminator first.
  if (r.$kind === "FailedTransaction") {
    const failed = r.FailedTransaction;
    const innerStatus = failed?.status;
    // SDK 2.16 ExecutionError is an OBJECT, not a string. Try the
    // structured path first so a Move abort always reaches the human
    // copy even when `error.message` is empty (the 2026-05-31 incident:
    // simulate failed with EAlreadyHasOpenWager but `typeof error ===
    // 'string'` returned false, so the empty fallback fired). The
    // string-only paths below are kept as defence for legacy / wallet-
    // specific shapes.
    const structured =
      readStructuredAbort(innerStatus?.error) ??
      readStructuredAbort((failed as Record<string, unknown> | undefined)?.error);
    const errStr: string =
      (innerStatus && typeof innerStatus.error === "string" && innerStatus.error) ||
      // The SDK ExecutionError carries a `.message` field even when the
      // top-level shape is structured. Pull it for the legacy regex.
      (innerStatus?.error && typeof innerStatus.error === "object"
        && typeof (innerStatus.error as { message?: unknown }).message === "string"
        ? (innerStatus.error as { message: string }).message
        : "") ||
      (typeof failed?.error === "string" && failed.error) ||
      (typeof failed?.errorMessage === "string" && failed.errorMessage) ||
      (typeof failed?.cause === "string" && failed.cause) ||
      "";
    console.error(`[Tx:${ctxLabel}] Aborted (\\$kind=FailedTransaction). Raw:`, r);
    if (structured) {
      // The structured branch is authoritative when present — we have
      // the abort code directly from the SDK, no regex needed.
      throw new Error(
        `${ctxLabel} failed: ${formatStructuredAbort(structured, abortCodes)}`,
      );
    }
    const humanized = humanizeChainError(errStr, abortCodes);
    throw new Error(
      humanized
        ? `${ctxLabel} failed: ${humanized}`
        : errStr
          ? `${ctxLabel} failed: ${errStr}`
          : `${ctxLabel} aborted on-chain (see console for raw result)`,
    );
  }
  if (r.$kind === "Transaction") {
    // Discriminated success — type union guarantees no FailedTransaction sibling.
    // Defence-in-depth: if the inner Transaction.status exists and reads
    // "failure", treat it as abort. Per the SDK type, this branch shouldn't
    // be reachable, but we guard against future shape drift.
    const innerStatus = r.Transaction?.status;
    // Defence-in-depth (per the SDK type union this branch shouldn't
    // be reachable — it's "success-flavoured" by construction). If a
    // future SDK drift puts a failure here, handle the same way:
    // structured first, then string.
    if (innerStatus && (innerStatus.status === "failure" || innerStatus.success === false)) {
      const structured = readStructuredAbort(innerStatus.error);
      const errStr: string =
        (typeof innerStatus.error === "string" && innerStatus.error) ||
        (innerStatus.error && typeof innerStatus.error === "object"
          && typeof (innerStatus.error as { message?: unknown }).message === "string"
          ? (innerStatus.error as { message: string }).message
          : "");
      console.error(`[Tx:${ctxLabel}] Aborted (Transaction.status=failure). Raw:`, r);
      if (structured) {
        throw new Error(
          `${ctxLabel} failed: ${formatStructuredAbort(structured, abortCodes)}`,
        );
      }
      const humanized = humanizeChainError(errStr, abortCodes);
      throw new Error(
        humanized
          ? `${ctxLabel} failed: ${humanized}`
          : errStr
            ? `${ctxLabel} failed: ${errStr}`
            : `${ctxLabel} aborted on-chain (see console for raw result)`,
      );
    }
    return;
  }

  // ── Legacy / pre-2.16 path (kept as safety net) ──────────────────────────
  // Some wallet implementations historically returned a non-discriminated
  // shape with effects.status directly. Read both possible nesting levels
  // (.effects.status and .Transaction.effects.status) so a regression in a
  // single wallet doesn't blind-fail.
  const txData = r.Transaction || r;
  const status = txData?.effects?.status || r.effects?.status;

  if (status && (status.status === "success" || status === "success")) return;

  // Try the structured-abort path before falling through to string
  // patterns — covers the case where a wallet returns the legacy shape
  // BUT puts a 2.16-style ExecutionError object in `.error`.
  const legacyStructured =
    readStructuredAbort(status?.error) ??
    readStructuredAbort(r.FailedTransaction?.error) ??
    readStructuredAbort(r.error);
  if (legacyStructured) {
    console.error(`[Tx:${ctxLabel}] Aborted (legacy-shape, structured error). Raw:`, r);
    throw new Error(
      `${ctxLabel} failed: ${formatStructuredAbort(legacyStructured, abortCodes)}`,
    );
  }

  const errStr: string =
    (status && typeof status.error === "string" && status.error) ||
    (typeof r.FailedTransaction?.error === "string" && r.FailedTransaction.error) ||
    (typeof r.FailedTransaction?.errorMessage === "string" && r.FailedTransaction.errorMessage) ||
    (typeof r.FailedTransaction?.cause === "string" && r.FailedTransaction.cause) ||
    (typeof r.error === "string" && r.error) ||
    (typeof r.message === "string" && r.message) ||
    "";

  console.error(`[Tx:${ctxLabel}] Aborted (legacy-shape path). Raw:`, r);
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
