"use client";

/**
 * Phase 2 layout sweep — Hall of Fame composition.
 *
 * Matches design_v2/screenshopts/Screenshot from 2026-05-13 14-01-04.png
 * (Hall of Fame variant in the design tool):
 *
 *   TopBanner "Hall of Fame" + "Leaderboard by ELO. Top 3 get the
 *   podium." subtitle + V5·TESTNET red pill.
 *
 *   Podium row — #2 parchment · #1 bronze (with crown) · #3 blood-red,
 *   sized respectively 180 / 240 / 140 px tall, all with chunky
 *   tier-coloured borders.
 *
 *   Ladder card below — "Ladder" Slackey + "BY ELO · 7-DAY" stamp on
 *   the right. Filter chip rows (level + build), sort-arrow column
 *   headers, rank rows; current user's row highlighted bronze.
 *   "Load more" footer pagination.
 */

import { useEffect, useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import {
  BronzeButton,
  GhostButton,
  SectionLabel,
  Stamp,
  V2Chip,
  V2Input,
} from "@/components/v2";
import {
  PodiumBlock,
  ScreenLayout,
  TopBanner,
  SectionHeader,
} from "@/components/v2/layout";
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
import type { LeaderboardEntry } from "@/types/game";

const COLUMN_LABELS: Record<SortKey, string> = {
  rank: "#",
  level: "Lv",
  rating: "ELO",
  // v5.1 — combined W/L/D column. Sort key `wins` is the primary anchor
  // (the column is sorted by W asc/desc); the L and D are shown
  // alongside for full record visibility. The column header reads
  // "W/L/D" but the SortKey vocabulary doesn't include `draws` because
  // sorting by draws alone has no useful order (mutual KOs are
  // recorded but aren't a meaningful "best player" axis on their own).
  wins: "W/L/D",
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
  const account = useCurrentAccount();
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

  const levelCounts = useMemo(() => levelBucketCounts(leaderboard), [leaderboard]);
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

  // Top 3 by raw ELO from the entire leaderboard (regardless of
  // filters — the podium is the "all-time" headline, not a filter
  // result). Source is the leaderboard pre-filter sorted by rating
  // desc, which is what `getLeaderboard` returns.
  const top3 = useMemo(() => {
    const sortedAll = sortLeaderboard(leaderboard, { key: "rating", dir: "desc" });
    return sortedAll.slice(0, 3);
  }, [leaderboard]);

  const myAddr = account?.address?.toLowerCase();
  const isLoading = !loaded || (leaderboard.length === 0 && !loaded);
  const isEmptyOverall = loaded && leaderboard.length === 0;
  const isEmptyAfterFilter = !isEmptyOverall && filtered.length === 0;

  return (
    <ScreenLayout>
      <TopBanner
        title="Hall of Fame"
        subtitle="Leaderboard by ELO. Top 3 get the podium."
        pill="testnet"
        tone="blood"
      />

      {/* ── Podium row ────────────────────────────────────────────── */}
      {top3.length > 0 && (
        <div
          style={{
            background: "var(--sc-panel)",
            border: "1px solid var(--sc-rim)",
            borderRadius: "var(--r-card)",
            boxShadow: "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)",
            padding: "32px 24px 24px",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 18,
              alignItems: "end",
              maxWidth: 760,
              margin: "0 auto",
            }}
          >
            {/* Order on the row: 2nd | 1st | 3rd (per design spec). */}
            {top3[1] && (
              <PodiumBlock
                rank={2}
                name={top3[1].name}
                level={top3[1].level}
                rating={top3[1].rating}
                onClick={() => openProfile(top3[1].walletAddress)}
              />
            )}
            {top3[0] && (
              <PodiumBlock
                rank={1}
                name={top3[0].name}
                level={top3[0].level}
                rating={top3[0].rating}
                onClick={() => openProfile(top3[0].walletAddress)}
              />
            )}
            {top3[2] && (
              <PodiumBlock
                rank={3}
                name={top3[2].name}
                level={top3[2].level}
                rating={top3[2].rating}
                onClick={() => openProfile(top3[2].walletAddress)}
              />
            )}
          </div>
        </div>
      )}

      {/* ── Ladder card ───────────────────────────────────────────── */}
      <div
        style={{
          background: "var(--sc-panel)",
          border: "1px solid var(--sc-rim)",
          borderRadius: "var(--r-card)",
          boxShadow: "var(--sh-plate), var(--rim-top), var(--rim-bottom)",
          padding: 22,
        }}
      >
        <SectionHeader
          title="Ladder"
          size="lg"
          right={<Stamp tone="default" outline>By ELO · 7-Day</Stamp>}
        />

        {/* Filter strip */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
          <V2Input
            type="text"
            placeholder="Search by name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: "100%", maxWidth: 360 }}
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
          <p
            style={{
              color: "var(--fg-3)",
              fontSize: 13,
              textAlign: "center",
              padding: "32px 0",
              fontStyle: "italic",
            }}
          >
            No fighters yet — win a battle to claim your spot.
          </p>
        )}
        {isEmptyAfterFilter && (
          <p
            style={{
              color: "var(--fg-3)",
              fontSize: 13,
              textAlign: "center",
              padding: "32px 0",
              fontStyle: "italic",
            }}
          >
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
                    <SortHeader column="rank" sort={sort} onClick={clickHeader} align="left" width={56} />
                    <th
                      style={{
                        padding: "10px 6px",
                        textAlign: "left",
                        color: "var(--fg-3)",
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "var(--ls-stamp)",
                        textTransform: "uppercase",
                      }}
                    >
                      Fighter
                    </th>
                    <SortHeader column="level" sort={sort} onClick={clickHeader} align="right" />
                    <SortHeader column="rating" sort={sort} onClick={clickHeader} align="right" />
                    <th
                      style={{
                        padding: "10px 6px",
                        textAlign: "right",
                        color: "var(--fg-3)",
                        fontSize: 10,
                        fontWeight: 800,
                        letterSpacing: "var(--ls-stamp)",
                        textTransform: "uppercase",
                      }}
                    >
                      W / L / D
                    </th>
                    <SortHeader column="winRate" sort={sort} onClick={clickHeader} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {view.visible.map((entry) => (
                    <LadderRow
                      key={`${entry.walletAddress}-${entry.rank}`}
                      entry={entry}
                      isMe={
                        myAddr !== undefined &&
                        entry.walletAddress.toLowerCase() === myAddr
                      }
                      onClick={() => openProfile(entry.walletAddress)}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 14,
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
    </ScreenLayout>
  );
}

function LadderRow({
  entry,
  isMe,
  onClick,
}: {
  entry: LeaderboardEntry;
  isMe: boolean;
  onClick: () => void;
}) {
  const winPct = formatWinRatePct(entry.wins, entry.losses, entry.draws);
  const build = classifyBuild(entry.stats);
  return (
    <tr
      onClick={onClick}
      title={`View ${entry.name}'s profile`}
      style={{
        borderBottom: "1px solid var(--sc-rim)",
        cursor: "pointer",
        transition: "background var(--d-fast)",
        fontSize: 13,
        color: "var(--sc-parchment)",
        background: isMe ? "rgba(200,154,63,0.18)" : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isMe) e.currentTarget.style.background = "var(--sc-panel-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = isMe ? "rgba(200,154,63,0.18)" : "transparent";
      }}
    >
      <td
        style={{
          padding: "10px 6px",
          color: rankColorVar(entry.rank),
          fontWeight: entry.rank <= 3 ? 800 : 700,
          fontFamily: "var(--font-mono)",
        }}
      >
        #{entry.rank}
      </td>
      <td style={{ padding: "10px 6px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              width: 28,
              height: 28,
              background: "var(--sc-panel-2)",
              border: "1px solid var(--sc-rim-2)",
              borderRadius: 2,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-display)",
              color: BUILD_COLOR[build],
              fontSize: 13,
              flexShrink: 0,
            }}
            aria-hidden
          >
            {entry.name.charAt(0)}
          </span>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontWeight: 700, color: "var(--sc-parchment)" }}>
              {entry.name}
              {isMe && (
                <span
                  style={{
                    marginLeft: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--sc-bronze)",
                    letterSpacing: "0.04em",
                  }}
                >
                  · you
                </span>
              )}
            </span>
            <span
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 9,
                color: BUILD_COLOR[build],
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              {BUILD_LABEL[build]}
            </span>
          </div>
        </div>
      </td>
      <td
        style={{
          padding: "10px 6px",
          textAlign: "right",
        }}
      >
        <span
          style={{
            display: "inline-block",
            fontFamily: "var(--font-mono)",
            fontWeight: 700,
            fontSize: 10,
            padding: "3px 8px",
            background: "var(--sc-page)",
            color: "var(--sc-bronze)",
            border: "1px solid var(--sc-bronze)",
            borderRadius: "var(--r-pill)",
          }}
        >
          Lv {entry.level}
        </span>
      </td>
      <td
        style={{
          padding: "10px 6px",
          textAlign: "right",
          color: "var(--sc-bronze)",
          fontFamily: "var(--font-mono)",
          fontWeight: 800,
          fontSize: 14,
        }}
      >
        {entry.rating}
      </td>
      <td
        style={{
          padding: "10px 6px",
          textAlign: "right",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
      >
        <span style={{ color: "var(--rarity-uncommon)" }}>{entry.wins}</span>
        <span style={{ color: "var(--sc-rim-2)", margin: "0 4px" }}>/</span>
        <span style={{ color: "var(--sc-blood)" }}>{entry.losses}</span>
        <span style={{ color: "var(--sc-rim-2)", margin: "0 4px" }}>/</span>
        {/* v5.1 — Draws render in neutral parchment, matching the
            FightResultModal "DRAW" treatment (no win-green, no
            loss-red). A mutual KO isn't a defeat or a victory. */}
        <span style={{ color: "var(--sc-parchment)" }}>{entry.draws}</span>
      </td>
      <td
        style={{
          padding: "10px 6px",
          textAlign: "right",
          color: "var(--sc-parchment)",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
        }}
      >
        {winPct}%
      </td>
    </tr>
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
        padding: "10px 6px",
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
