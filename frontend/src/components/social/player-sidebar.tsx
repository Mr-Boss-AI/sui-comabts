"use client";

/**
 * Phase 2 v2 — Tavern player sidebar.
 *
 * Players grouped by level bracket (Novice / Early / Mid / High /
 * Endgame / Hall of Fame). Each row shows: status dot · name · level ·
 * rating · current room. Clicking the row opens the PlayerProfileModal.
 *
 * Visual treatment:
 *   - Bronze "X online" stamp at the top
 *   - V2Input search with bronze focus
 *   - V2Chip status filter row (steel-blue when active)
 *   - Bucket headers in steel-blue uppercase with bronze count
 *   - Rows with rarity-coloured online dot, parchment name, weathered
 *     bronze rating, unread DM cyan pip
 */

import { useMemo, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Stamp, V2Chip, V2Input } from "@/components/v2";
import {
  groupPlayersForSidebar,
  type SidebarBucket,
} from "@/lib/player-bucket";
import type { OnlinePlayer } from "@/types/game";

const STATUS_COLORS: Record<OnlinePlayer["status"], string> = {
  online: "var(--rarity-uncommon)",
  in_fight: "var(--sc-blood)",
  in_marketplace: "var(--sc-bronze)",
  idle: "var(--fg-3)",
};

const STATUS_LABELS: Record<OnlinePlayer["status"], string> = {
  online: "Online",
  in_fight: "Fighting",
  in_marketplace: "Shopping",
  idle: "Idle",
};

const ROOM_BADGE: Record<NonNullable<OnlinePlayer["currentRoom"]>, string> = {
  tavern: "Tavern",
  character: "Inventory",
  arena: "Arena",
  marketplace: "Market",
  hall_of_fame: "HoF",
  fight: "Fight",
};

const FILTERS: Array<{
  key: "all" | "online" | "in_fight" | "in_marketplace" | "idle";
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "online", label: "Online" },
  { key: "in_fight", label: "Fighting" },
  { key: "in_marketplace", label: "Shopping" },
  { key: "idle", label: "Idle" },
];

export function PlayerSidebar() {
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");

  const buckets: SidebarBucket[] = useMemo(() => {
    return groupPlayersForSidebar(state.onlinePlayers, {
      hideEmpty: true,
      exclude: account ? [account.address] : [],
      search,
      statusFilter: filter === "all" ? undefined : [filter],
    });
  }, [state.onlinePlayers, account, search, filter]);

  const totalShown = buckets.reduce((acc, b) => acc + b.players.length, 0);

  const unreadByPeerWallet = useMemo(() => {
    if (!account) return new Map<string, number>();
    const me = account.address.toLowerCase();
    const out = new Map<string, number>();
    for (const ch of state.dmChannels) {
      const peer = ch.participantA === me ? ch.participantB : ch.participantA;
      const count = state.dmUnreadByChannel[ch.channelId] ?? 0;
      if (count > 0) {
        out.set(
          peer.toLowerCase(),
          (out.get(peer.toLowerCase()) ?? 0) + count,
        );
      }
    }
    return out;
  }, [state.dmChannels, state.dmUnreadByChannel, account]);

  function openProfile(player: OnlinePlayer) {
    dispatch({ type: "OPEN_PROFILE", walletAddress: player.walletAddress });
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--sc-panel)",
        fontFamily: "var(--font-ui)",
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid var(--sc-rim)",
          padding: "10px 12px",
          background: "var(--sc-panel-2)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: ".08em",
              textTransform: "uppercase",
              color: "var(--sc-parchment)",
            }}
          >
            Players
          </span>
          <Stamp tone="bronze">{state.onlinePlayers.length} online</Stamp>
        </div>
        <V2Input
          type="text"
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", marginBottom: 8 }}
        />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {FILTERS.map((f) => (
            <V2Chip
              key={f.key}
              active={filter === f.key}
              tone={
                f.key === "in_fight"
                  ? "blood"
                  : f.key === "in_marketplace"
                    ? "bronze"
                    : "steel"
              }
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </V2Chip>
          ))}
        </div>
      </div>

      {/* Body */}
      <div
        className="scroll-plate"
        style={{ flex: 1, overflowY: "auto", minHeight: 0 }}
      >
        {totalShown === 0 && (
          <p
            style={{
              color: "var(--fg-3)",
              fontSize: 12,
              textAlign: "center",
              padding: "20px 12px",
              fontStyle: "italic",
            }}
          >
            No players match your filters.
          </p>
        )}
        {buckets.map((bucket) => (
          <div
            key={bucket.key}
            style={{ borderBottom: "1px solid var(--sc-rim)" }}
          >
            <div
              style={{
                padding: "4px 12px",
                background: "rgba(0,0,0,.25)",
                borderBottom: "1px solid var(--sc-rim)",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "var(--ls-stamp)",
                  textTransform: "uppercase",
                  color: "var(--sc-steel)",
                }}
              >
                {bucket.label}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--fg-3)",
                }}
              >
                Lv {bucket.minLevel}
                {bucket.maxLevel < 99 ? `-${bucket.maxLevel}` : "+"}
              </span>
              <span style={{ flex: 1 }} />
              <Stamp tone="default" outline>
                {bucket.players.length}
              </Stamp>
            </div>
            {bucket.players.map((player) => (
              <PlayerRow
                key={player.walletAddress}
                player={player}
                unreadCount={
                  unreadByPeerWallet.get(player.walletAddress.toLowerCase()) ?? 0
                }
                onClick={() => openProfile(player)}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function PlayerRow({
  player,
  unreadCount,
  onClick,
}: {
  player: OnlinePlayer;
  unreadCount: number;
  onClick: () => void;
}) {
  const hasUnread = unreadCount > 0;
  return (
    <button
      onClick={onClick}
      title={
        hasUnread
          ? `${player.name} · ${STATUS_LABELS[player.status]} · ${unreadCount} unread DM${unreadCount === 1 ? "" : "s"}`
          : `${player.name} · ${STATUS_LABELS[player.status]}`
      }
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 12px",
        background: hasUnread ? "rgba(109,143,163,0.10)" : "transparent",
        border: 0,
        borderBottom: "1px solid rgba(44,51,61,0.6)",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        transition: "background var(--d-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--sc-panel-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = hasUnread
          ? "rgba(109,143,163,0.10)"
          : "transparent";
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: STATUS_COLORS[player.status],
          flexShrink: 0,
          boxShadow:
            player.status === "online"
              ? "0 0 6px var(--rarity-uncommon)"
              : undefined,
        }}
        aria-label={STATUS_LABELS[player.status]}
      />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: hasUnread ? 800 : 700,
              color: hasUnread ? "var(--sc-steel)" : "var(--sc-parchment)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              flex: 1,
            }}
          >
            {player.name}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--fg-3)",
              flexShrink: 0,
            }}
          >
            Lv.{player.level}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
            color: "var(--fg-3)",
          }}
        >
          <span style={{ color: "var(--sc-bronze)", fontFamily: "var(--font-mono)" }}>
            {player.rating}
          </span>
          {player.currentRoom && player.currentRoom !== "tavern" && (
            <>
              <span style={{ color: "var(--sc-rim-2)" }}>·</span>
              <span style={{ color: "var(--fg-3)" }}>
                {ROOM_BADGE[player.currentRoom]}
              </span>
            </>
          )}
        </div>
      </div>
      {hasUnread && (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 18,
            height: 18,
            padding: "0 6px",
            borderRadius: 999,
            background: "var(--sc-steel)",
            color: "var(--sc-page)",
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            fontWeight: 800,
            lineHeight: 1,
            flexShrink: 0,
          }}
          aria-label={`${unreadCount} unread DMs`}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );
}
