"use client";

/**
 * Phase 2 v2 — Top navigation bar.
 *
 * Slackey wordmark with the COMBATS half in blood-red outlined in
 * parchment (matching the design tool's hero treatment). Bronze rim
 * separators between sections. Balance pill in bronze fill with the
 * Sui mark.
 */

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { Stamp } from "@/components/v2";
import { Wordmark } from "@/components/v2/wordmark";
import { isSoundEnabled, toggleSound } from "@/lib/sounds";
import { useState } from "react";

function formatSui(sui: number): string {
  if (sui === 0) return "0";
  if (sui < 0.01) return sui.toFixed(4);
  if (sui < 1) return sui.toFixed(3);
  return sui.toFixed(2);
}

export function Navbar() {
  const account = useCurrentAccount();
  const { state } = useGame();
  const { character } = state;
  const balance = useWalletBalance();
  const [sound, setSound] = useState(isSoundEnabled());

  return (
    <nav
      style={{
        background: "var(--sc-panel)",
        borderBottom: "2px solid var(--sc-bronze-deep)",
        position: "sticky",
        top: 0,
        zIndex: 40,
        boxShadow: "0 2px 0 0 rgba(0,0,0,0.4)",
      }}
    >
      <div
        style={{
          maxWidth: "var(--container-max)",
          margin: "0 auto",
          padding: "0 18px",
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Wordmark size="navbar" />
          {character && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                paddingLeft: 14,
                borderLeft: "1px solid var(--sc-rim-2)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 700,
                  color: "var(--sc-parchment)",
                }}
              >
                {character.name}
              </span>
              <Stamp tone="bronze">Lv {character.level}</Stamp>
              <Stamp tone="default" outline>
                {character.rating}
              </Stamp>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {account && (
            <span
              title={
                balance.error
                  ? `Balance fetch failed: ${balance.error}`
                  : `${balance.mist.toString()} MIST`
              }
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                fontSize: 12,
                padding: "5px 10px",
                background: "var(--sc-bronze)",
                color: "var(--sc-page)",
                border: "1px solid var(--sc-bronze-deep)",
                boxShadow: "var(--sh-plate-sm)",
                letterSpacing: "0.02em",
              }}
            >
              <span style={{ opacity: 0.7, fontWeight: 800 }}>SUI</span>
              <span>{balance.error ? "—" : formatSui(balance.sui)}</span>
            </span>
          )}
          <button
            onClick={() => setSound(toggleSound())}
            title={sound ? "Mute sounds" : "Enable sounds"}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--fg-3)",
              fontSize: 14,
              cursor: "pointer",
              padding: "4px 6px",
              fontFamily: "var(--font-ui)",
            }}
          >
            {sound ? "♪" : "♪̸"}
          </button>
          <span
            title={state.socket.connected ? "Connected" : "Disconnected"}
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              background: state.socket.connected
                ? "var(--rarity-uncommon)"
                : "var(--sc-blood)",
              boxShadow: state.socket.connected
                ? "0 0 6px var(--rarity-uncommon)"
                : "0 0 6px var(--sc-blood)",
            }}
          />
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
