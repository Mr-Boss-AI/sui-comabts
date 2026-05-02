/**
 * Effective unallocated stat-points for the allocate UI.
 *
 * Why this exists: the server's `applyXp` optimistically increments
 * `character.unallocatedPoints` the instant a fight ends, but the on-chain
 * `update_after_fight` (which actually grants the points to the Character
 * NFT) runs through the treasury queue and lands ~5–25 s later (after
 * `settle_wager` + opponent's `update_after_fight` + retries). That window
 * is wide enough for a player to open the allocate modal, see "+3 points
 * to allocate", click Allocate, and watch Slush dry-run against the
 * still-old chain object — which aborts with `ENotEnoughPoints` (code 2)
 * because chain `unallocated_points` is still 0.
 *
 * Reproduced live 2026-05-02: Sx_v5.1 hit abort code 2 trying to spend
 * 3 points the server had granted but chain hadn't received yet.
 *
 * Fix: clamp the UI's "available" to `min(server, chain)`. Chain is the
 * contract's source of truth for `allocate_points`; offering the user
 * more than chain has lets them stage a doomed transaction. Once
 * `update_after_fight` lands, server and chain agree, and the floor
 * stops mattering.
 *
 * Pure function so the qa gauntlet can pin every edge case.
 */
export function effectiveUnallocatedPoints(
  serverPoints: number | undefined | null,
  chainPoints: number | undefined | null,
): number {
  const s = sanitize(serverPoints);
  // No chain data yet (the on-chain Character NFT hasn't been hydrated for
  // this session — e.g. RPC down at boot). Fall back to the server value.
  // The wallet popup will fail anyway on missing characterObjectId before
  // it gets near the dry-run, so we don't risk a doomed tx here.
  if (chainPoints == null) return s;
  const c = sanitize(chainPoints);
  return Math.min(s, c);
}

function sanitize(value: number | undefined | null): number {
  if (value == null) return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** True when the server's unallocated count is ahead of chain. The UI
 *  uses this to surface a "chain is catching up" hint rather than just
 *  silently showing fewer points. */
export function isAwaitingChainCatchup(
  serverPoints: number | undefined | null,
  chainPoints: number | undefined | null,
): boolean {
  if (chainPoints == null) return false;
  return sanitize(serverPoints) > sanitize(chainPoints);
}

/**
 * BUG B fix (2026-05-02 retest): pure helper the LOCAL_ALLOCATE reducer
 * action uses to apply an allocation locally after a successful on-chain
 * tx. Pre-fix the modal sent a `allocate_points` WS message after the
 * chain tx; if the WS was mid-reconnect (fresh socket, auth_token
 * round-trip not done) the server rejected with "Not authenticated" and
 * the user saw a red toast even though the chain accepted the allocation.
 *
 * The helper is conservative — clamps unallocated to 0 if the server is
 * already drifting behind chain (the optimistic update could otherwise go
 * negative).
 */
export interface LocalStats {
  strength: number;
  dexterity: number;
  intuition: number;
  endurance: number;
}

export interface LocalAllocateInput extends LocalStats {}

export function applyLocalAllocate(
  current: { stats: LocalStats; unallocatedPoints: number },
  alloc: LocalAllocateInput,
): { stats: LocalStats; unallocatedPoints: number } | null {
  const total =
    sanitize(alloc.strength) +
    sanitize(alloc.dexterity) +
    sanitize(alloc.intuition) +
    sanitize(alloc.endurance);
  if (total <= 0) return null;
  return {
    stats: {
      strength: current.stats.strength + sanitize(alloc.strength),
      dexterity: current.stats.dexterity + sanitize(alloc.dexterity),
      intuition: current.stats.intuition + sanitize(alloc.intuition),
      endurance: current.stats.endurance + sanitize(alloc.endurance),
    },
    unallocatedPoints: Math.max(0, current.unallocatedPoints - total),
  };
}
