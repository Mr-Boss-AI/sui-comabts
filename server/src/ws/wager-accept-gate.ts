/**
 * Pure decision predicate for the server-side `wager_accepted` WS handler.
 *
 * Bug 2026-05-04 — `arena::accept_wager` has no chain-side "caller has no
 * open wager" check. The frontend used to fire `signAndExecuteTransaction`
 * before any guard, which silently flipped the target wager to
 * `STATUS_ACTIVE` even when the caller already had their own open wager.
 * The server's WS-side guard ran AFTER the chain tx and just rejected the
 * follow-up message — leaving the chain wager stuck ACTIVE and
 * `cancel_wager` aborting with `EMatchNotWaiting (1)`.
 *
 * Fix A (`frontend/src/lib/wager-accept-gate.ts`) closes the silent-accept
 * by hard-disabling the Accept button + early-returning before signing.
 *
 * Fix B (this module + `handleWagerAccepted`) self-heals if the chain tx
 * slipped through anyway (dev-tools, programmatic client, future
 * regression). When the late-firing "has own open wager" check trips AND
 * the chain says the target is `STATUS_ACTIVE`, we admin-cancel BOTH
 * wagers (50/50 split for ACTIVE; refund-to-creator for WAITING) so
 * neither side stays stuck.
 *
 * Pure: no chain calls, no I/O, no globals. The caller (`handleWagerAccepted`)
 * supplies `targetChainStatus` from a single `getWagerStatus` lookup and
 * the two lobby entries from `wagerLobby.get` / iteration. This module
 * just enumerates the decision tree.
 */

/** Wager status as stored on chain (`arena.move`). */
export const STATUS_WAITING = 0 as const;
export const STATUS_ACTIVE = 1 as const;
export const STATUS_SETTLED = 2 as const;

/** Minimal lobby-entry shape — narrows the dependency on `WagerLobbyEntry`. */
export interface LobbyWagerLike {
  creatorWallet: string;
  wagerMatchId: string;
}

export interface DecideAcceptOutcomeArgs {
  callerWallet: string;
  targetWagerId: string;
  /** The on-chain status numeric (0 / 1 / 2 — see constants above).
   *  Pass through whatever `getWagerStatus` returned. */
  targetChainStatus: number;
  /** The caller's own open wager from the lobby, if any. The handler
   *  iterates `wagerLobby.values()` looking for `creatorWallet === callerWallet`
   *  and passes the first match. `undefined` means "caller has no open wager
   *  per the lobby". */
  callerOwnWagerInLobby: LobbyWagerLike | undefined;
  /** The target wager's lobby entry, or `undefined` if not in lobby. */
  targetInLobby: LobbyWagerLike | undefined;
  /** True when the caller is currently in the matchmaking queue
   *  (friendly / ranked). Defaults to `false` for backward compat with
   *  pre-Fix-1 callers. When true and the chain shows the target as
   *  STATUS_ACTIVE, the autoRollback also instructs the handler to
   *  drop the caller from the matchmaking queue. */
  callerInMatchmakingQueue?: boolean;
}

export type DecideAcceptOutcome =
  | { kind: 'proceed' }
  | { kind: 'reject'; reason: string }
  | {
      kind: 'autoRollback';
      targetWagerId: string;
      /** Non-null when the caller had an open wager that also needs an
       *  admin_cancel. Null for the "caller was in matchmaking queue"
       *  flavour (Fix 1) — there's no own wager to cancel, but the
       *  target chain wager still needs rolling back. */
      callerOwnWagerId: string | null;
      /** True when the caller was in the matchmaking queue at the time
       *  of the gate trip — handler should also call
       *  `removeFromQueue(callerWallet)` after the admin_cancels. */
      removeFromMatchmakingQueue: boolean;
      userMessage: string;
    };

/**
 * Decide what `handleWagerAccepted` should do. Decision tree (top-down):
 *
 *   1. Target not in lobby           → reject ("not found …")
 *   2. Caller is creator of target   → reject (self-accept defence-in-depth)
 *   3. Caller has own wager OR is in matchmaking queue (BUSY)
 *        AND chain status == ACTIVE  → autoRollback (silent-accept slipped
 *                                       past — admin-cancel target +
 *                                       any own wager + drop from queue)
 *        AND chain status != ACTIVE  → reject (busy reason)
 *   4. Chain status != ACTIVE        → reject ("not active on-chain …")
 *   5. Else                          → proceed (lobby cleanup + fight start)
 */
export function decideAcceptOutcome(args: DecideAcceptOutcomeArgs): DecideAcceptOutcome {
  // 1. Target absent.
  if (!args.targetInLobby) {
    return {
      kind: 'reject',
      reason: 'Wager not found in lobby (may have been cancelled or accepted by someone else)',
    };
  }

  // 2. Self-target. Chain `accept_wager` would also abort
  //    (ECannotJoinOwnMatch=7), but the WS rejection is faster and clearer.
  if (args.targetInLobby.creatorWallet.toLowerCase() === args.callerWallet.toLowerCase()) {
    return { kind: 'reject', reason: 'You cannot accept your own wager' };
  }

  // 3. Caller is busy in another mode — the BUG path branches here.
  //    Two flavours: (a) own open wager (Fix B silent-accept), (b) in
  //    matchmaking queue (Fix 1 cross-mode isolation, 2026-05-04).
  const callerInQueue = args.callerInMatchmakingQueue === true;
  const hasOwnWager = !!args.callerOwnWagerInLobby;

  if (hasOwnWager || callerInQueue) {
    if (args.targetChainStatus === STATUS_ACTIVE) {
      // Chain accept already landed despite the busy state. Auto-rollback:
      //   - target wager (ACTIVE, escrow=2× stake) → 50/50 admin_cancel
      //   - caller's own wager (if any, WAITING) → admin_cancel refund
      //   - caller's matchmaking queue entry (if any) → drop
      const ownTag = hasOwnWager
        ? 'You had your own open wager'
        : 'You were already in the matchmaking queue';
      return {
        kind: 'autoRollback',
        targetWagerId: args.targetWagerId,
        callerOwnWagerId: args.callerOwnWagerInLobby?.wagerMatchId ?? null,
        removeFromMatchmakingQueue: callerInQueue,
        userMessage:
          'Auto-rolled back — stakes refunded. ' +
          `${ownTag}; the chain accept slipped past the client gate. ` +
          'Resolve your existing state first before accepting another wager.',
      };
    }
    // Chain didn't flip → Fix A / Fix 1 client gate held. Plain reject.
    if (hasOwnWager) {
      return {
        kind: 'reject',
        reason: 'You have an open wager. Cancel it first before accepting another.',
      };
    }
    return {
      kind: 'reject',
      reason: 'You are queued for a fight. Leave the queue before accepting a wager.',
    };
  }

  // 4. No own wager but chain says target isn't ACTIVE. Either the
  //    accept_wager tx failed silently, or the wager was already finished
  //    on chain (e.g. admin-cancel from disconnect cleanup beat us).
  if (args.targetChainStatus !== STATUS_ACTIVE) {
    return {
      kind: 'reject',
      reason: `Wager not active on-chain (status: ${args.targetChainStatus}). Did the accept_wager transaction succeed?`,
    };
  }

  // 5. All checks passed.
  return { kind: 'proceed' };
}
