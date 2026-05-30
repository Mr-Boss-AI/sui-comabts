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

/**
 * Phase A (2026-05-17) — Bug A pre-flight balance check.
 *
 * Background: 2026-05-16 live two-wallet test surfaced a silent-fail
 * UX bug. Acceptor Mr_Boss_v5.1 had 0.501 SUI on-chain and clicked
 * ACCEPT on a 0.5 SUI wager. The wallet popped, the user signed, the
 * chain transaction failed (insufficient gas headroom after locking
 * 0.5 SUI in escrow), `WagerMatch.status` stayed at 0 (WAITING), and
 * the server emitted the misleading toast "Wager not active on-chain
 * (status: 0). Did the accept_wager transaction succeed?"
 *
 * This pure predicate refuses the click BEFORE the wallet popup when
 * the caller's balance can't cover stake + estimated gas. The
 * recommended gas reserve is 0.02 SUI — typical mainnet RGP at 750-1000
 * MIST × a generous gas budget of ~20-25M MIST gives ~0.02 SUI of
 * headroom over any reasonable wager + treasury escrow path.
 *
 * Pure: no React, no chain calls, no allocation of new objects beyond
 * the result. Pinned in `qa-wager-accept-gate.ts` with explicit
 * insufficient / exactly-equal / just-enough / well-funded fixtures.
 *
 * Returns the same `AcceptGateResult` shape as `canAcceptWager`, with
 * the user-facing reason string formatted for direct display in the
 * accept-button tooltip / refusal toast. When the balance fails the
 * check, `ownWagerId` is intentionally not set — this is a balance
 * problem, not an open-wager-collision problem.
 */
export const DEFAULT_GAS_RESERVE_MIST = BigInt(20_000_000); // 0.02 SUI

export function canAcceptWagerWithBalance(args: {
  /** Lobby + own-wager check result. Pass `canAcceptWager(...)`'s output. */
  lobbyGate: AcceptGateResult;
  /** Stake the caller would lock on chain, in MIST. */
  stakeMist: bigint;
  /** Caller's current SUI balance in MIST. `null` when the balance hook
   *  is still loading or errored — treated as "can't determine, refuse". */
  balanceMist: bigint | null;
  /** Gas headroom to reserve above the stake, in MIST. Defaults to
   *  `DEFAULT_GAS_RESERVE_MIST` (0.02 SUI). */
  gasReserveMist?: bigint;
}): AcceptGateResult {
  // Short-circuit the lobby/own-wager refusals first — those messages
  // are more actionable than "insufficient SUI", and we don't want to
  // emit a balance error for a wager the caller can't even attempt.
  if (!args.lobbyGate.allow) return args.lobbyGate;

  const reserve = args.gasReserveMist ?? DEFAULT_GAS_RESERVE_MIST;
  const required = args.stakeMist + reserve;

  if (args.balanceMist === null) {
    return {
      allow: false,
      reason: "Loading wallet balance — try again in a moment.",
    };
  }

  if (args.balanceMist < required) {
    const needSui = mistToSuiFixed(required);
    const haveSui = mistToSuiFixed(args.balanceMist);
    return {
      allow: false,
      reason: `Need ~${needSui} SUI (${mistToSuiFixed(args.stakeMist)} stake + gas) — you have ${haveSui} SUI.`,
    };
  }

  return { allow: true };
}

/**
 * Format MIST as a SUI decimal string, trimmed of trailing zeros.
 * Pure helper used only by the gate's user-facing reason text.
 */
function mistToSuiFixed(mist: bigint): string {
  const whole = mist / BigInt(1_000_000_000);
  const frac = mist % BigInt(1_000_000_000);
  if (frac === BigInt(0)) return whole.toString();
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fracStr}`;
}
