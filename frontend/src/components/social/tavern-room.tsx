"use client";

/**
 * Phase 2 layout sweep — Tavern screen composition.
 *
 * Matches design_v2/screenshopts/Screenshot from 2026-05-13 14-01-17.png:
 *
 *   TopBanner "Tavern" + "Global chat, DMs, fight requests. Big Bad
 *   Claude is watching." subtitle + ON CHAIN bronze pill.
 *
 *   ThreeColumn:
 *     LEFT   — DIRECT MESSAGES sidebar (DMRow list)
 *     CENTER — "The Tavern" Slackey + global chat thread
 *     RIGHT  — ONLINE · N (OnlineRow list)
 *
 * The DmPanel + FightRequestToasts + PlayerProfileModal stay mounted
 * globally in game-screen.tsx so they persist across navigation.
 */

import { useMemo, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import {
  ScreenLayout,
  ThreeColumn,
  TopBanner,
  DMRow,
  OnlineRow,
} from "@/components/v2/layout";
import { Stamp } from "@/components/v2";
import { ChatPanel } from "./chat-panel";

function shortPreview(s: string | undefined, max = 32): string {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function TavernRoom() {
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
  const [activePeer, setActivePeer] = useState<string | null>(null);

  // Build the DM list from `state.dmChannels` + `state.onlinePlayers`.
  // For each channel, find the peer wallet (the participant that isn't
  // the local user) and look up their name in the online roster (falls
  // back to the truncated address when the peer isn't online right now).
  const dmList = useMemo(() => {
    if (!account) return [];
    const me = account.address.toLowerCase();
    return state.dmChannels.map((ch) => {
      const peer =
        ch.participantA.toLowerCase() === me
          ? ch.participantB
          : ch.participantA;
      const profile = state.onlinePlayers.find(
        (p) => p.walletAddress.toLowerCase() === peer.toLowerCase(),
      );
      const unread = state.dmUnreadByChannel[ch.channelId] ?? 0;
      return {
        channelId: ch.channelId,
        peerWallet: peer,
        peerName:
          profile?.name ??
          `${peer.slice(0, 6)}…${peer.slice(-4)}`,
        unread,
      };
    });
  }, [state.dmChannels, state.dmUnreadByChannel, state.onlinePlayers, account]);

  const onlineList = useMemo(() => {
    if (!account) return state.onlinePlayers;
    const me = account.address.toLowerCase();
    return state.onlinePlayers.filter(
      (p) => p.walletAddress.toLowerCase() !== me,
    );
  }, [state.onlinePlayers, account]);

  function openDm(peerWallet: string) {
    setActivePeer(peerWallet);
    dispatch({ type: "OPEN_DM", peerWallet });
  }

  function openProfile(walletAddress: string) {
    dispatch({ type: "OPEN_PROFILE", walletAddress });
  }

  /* LEFT — Direct Messages sidebar */
  const left = (
    <div
      style={{
        background: "var(--sc-panel)",
        border: "1px solid var(--sc-rim)",
        borderRadius: "var(--r-card)",
        boxShadow: "var(--rim-top), var(--rim-bottom)",
        height: 620,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--sc-rim)",
          background: "var(--sc-panel-2)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 800,
            fontSize: 11,
            letterSpacing: "var(--ls-stamp)",
            textTransform: "uppercase",
            color: "var(--sc-bronze)",
          }}
        >
          Direct Messages
        </span>
      </div>
      <div className="scroll-plate" style={{ flex: 1, overflowY: "auto" }}>
        {dmList.length === 0 ? (
          <p
            style={{
              color: "var(--fg-3)",
              fontSize: 12,
              textAlign: "center",
              padding: "20px 14px",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            No DMs yet. Click anyone in the Online list to start a chat.
          </p>
        ) : (
          dmList.map((dm) => (
            <DMRow
              key={dm.channelId}
              name={dm.peerName}
              preview={
                dm.unread > 0 ? `${dm.unread} new message${dm.unread === 1 ? "" : "s"}` : shortPreview("Tap to open thread")
              }
              unread={dm.unread}
              active={activePeer?.toLowerCase() === dm.peerWallet.toLowerCase()}
              onClick={() => openDm(dm.peerWallet)}
            />
          ))
        )}
      </div>
    </div>
  );

  /* CENTER — The Tavern global chat */
  const center = (
    <div
      style={{
        background: "var(--sc-panel)",
        border: "1px solid var(--sc-rim)",
        borderRadius: "var(--r-card)",
        boxShadow: "var(--rim-top), var(--rim-bottom)",
        height: 620,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
      }}
    >
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
        <div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              lineHeight: 1.05,
              color: "var(--sc-bronze)",
              letterSpacing: "0.01em",
            }}
          >
            The Tavern
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--fg-3)",
              letterSpacing: ".04em",
              textTransform: "uppercase",
              marginTop: 2,
            }}
          >
            Global · {state.onlinePlayers.length} online
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Stamp tone="uncommon">Live</Stamp>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatPanel />
      </div>
    </div>
  );

  /* RIGHT — Online sidebar */
  const right = (
    <div
      style={{
        background: "var(--sc-panel)",
        border: "1px solid var(--sc-rim)",
        borderRadius: "var(--r-card)",
        boxShadow: "var(--rim-top), var(--rim-bottom)",
        height: 620,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--sc-rim)",
          background: "var(--sc-panel-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 16,
            color: "var(--sc-bronze)",
          }}
        >
          Online · {onlineList.length}
        </span>
      </div>
      <div className="scroll-plate" style={{ flex: 1, overflowY: "auto" }}>
        {onlineList.length === 0 ? (
          <p
            style={{
              color: "var(--fg-3)",
              fontSize: 12,
              textAlign: "center",
              padding: "20px 14px",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            You're the only one here. Invite a friend.
          </p>
        ) : (
          onlineList.map((p) => (
            <OnlineRow
              key={p.walletAddress}
              name={p.name}
              level={p.level}
              online={p.status === "online" || p.status === "in_marketplace" || p.status === "in_fight"}
              onClick={() => openProfile(p.walletAddress)}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <ScreenLayout>
      <TopBanner
        title="Tavern"
        subtitle="Global chat, DMs, fight requests. Big Bad Claude is watching."
        pill="onChain"
        tone="bronze"
      />
      <ThreeColumn
        left={left}
        center={center}
        right={right}
        leftWidth={260}
        rightWidth={240}
      />
    </ScreenLayout>
  );
}
