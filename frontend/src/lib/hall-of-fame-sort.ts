/**
 * Hall of Fame — pure sort helpers.
 *
 * Comparator + toggle state machine for the leaderboard table. Pure
 * module — no React, no DOM, no I/O. Tested via `qa-hall-of-fame.ts`.
 *
 * Toggle semantics:
 *  - Click the active column → flip direction (asc ↔ desc).
 *  - Click a different column → switch to that column with the column's
 *    "natural" default direction (rating/wins/winRate default to desc
 *    so the strongest player rises to the top; level/losses default to
 *    desc too — anything you'd sort by, you probably want top first.
 *    Rank itself defaults to asc because rank=1 is the leader).
 *  - Comparator is total — ties break by rating desc, then wallet asc,
 *    so renders are stable across re-runs of the same dataset.
 */

import type { LeaderboardEntry } from "../types/game";

export type SortKey =
  | "rank"
  | "level"
  | "rating"
  | "wins"
  | "losses"
  | "winRate";

export type SortDir = "asc" | "desc";

export interface SortState {
  key: SortKey;
  dir: SortDir;
}

/** Natural / "first click" direction for each column. */
export const DEFAULT_DIR: Record<SortKey, SortDir> = {
  rank: "asc",
  level: "desc",
  rating: "desc",
  wins: "desc",
  losses: "desc",
  winRate: "desc",
};

/** Win-rate as a number in [0, 1]. Players with no DECIDED fights
 *  count as 0 (draws excluded from the denominator — same convention
 *  as `formatWinRatePct` in hall-of-fame-display.ts; see the JSDoc
 *  there for the rationale). Pure — used by the comparator AND by
 *  the table renderer to avoid drift between display and sort order. */
export function winRateFor(entry: LeaderboardEntry): number {
  const decided = entry.wins + entry.losses;
  if (decided <= 0) return 0;
  return entry.wins / decided;
}

/** Extract the sort field as a number. Stable across all entries. */
function fieldValue(entry: LeaderboardEntry, key: SortKey): number {
  switch (key) {
    case "rank":
      return entry.rank;
    case "level":
      return entry.level;
    case "rating":
      return entry.rating;
    case "wins":
      return entry.wins;
    case "losses":
      return entry.losses;
    case "winRate":
      return winRateFor(entry);
  }
}

/** Total comparator. Primary key first, then rating desc, then wallet asc.
 *  Stable for the same input across runs. */
export function compareEntries(
  a: LeaderboardEntry,
  b: LeaderboardEntry,
  key: SortKey,
  dir: SortDir,
): number {
  const va = fieldValue(a, key);
  const vb = fieldValue(b, key);
  if (va !== vb) {
    return dir === "asc" ? va - vb : vb - va;
  }
  if (key !== "rating") {
    if (a.rating !== b.rating) return b.rating - a.rating;
  }
  return a.walletAddress.localeCompare(b.walletAddress);
}

/** Returns a NEW sorted array. Does not mutate input. */
export function sortLeaderboard(
  entries: ReadonlyArray<LeaderboardEntry>,
  state: SortState,
): LeaderboardEntry[] {
  const copy = entries.slice();
  copy.sort((a, b) => compareEntries(a, b, state.key, state.dir));
  return copy;
}

/** Toggle / switch logic. Returns the new sort state given the
 *  current state and the column the user just clicked. */
export function nextSortState(current: SortState, clicked: SortKey): SortState {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key: clicked, dir: DEFAULT_DIR[clicked] };
}

/** Visual sort indicator string for a column header. Empty when this
 *  column isn't the active sort. Component renders this directly. */
export function sortIndicator(current: SortState, column: SortKey): string {
  if (current.key !== column) return "";
  return current.dir === "asc" ? "↑" : "↓";
}
