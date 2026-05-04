/**
 * Pure predicate guarding the wager-accept flow at the client.
 *
 * Bug 2026-05-04 — `arena::accept_wager` has no chain-side "caller has no
 * open wager" check (contracts/sources/arena.move::accept_wager). The
 * frontend used to fire `signAndExecuteTransaction` before any guard, so a
 * player who already had their own open wager could silently succeed an
 * accept on someone else's wager — flipping the target to STATUS_ACTIVE.
 * The server's WS-side guard ran AFTER, by which time the chain already
 * reflected the state change, and `cancel_wager` aborted with
 * `EMatchNotWaiting (1)`.
 *
 * The chain proved this on 2026-05-04: WagerAccepted events at 12:40, 12:47,
 * 12:53 followed by WagerRefunded (50/50 split) events 3-5 minutes later
 * once the user hard-refreshed and the server's disconnect cleanup
 * admin-cancelled both ACTIVE wagers.
 *
 * This module is the single source of truth for "is this accept allowed":
 *   - `WagerLobbyCard` reads it to disable the Accept button + tooltip.
 *   - `handleAcceptWager` calls it at the top to early-return BEFORE signing.
 *   - `qa-wager-accept-gate.ts` pins the behaviour at the unit-test layer.
 *
 * Defence in depth: the server `handleWagerAccepted` retains its own check
 * (handler.ts:1247) and now self-heals via `admin_cancel_wager` if the chain
 * tx slipped through anyway (Fix B, 2026-05-04).
 */

/** Minimal shape of a wager-lobby entry — narrows the dependency. */
export interface OpenWagerLike {
  /** Creator wallet (case-insensitive — both wire formats observed in the
   *  wild). */
  creatorWallet: string;
  /** On-chain WagerMatch shared-object id. */
  wagerMatchId: string;
}

export interface AcceptGateResult {
  allow: boolean;
  /** User-facing message — surfaced as the button tooltip and as the toast
   *  on the defensive early-return path. */
  reason?: string;
  /** When the caller has their own open wager and tries to accept a
   *  different one, this is the caller's own wager id. Used only for
   *  diagnostic logging on the early-return; not surfaced to the user. */
  ownWagerId?: string;
}

/**
 * Decide whether the caller may initiate `accept_wager` against
 * `targetWagerId`. Pure: no chain calls, no React state, no network. The
 * caller's wallet may be passed in any casing — comparisons are
 * case-insensitive to tolerate the mixed checksum casing the dapp-kit
 * surfaces vs the lower-cased addresses the server stores.
 */
export function canAcceptWager(args: {
  callerWallet: string | null | undefined;
  targetWagerId: string;
  lobby: ReadonlyArray<OpenWagerLike>;
}): AcceptGateResult {
  if (!args.callerWallet) {
    return { allow: false, reason: "Connect a wallet first." };
  }
  const caller = args.callerWallet.toLowerCase();
  const own = args.lobby.find(
    (w) => typeof w.creatorWallet === "string" &&
           w.creatorWallet.toLowerCase() === caller,
  );
  if (own) {
    if (own.wagerMatchId === args.targetWagerId) {
      return { allow: false, reason: "You can't accept your own wager." };
    }
    return {
      allow: false,
      reason: "Cancel your own open wager first before accepting another.",
      ownWagerId: own.wagerMatchId,
    };
  }
  return { allow: true };
}
