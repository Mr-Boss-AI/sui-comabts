/**
 * Effective unallocated stat-points for the allocate UI.
 *
 * The chain `allocate_points` Move call asserts
 * `total <= character.unallocated_points` — the on-chain Character is
 * the authoritative gate. The UI's "available" count therefore takes
 * the chain value when present, falling back to the server-side mirror
 * only when chain hasn't been hydrated for this session.
 *
 * History — TWO races this helper must handle correctly:
 *
 *  Race A (original v5.1, 2026-05-02 live test): server-side `applyXp`
 *  optimistically increments `character.unallocatedPoints` the instant a
 *  fight ends, but the on-chain `update_after_fight` runs through the
 *  treasury queue and lands ~5–25 s later. Pre-helper UX: a user could
 *  open the modal mid-window, click Allocate, watch the wallet dry-run
 *  abort with `ENotEnoughPoints (2)` because the chain still has 0.
 *  Pre-2026-05-30 fix: `min(server, chain)`. New fix: same outcome —
 *  taking chain directly returns 0 in this race, equally safe.
 *
 *  Race B (v5.2, 2026-05-30 live QA): the SYMMETRIC case — the chain
 *  update lands and the server's in-memory `unallocatedPoints` is
 *  synced (fight-room.ts:688), but the server only emits
 *  `character_updated_onchain` (a chain-refetch trigger) — not a fresh
 *  `character_data`. The frontend's `state.character.unallocatedPoints`
 *  therefore stays at 0 while `state.onChainCharacter.unallocatedPoints`
 *  refetches to 3. Pre-fix `min(0, 3) = 0` made the modal show
 *  "Remaining: 0" and refuse to allocate, even though the chain WOULD
 *  accept up to 3. Post-fix: trust chain → 3 → modal shows 3 → wallet
 *  popup → chain accepts → done.
 *
 * Race B is independently addressed in fight-room.ts by pushing a fresh
 * `character_data` after the chain update lands — but THIS helper
 * remains the canonical defence (the WS push could still race the modal
 * open if the user is fast on the click; chain is always-correct).
 *
 * Pure function so the qa gauntlet can pin every edge case.
 */
export function effectiveUnallocatedPoints(
  serverPoints: number | undefined | null,
  chainPoints: number | undefined | null,
): number {
  // No chain data yet (the on-chain Character NFT hasn't been hydrated for
  // this session — e.g. RPC down at boot). Fall back to the server value.
  // The wallet popup will fail anyway on missing characterObjectId before
  // it gets near the dry-run, so we don't risk a doomed tx here.
  if (chainPoints == null) return sanitize(serverPoints);
  // Chain is the binding gate for allocate_points — trust it directly.
  // Handles both Race A (chain==0, server==3 → return 0, safe) and
  // Race B (chain==3, server==0 → return 3, correct).
  return sanitize(chainPoints);
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
