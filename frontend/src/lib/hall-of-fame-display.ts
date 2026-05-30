/**
 * Hall of Fame — pure pagination + display helpers.
 *
 * Splits a (sorted, filtered) entry list into "rendered so far" pages.
 * "Load more" UI semantics: page starts at 1 and increments; we always
 * show pages 1..currentPage as a single concatenated list.
 *
 * Pure module — no React, no DOM, no I/O. Tested by `qa-hall-of-fame.ts`.
 */

import type { LeaderboardEntry } from "../types/game";

export const PAGE_SIZE = 20;

export interface PageState {
  /** 1-indexed; "everything up to & including page N". */
  currentPage: number;
  /** Page size; defaults to PAGE_SIZE. */
  pageSize?: number;
}

export interface PageView {
  /** The entries to render right now. */
  visible: LeaderboardEntry[];
  /** Whether there are more entries to load. UI hides the "Load more"
   *  button when this is false. */
  hasMore: boolean;
  /** Cursor for telemetry / debug overlays. */
  totalShown: number;
  /** Filtered total — equal to `entries.length` since slicing happens
   *  AFTER filter+sort already ran. */
  totalAvailable: number;
}

export function paginateEntries(
  entries: ReadonlyArray<LeaderboardEntry>,
  state: PageState,
): PageView {
  const size = state.pageSize ?? PAGE_SIZE;
  const safePage = state.currentPage < 1 ? 1 : state.currentPage;
  const cutoff = Math.min(entries.length, safePage * size);
  const visible = entries.slice(0, cutoff);
  return {
    visible,
    hasMore: entries.length > cutoff,
    totalShown: visible.length,
    totalAvailable: entries.length,
  };
}

/**
 * Win-rate as an integer percentage.
 *
 * **Draw convention: draws are EXCLUDED from the denominator** —
 * `wins / (wins + losses)`, ignoring D. Rationale:
 *   - Standard MMO/PvP semantic — "out of decided fights, how often
 *     did you win?" — the question players intuitively ask.
 *   - The D column already surfaces draws separately, so excluding
 *     them from the percentage doesn't hide information.
 *   - Chess-style "score percentage" (draws = 0.5) would make a
 *     player with 0W / 0L / 10D read as 50%, which over-states
 *     performance — they haven't actually won anything.
 *
 * Returns 0% when there are no decided fights (any combination of W,
 * L, D where W + L = 0). Mirrors the existing 0% behavior for
 * brand-new characters.
 *
 * The `draws` parameter is accepted for symmetry with the W/L/D
 * render path even though it doesn't influence the result — keeps
 * call sites uniformly shaped and makes the convention obvious from
 * the call. Server-side mirror lives in
 * `server/src/data/player-profile.ts::characterToProfileWire`.
 */
export function formatWinRatePct(
  wins: number,
  losses: number,
  _draws: number = 0,
): number {
  const decided = wins + losses;
  if (decided <= 0) return 0;
  return Math.round((wins / decided) * 100);
}

/** Rank color class — gold for #1, silver for #2, bronze for #3, dim
 *  for everyone else. Plain string so the gauntlet can assert it. */
export function rankColor(rank: number): string {
  if (rank === 1) return "text-amber-400 font-bold";
  if (rank === 2) return "text-zinc-300 font-bold";
  if (rank === 3) return "text-amber-600 font-bold";
  return "text-zinc-500";
}
