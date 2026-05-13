"use client";

/**
 * Hall of Fame leaderboard — Bucket 3 #2.
 *
 * Replaces the legacy flat table with:
 *   • Sort toggles on every column (Rank / Name / Lv / Rating / W / L /
 *     Win%). Clicking the active column flips direction; clicking a
 *     different column switches with that column's natural default.
 *   • Filter row — level bucket chips (matches Tavern's SIDEBAR_BUCKETS)
 *     + build classifier chips (Crit / Evasion / Tank / Hybrid) + a
 *     search box.
 *   • Live chip counts so the player sees how many entries match.
 *   • Click-through to the existing PlayerProfileModal — same component
 *     the Tavern sidebar uses; we just dispatch OPEN_PROFILE.
 *   • Pagination — 20 rows per page, "Load more" button below the table.
 *     No infinite scroll.
 *   • Empty + loading states.
 *
 * Pure helpers live in `lib/hall-of-fame-{sort,filter,display}.ts` so
 * the rendering logic is covered by `qa-hall-of-fame.ts`.
 */

import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  DEFAULT_DIR,
  nextSortState,
  sortIndicator,
  sortLeaderboard,
  type SortKey,
  type SortState,
} from "@/lib/hall-of-fame-sort";
import {
  BUILD_FILTER_OPTIONS,
  LEVEL_BUCKET_OPTIONS,
  buildCounts,
  classifyBuild,
  filterEntries,
  levelBucketCounts,
  type BuildFilter,
  type FilterState,
  type LevelFilter,
} from "@/lib/hall-of-fame-filter";
import {
  PAGE_SIZE,
  formatWinRatePct,
  paginateEntries,
  rankColor,
} from "@/lib/hall-of-fame-display";

const COLUMN_LABELS: Record<SortKey, string> = {
  rank: "#",
  level: "Level",
  rating: "Rating",
  wins: "W",
  losses: "L",
  winRate: "Win%",
};

const BUILD_BADGE_COLOR: Record<ReturnType<typeof classifyBuild>, string> = {
  crit: "text-red-400",
  evasion: "text-cyan-400",
  tank: "text-amber-400",
  hybrid: "text-zinc-400",
};

const BUILD_BADGE_LABEL: Record<ReturnType<typeof classifyBuild>, string> = {
  crit: "Crit",
  evasion: "Eva",
  tank: "Tank",
  hybrid: "Hyb",
};

export function Leaderboard() {
  const { state, dispatch } = useGame();
  const { leaderboard, socket } = state;
  const [loaded, setLoaded] = useState(false);

  // Sort + filter + pagination state.
  const [sort, setSort] = useState<SortState>({
    key: "rating",
    dir: DEFAULT_DIR.rating,
  });
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [buildFilter, setBuildFilter] = useState<BuildFilter>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (socket.connected) {
      socket.send({ type: "get_leaderboard" });
      setLoaded(true);
    }
  }, [socket.connected, socket]);

  // Reset pagination when the filter changes — otherwise a player at
  // page 3 of a 60-row list would see an empty body after filtering
  // down to 10 rows.
  useEffect(() => {
    setPage(1);
  }, [levelFilter, buildFilter, search]);

  const filterState: FilterState = useMemo(
    () => ({ level: levelFilter, build: buildFilter, search }),
    [levelFilter, buildFilter, search],
  );

  const levelCounts = useMemo(
    () => levelBucketCounts(leaderboard),
    [leaderboard],
  );
  const builds = useMemo(() => buildCounts(leaderboard), [leaderboard]);

  const filtered = useMemo(
    () => filterEntries(leaderboard, filterState),
    [leaderboard, filterState],
  );
  const sorted = useMemo(
    () => sortLeaderboard(filtered, sort),
    [filtered, sort],
  );
  const view = useMemo(
    () => paginateEntries(sorted, { currentPage: page, pageSize: PAGE_SIZE }),
    [sorted, page],
  );

  function clickHeader(key: SortKey) {
    setSort((prev) => nextSortState(prev, key));
  }

  function openProfile(walletAddress: string) {
    dispatch({ type: "OPEN_PROFILE", walletAddress });
  }

  // Initial loading state — server hasn't replied to get_leaderboard yet.
  const isLoading = !loaded || (leaderboard.length === 0 && !loaded);
  const isEmptyOverall = loaded && leaderboard.length === 0;
  const isEmptyAfterFilter = !isEmptyOverall && filtered.length === 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="font-semibold">Hall of Fame — Top Fighters</span>
          <span className="text-[11px] text-zinc-500">
            {leaderboard.length} ranked
          </span>
        </div>
      </CardHeader>
      <CardBody>
        {/* === Filter row === */}
        <div className="space-y-2 mb-3">
          <input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          />
          <div>
            <div className="text-[10px] uppercase tracking-widest text-amber-700/80 font-bold mb-1">
              Level
            </div>
            <div className="flex flex-wrap gap-1">
              {LEVEL_BUCKET_OPTIONS.map((opt) => {
                const count = levelCounts[opt.key] ?? 0;
                const range =
                  opt.key === "all"
                    ? ""
                    : ` Lv ${opt.minLevel}${
                        opt.maxLevel < 99 ? `-${opt.maxLevel}` : "+"
                      }`;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setLevelFilter(opt.key)}
                    className={`text-[11px] px-2 py-0.5 rounded font-medium transition-colors ${
                      levelFilter === opt.key
                        ? "bg-amber-700/40 text-amber-200 border border-amber-600"
                        : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
                    }`}
                  >
                    {opt.label}
                    {range && (
                      <span className="text-zinc-600">
                        {" "}
                        ·{range}
                      </span>
                    )}
                    <span className="ml-1 text-zinc-600">· {count}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-amber-700/80 font-bold mb-1">
              Build
            </div>
            <div className="flex flex-wrap gap-1">
              {BUILD_FILTER_OPTIONS.map((opt) => {
                const count = builds[opt.key] ?? 0;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setBuildFilter(opt.key)}
                    className={`text-[11px] px-2 py-0.5 rounded font-medium transition-colors ${
                      buildFilter === opt.key
                        ? "bg-emerald-700/40 text-emerald-200 border border-emerald-600"
                        : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
                    }`}
                  >
                    {opt.label}
                    <span className="ml-1 text-zinc-600">· {count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* === Body === */}
        {isLoading && (
          <div className="flex items-center justify-center py-10 text-sm text-zinc-500">
            <div className="h-5 w-5 rounded-full border-2 border-zinc-700 border-t-emerald-400 animate-spin mr-3" />
            Loading leaderboard…
          </div>
        )}

        {isEmptyOverall && (
          <p className="text-zinc-500 text-sm text-center py-8">
            No fighters yet — win a battle to claim your spot!
          </p>
        )}

        {isEmptyAfterFilter && (
          <p className="text-zinc-500 text-sm text-center py-8">
            No fighters match your filters.
          </p>
        )}

        {!isLoading && !isEmptyOverall && !isEmptyAfterFilter && (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 text-xs uppercase border-b border-zinc-800">
                    <SortHeader
                      column="rank"
                      sort={sort}
                      onClick={clickHeader}
                      align="left"
                      width="w-10"
                    >
                      #
                    </SortHeader>
                    <th className="py-2 text-left">Name</th>
                    <SortHeader
                      column="level"
                      sort={sort}
                      onClick={clickHeader}
                      align="right"
                    >
                      Lv
                    </SortHeader>
                    <th className="py-2 text-right text-[10px]">Build</th>
                    <SortHeader
                      column="rating"
                      sort={sort}
                      onClick={clickHeader}
                      align="right"
                    >
                      Rating
                    </SortHeader>
                    <SortHeader
                      column="wins"
                      sort={sort}
                      onClick={clickHeader}
                      align="right"
                    >
                      W
                    </SortHeader>
                    <SortHeader
                      column="losses"
                      sort={sort}
                      onClick={clickHeader}
                      align="right"
                    >
                      L
                    </SortHeader>
                    <SortHeader
                      column="winRate"
                      sort={sort}
                      onClick={clickHeader}
                      align="right"
                    >
                      Win%
                    </SortHeader>
                  </tr>
                </thead>
                <tbody>
                  {view.visible.map((entry) => {
                    const winPct = formatWinRatePct(entry.wins, entry.losses);
                    const build = classifyBuild(entry.stats);
                    return (
                      <tr
                        key={`${entry.walletAddress}-${entry.rank}`}
                        onClick={() => openProfile(entry.walletAddress)}
                        title={`View ${entry.name}'s profile`}
                        className="border-b border-zinc-800/50 hover:bg-zinc-800/40 cursor-pointer transition-colors"
                      >
                        <td className="py-2">
                          <span className={rankColor(entry.rank)}>
                            {entry.rank}
                          </span>
                        </td>
                        <td className="py-2 font-medium text-zinc-100">
                          {entry.name}
                        </td>
                        <td className="py-2 text-right text-zinc-400">
                          {entry.level}
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={`text-[10px] font-bold ${BUILD_BADGE_COLOR[build]}`}
                            title={`${build} build`}
                          >
                            {BUILD_BADGE_LABEL[build]}
                          </span>
                        </td>
                        <td className="py-2 text-right text-amber-400 font-mono">
                          {entry.rating}
                        </td>
                        <td className="py-2 text-right text-emerald-400">
                          {entry.wins}
                        </td>
                        <td className="py-2 text-right text-red-400">
                          {entry.losses}
                        </td>
                        <td className="py-2 text-right text-zinc-300">
                          {winPct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* === Pagination === */}
            <div className="flex items-center justify-between mt-3 text-xs text-zinc-500">
              <span>
                Showing {view.totalShown} of {view.totalAvailable}
              </span>
              {view.hasMore && (
                <button
                  onClick={() => setPage((p) => p + 1)}
                  className="px-3 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:border-amber-700/40 hover:text-amber-300 transition-colors text-xs font-medium"
                >
                  Load more
                </button>
              )}
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function SortHeader({
  column,
  sort,
  onClick,
  align,
  width,
  children,
}: {
  column: SortKey;
  sort: SortState;
  onClick: (key: SortKey) => void;
  align: "left" | "right";
  width?: string;
  children: React.ReactNode;
}) {
  const indicator = sortIndicator(sort, column);
  const isActive = sort.key === column;
  const alignCls = align === "right" ? "text-right" : "text-left";
  return (
    <th className={`py-2 ${alignCls} ${width ?? ""}`}>
      <button
        onClick={() => onClick(column)}
        title={`Sort by ${COLUMN_LABELS[column]}`}
        className={`inline-flex items-center gap-1 hover:text-zinc-100 transition-colors uppercase text-xs ${
          isActive ? "text-amber-300" : "text-zinc-500"
        }`}
      >
        {children}
        <span className="text-[10px] w-2 inline-block text-right">
          {indicator}
        </span>
      </button>
    </th>
  );
}
