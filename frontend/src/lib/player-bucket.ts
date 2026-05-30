/**
 * Frontend player-bucket grouping. Mirrors the server's
 * `groupPlayersByLevelBucket` (data/presence.ts) so the sidebar uses
 * the same brackets the server's `getOnlinePlayersBucketed()` would
 * use — keeping the QA gauntlet single-source-of-truth even when only
 * the frontend renders.
 *
 * Pure module — no React, no DOM, no I/O. Tested via
 * `qa-tavern-sidebar.ts`.
 */

import type { OnlinePlayer } from "@/types/game";

export interface SidebarBucketDef {
  key: string;
  label: string;
  minLevel: number;
  maxLevel: number;
}

export const SIDEBAR_BUCKETS: ReadonlyArray<SidebarBucketDef> = [
  { key: "novice",   label: "Novice",     minLevel: 1,  maxLevel: 3 },
  { key: "early",    label: "Early Game", minLevel: 4,  maxLevel: 6 },
  { key: "mid",      label: "Mid Game",   minLevel: 7,  maxLevel: 9 },
  { key: "high",     label: "High Game",  minLevel: 10, maxLevel: 14 },
  { key: "endgame",  label: "Endgame",    minLevel: 15, maxLevel: 19 },
  { key: "hall",     label: "Hall of Fame", minLevel: 20, maxLevel: 9999 },
];

export interface SidebarBucket extends SidebarBucketDef {
  players: OnlinePlayer[];
}

export interface GroupOptions {
  /** When true, only buckets with at least one player are returned. */
  hideEmpty?: boolean;
  /** Status filter — when set, only players matching one of these
   *  statuses are bucketed. */
  statusFilter?: ReadonlyArray<OnlinePlayer["status"]>;
  /** Case-insensitive substring match against player.name. */
  search?: string;
  /** Wallets to exclude (typically the viewer's own wallet). */
  exclude?: ReadonlyArray<string>;
}

export function groupPlayersForSidebar(
  players: ReadonlyArray<OnlinePlayer>,
  options: GroupOptions = {},
): SidebarBucket[] {
  const excludeLower = new Set(
    (options.exclude ?? []).map((w) => w.toLowerCase()),
  );
  const search = options.search?.trim().toLowerCase() ?? "";
  const filtered = players.filter((p) => {
    if (excludeLower.has(p.walletAddress.toLowerCase())) return false;
    if (options.statusFilter && !options.statusFilter.includes(p.status)) {
      return false;
    }
    if (search && !p.name.toLowerCase().includes(search)) return false;
    return true;
  });
  const buckets: SidebarBucket[] = SIDEBAR_BUCKETS.map((def) => ({ ...def, players: [] }));
  for (const p of filtered) {
    const bucket = buckets.find((b) => p.level >= b.minLevel && p.level <= b.maxLevel);
    if (bucket) bucket.players.push(p);
    else buckets[0].players.push(p);
  }
  for (const bucket of buckets) {
    bucket.players.sort((a, b) => {
      // Online > in_marketplace > in_fight > idle within the bucket so
      // an active player always sits above a fighting one (more
      // valuable to the viewer for click-to-DM purposes).
      const order: Record<OnlinePlayer["status"], number> = {
        online: 0,
        in_marketplace: 1,
        in_fight: 2,
        idle: 3,
      };
      const sa = order[a.status];
      const sb = order[b.status];
      if (sa !== sb) return sa - sb;
      if (a.rating !== b.rating) return b.rating - a.rating;
      return a.name.localeCompare(b.name);
    });
  }
  if (options.hideEmpty) {
    return buckets.filter((b) => b.players.length > 0);
  }
  return buckets;
}

/** Pure helper — returns the bucket key for a given level. Mirrors
 *  the server. */
export function bucketKeyForLevel(level: number): string {
  for (const def of SIDEBAR_BUCKETS) {
    if (level >= def.minLevel && level <= def.maxLevel) return def.key;
  }
  return SIDEBAR_BUCKETS[0].key;
}
