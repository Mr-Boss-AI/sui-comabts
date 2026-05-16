"use client";

/**
 * Phase 2 v2 — Top navigation bar.
 *
 * Spec: design_v2/specs/character_v2_measurements.md  §Section 1
 *   - Logo "SUI COMBATS"  (Slackey 32px, red+yellow comic)
 *   - Player avatar badge 36×36, --sc-panel-2 fill, 1px bronze rim
 *   - Player name Poppins 14/800 parchment
 *   - LV/ELO badges Poppins 10/700 bronze fill, page-black text
 *   - Nav links Poppins 14/800, active bronze / inactive parchment
 *   - SUI balance JetBrains Mono 13/700 on bronze, 112×31
 *
 * The navbar is rendered in every shell state (landing, no-character,
 * fight, spectate, main). Nav-link tabs only show in the main game
 * view (character exists AND no live fight) — same gating as the
 * old standalone TownNav.
 */

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useGame } from "@/hooks/useGameStore";
import type { GameState } from "@/hooks/useGameStore";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { Wordmark } from "@/components/v2/wordmark";
import { isSoundEnabled, toggleSound } from "@/lib/sounds";
import { useState } from "react";

function formatSui(sui: number): string {
  if (sui === 0) return "0";
  if (sui < 0.01) return sui.toFixed(4);
  if (sui < 1) return sui.toFixed(3);
  return sui.toFixed(2);
}

const AREAS: {
  id: GameState["currentArea"];
  label: string;
}[] = [
  { id: "character", label: "Character" },
  { id: "arena", label: "Arena" },
  { id: "marketplace", label: "Market" },
  { id: "tavern", label: "Tavern" },
  { id: "hall_of_fame", label: "Hall of Fame" },
];

/** Spec §[5]/[6]/[34]/[35] — bronze pill, page-black text. */
function NavBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "1.4px",
        textTransform: "uppercase",
        color: "var(--sc-page)",
        background: "var(--sc-bronze)",
        padding: "4px 11px",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        height: 26,
        borderRadius: 0,
      }}
    >
      {children}
    </span>
  );
}

/** Spec §[7]-[11] — active bronze, inactive parchment, Poppins 14/800. */
function NavLink({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 800,
        fontSize: "clamp(13px, 1.2vw, 17px)",
        letterSpacing: "0.28px",
        color: active ? "var(--sc-bronze)" : "var(--sc-parchment)",
        background: "transparent",
        border: 0,
        cursor: "pointer",
        padding: "clamp(8px, 0.9vw, 10px) clamp(8px, 1.1vw, 14px)",
        position: "relative",
        textTransform: "none",
        lineHeight: 1.1,
        whiteSpace: "nowrap",
      }}
    >
      {children}
      {active && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 12,
            right: 12,
            bottom: 0,
            height: 2,
            background: "var(--sc-bronze)",
          }}
        />
      )}
    </button>
  );
}

export function Navbar() {
  const account = useCurrentAccount();
  const { state, dispatch } = useGame();
  const { character, fight, spectatingFight } = state;
  const balance = useWalletBalance();
  const [sound, setSound] = useState(isSoundEnabled());

  // Spec §[7]-[11] — nav tabs only show in the main game view
  // (character minted, not in/spectating a fight). Same gating as the
  // pre-merge standalone TownNav. Avatar emoji defaults to the frog
  // per the spec; the picker still overrides via portrait NFT.
  const showTabs =
    !!character && !(fight && (fight.status === "active" || fight.status === "finished")) && !spectatingFight;

  return (
    <nav
      style={{
        background: "var(--sc-page)",
        borderBottom: "2px solid var(--sc-bronze)",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}
    >
      <div
        style={{
          maxWidth: "var(--container-max)",
          margin: "0 auto",
          padding: "clamp(8px, 1vw, 12px) clamp(12px, 2vw, 22px)",
          minHeight: 84,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "clamp(8px, 1.4vw, 16px)",
          flexWrap: "wrap",
          rowGap: 10,
        }}
      >
        {/* Left cluster: wordmark · avatar · name + badges · nav tabs */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "clamp(10px, 1.4vw, 18px)",
            minWidth: 0,
            flex: "1 1 auto",
            flexWrap: "wrap",
            rowGap: 8,
          }}
        >
          <Wordmark size="navbar" />

          {character && (
            <>
              {/* Spec §[3] — avatar badge, 1px bronze rim (+20% sized). */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  background: "var(--sc-panel-2)",
                  border: "1px solid var(--sc-bronze)",
                  borderRadius: 4,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 24,
                  lineHeight: 1,
                  marginLeft: 4,
                  flexShrink: 0,
                }}
                aria-label="Player avatar"
              >
                🐸
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  minWidth: 0,
                }}
              >
                {/* Spec §[4] — parchment label, line 1.1 (+20%). */}
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 17,
                    fontWeight: 800,
                    color: "var(--sc-parchment)",
                    lineHeight: 1.1,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 216,
                  }}
                >
                  {character.name}
                </span>
                <div style={{ display: "flex", gap: 4 }}>
                  <NavBadge>LV {character.level}</NavBadge>
                  <NavBadge>{character.rating}</NavBadge>
                </div>
              </div>

              {/* Spec §[7]-[11] — inline nav tabs. */}
              {showTabs && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0,
                    marginLeft: "clamp(8px, 1.6vw, 24px)",
                    flexWrap: "wrap",
                    rowGap: 4,
                  }}
                >
                  {AREAS.map((area) => (
                    <NavLink
                      key={area.id}
                      active={state.currentArea === area.id}
                      onClick={() => dispatch({ type: "SET_AREA", area: area.id })}
                    >
                      {area.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right cluster: balance · sound · status · connect */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
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
                fontSize: 15,
                width: 134,
                height: 37,
                padding: "6px 14px",
                background: "var(--sc-bronze)",
                color: "var(--sc-page)",
                border: "1px solid var(--sc-bronze-deep)",
                boxShadow: "var(--sh-plate-sm)",
                letterSpacing: "0.02em",
                justifyContent: "flex-start",
                boxSizing: "border-box",
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
                ? "var(--sc-victory)"
                : "var(--sc-blood)",
              boxShadow: state.socket.connected
                ? "0 0 6px var(--sc-victory)"
                : "0 0 6px var(--sc-blood)",
            }}
          />
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
