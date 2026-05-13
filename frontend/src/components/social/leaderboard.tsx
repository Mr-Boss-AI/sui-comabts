"use client";

/**
 * Phase 2 v2 — Hall of Fame leaderboard.
 *
 * Bronze-rim panel with the title in Slackey display font. Filter row
 * uses V2Chip in tone-matched colours (level filters in steel,
 * build filters in archetype hues). Column headers in uppercase
 * weathered-bronze with sort indicators. Row hover lifts to gunmetal,
 * row click opens the v2 PlayerProfileModal.
 */

import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import {
  RimFrame,
  DisplayTitle,
  Stamp,
  V2Chip,
  V2Input,
  SectionLabel,
  GhostButton,
  BronzeButton,
} from "@/components/v2";
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
} from "@/lib/hall-of-fame-display";

const COLUMN_LABELS: Record<SortKey, string> = {
  rank: "#",
  level: "Lv",
  rating: "Rating",
  wins: "W",
  losses: "L",
  winRate: "Win%",
};

const BUILD_COLOR: Record<ReturnType<typeof classifyBuild>, string> = {
  crit: "var(--sc-blood)",
  evasion: "var(--sc-steel)",
  tank: "var(--sc-bronze)",
  hybrid: "var(--fg-3)",
};
const BUILD_LABEL: Record<ReturnType<typeof classifyBuild>, string> = {
  crit: "Crit",
  evasion: "Eva",
  tank: "Tank",
  hybrid: "Hyb",
};
const BUILD_TONE: Record<BuildFilter, "blood" | "steel" | "bronze"> = {
  all: "bronze",
  crit: "blood",
  evasion: "steel",
  tank: "bronze",
  hybrid: "steel",
};

function rankColorVar(rank: number): string {
  if (rank === 1) return "var(--sc-bronze-glow)";
  if (rank === 2) return "var(--sc-parchment)";
  if (rank === 3) return "var(--sc-bronze-deep)";
  return "var(--fg-3)";
}

export function Leaderboard() {
  const { state, dispatch } = useGame();
  const { leaderboard, socket } = state;
  const [loaded, setLoaded] = useState(false);

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
  const sorted = useMemo(() => sortLeaderboard(filtered, sort), [filtered, sort]);
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

  const isLoading = !loaded || (leaderboard.length === 0 && !loaded);
  const isEmptyOverall = loaded && leaderboard.length === 0;
  const isEmptyAfterFilter = !isEmptyOverall && filtered.length === 0;

  return (
    <RimFrame padless>
      {/* Header */}
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--sc-rim)",
          background: "var(--sc-panel-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <DisplayTitle size="md">Hall of Fame — Top Fighters</DisplayTitle>
        <Stamp tone="bronze">{leaderboard.length} ranked</Stamp>
      </div>

      <div style={{ padding: 14 }}>
        {/* Filters */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14 }}>
          <V2Input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%" }}
          />
          <div>
            <SectionLabel>Level</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {LEVEL_BUCKET_OPTIONS.map((opt) => {
                const range =
                  opt.key === "all"
                    ? ""
                    : ` Lv ${opt.minLevel}${opt.maxLevel < 99 ? `-${opt.maxLevel}` : "+"}`;
                return (
                  <V2Chip
                    key={opt.key}
                    active={levelFilter === opt.key}
                    tone="steel"
                    count={levelCounts[opt.key] ?? 0}
                    onClick={() => setLevelFilter(opt.key)}
                  >
                    {opt.label}
                    {range && <span style={{ color: "var(--fg-3)" }}>{range}</span>}
                  </V2Chip>
                );
              })}
            </div>
          </div>
          <div>
            <SectionLabel>Build</SectionLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {BUILD_FILTER_OPTIONS.map((opt) => (
                <V2Chip
                  key={opt.key}
                  active={buildFilter === opt.key}
                  tone={BUILD_TONE[opt.key]}
                  count={builds[opt.key] ?? 0}
                  onClick={() => setBuildFilter(opt.key)}
                >
                  {opt.label}
                </V2Chip>
              ))}
            </div>
          </div>
        </div>

        {/* Body */}
        {isLoading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 40,
              gap: 12,
              color: "var(--fg-3)",
              fontSize: 12,
            }}
          >
            <span
              style={{
                width: 16,
                height: 16,
                borderRadius: 999,
                border: "2px solid var(--sc-rim-2)",
                borderTopColor: "var(--sc-bronze)",
                animation: "spin 1s linear infinite",
              }}
            />
            <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
            Loading leaderboard…
          </div>
        )}
        {isEmptyOverall && (
          <p style={{ color: "var(--fg-3)", fontSize: 13, textAlign: "center", padding: "32px 0", fontStyle: "italic" }}>
            No fighters yet — win a battle to claim your spot.
          </p>
        )}
        {isEmptyAfterFilter && (
          <p style={{ color: "var(--fg-3)", fontSize: 13, textAlign: "center", padding: "32px 0", fontStyle: "italic" }}>
            No fighters match your filters.
          </p>
        )}

        {!isLoading && !isEmptyOverall && !isEmptyAfterFilter && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: "var(--font-ui)",
                }}
              >
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--sc-bronze-deep)" }}>
                    <SortHeader column="rank" sort={sort} onClick={clickHeader} align="left" width={48} />
                    <th
                      style={{
                        padding: "8px 4px",
                        textAlign: "left",
                        color: "var(--fg-3)",
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "var(--ls-stamp)",
                        textTransform: "uppercase",
                      }}
                    >
                      Name
                    </th>
                    <SortHeader column="level" sort={sort} onClick={clickHeader} align="right" />
                    <th
                      style={{
                        padding: "8px 4px",
                        textAlign: "right",
                        color: "var(--fg-3)",
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "var(--ls-stamp)",
                        textTransform: "uppercase",
                      }}
                    >
                      Build
                    </th>
                    <SortHeader column="rating" sort={sort} onClick={clickHeader} align="right" />
                    <SortHeader column="wins" sort={sort} onClick={clickHeader} align="right" />
                    <SortHeader column="losses" sort={sort} onClick={clickHeader} align="right" />
                    <SortHeader column="winRate" sort={sort} onClick={clickHeader} align="right" />
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
                        style={{
                          borderBottom: "1px solid var(--sc-rim)",
                          cursor: "pointer",
                          transition: "background var(--d-fast)",
                          fontSize: 13,
                          color: "var(--sc-parchment)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "var(--sc-panel-2)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <td
                          style={{
                            padding: "8px 4px",
                            color: rankColorVar(entry.rank),
                            fontWeight: entry.rank <= 3 ? 800 : 700,
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {entry.rank}
                        </td>
                        <td style={{ padding: "8px 4px", fontWeight: 700 }}>{entry.name}</td>
                        <td
                          style={{
                            padding: "8px 4px",
                            textAlign: "right",
                            color: "var(--fg-3)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {entry.level}
                        </td>
                        <td style={{ padding: "8px 4px", textAlign: "right" }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              color: BUILD_COLOR[build],
                            }}
                            title={`${build} build`}
                          >
                            {BUILD_LABEL[build]}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "8px 4px",
                            textAlign: "right",
                            color: "var(--sc-bronze)",
                            fontFamily: "var(--font-mono)",
                            fontWeight: 700,
                          }}
                        >
                          {entry.rating}
                        </td>
                        <td
                          style={{
                            padding: "8px 4px",
                            textAlign: "right",
                            color: "var(--rarity-uncommon)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {entry.wins}
                        </td>
                        <td
                          style={{
                            padding: "8px 4px",
                            textAlign: "right",
                            color: "var(--sc-blood)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {entry.losses}
                        </td>
                        <td
                          style={{
                            padding: "8px 4px",
                            textAlign: "right",
                            color: "var(--sc-parchment)",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          {winPct}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 12,
                fontSize: 11,
                color: "var(--fg-3)",
              }}
            >
              <span>
                Showing <span style={{ color: "var(--sc-parchment)", fontWeight: 700 }}>{view.totalShown}</span> of{" "}
                <span style={{ color: "var(--sc-parchment)", fontWeight: 700 }}>{view.totalAvailable}</span>
              </span>
              {view.hasMore ? (
                <BronzeButton size="sm" onClick={() => setPage((p) => p + 1)}>
                  Load more
                </BronzeButton>
              ) : (
                <GhostButton size="sm" disabled>
                  All loaded
                </GhostButton>
              )}
            </div>
          </>
        )}
      </div>
    </RimFrame>
  );
}

function SortHeader({
  column,
  sort,
  onClick,
  align,
  width,
}: {
  column: SortKey;
  sort: SortState;
  onClick: (key: SortKey) => void;
  align: "left" | "right";
  width?: number;
}) {
  const indicator = sortIndicator(sort, column);
  const isActive = sort.key === column;
  return (
    <th
      style={{
        padding: "8px 4px",
        textAlign: align,
        width: width ? `${width}px` : undefined,
      }}
    >
      <button
        onClick={() => onClick(column)}
        title={`Sort by ${COLUMN_LABELS[column]}`}
        style={{
          background: "transparent",
          border: 0,
          padding: 0,
          fontFamily: "var(--font-ui)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "var(--ls-stamp)",
          textTransform: "uppercase",
          color: isActive ? "var(--sc-bronze)" : "var(--fg-3)",
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          transition: "color var(--d-fast)",
        }}
      >
        {COLUMN_LABELS[column]}
        <span
          style={{
            display: "inline-block",
            width: 8,
            textAlign: "right",
            color: "var(--sc-bronze)",
            fontSize: 10,
          }}
        >
          {indicator}
        </span>
      </button>
    </th>
  );
}
