"use client";

/**
 * Phase 2 v2 — Player Profile modal.
 *
 * Shared surface used by Tavern (sidebar click), Hall of Fame (row
 * click), and any other "click a player → see their build" entry
 * point. Visually a scaled-down Character page:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  PLAYER PROFILE                                          ✕   │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  [ARCHETYPE]                            31·25  56 fights     │
 *   │  Mr_Boss_v5.1  [LV 6]  [1016 ELO]                 55% win    │
 *   │  0x06d6cb…239624                                              │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  ┌─ MiniEquipmentFrame ──────────┐ │  PRIMARY ATTRIBUTES     │
 *   │  │  Helmet · HP · Necklace        │ │  STR …  DEX …  INT …   │
 *   │  │  Shldr* · Portrait · 3 rings   │ │                         │
 *   │  │  Weapon · ornament · Gloves    │ │  COMBAT STATS  (4×2)    │
 *   │  │  Chest             · Off-hand  │ │  HP / ATK / CRIT / …    │
 *   │  │  Belt              · Pants*    │ │                         │
 *   │  │                    · Boots     │ │  W·L  ·  Win%           │
 *   │  └────────────────────────────────┘ │                         │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  [SEND MESSAGE]   [WAGER CHALLENGE]   [FRIENDLY FIGHT]       │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Reuses the canonical equipment-frame primitives (SlotTile, HpBar,
 * PortraitFrame, TribalOrnament) via `MiniEquipmentFrame`, in
 * read-only mode — no click handlers, no equip flow fires from here.
 *
 * Portrait status: the player's chosen portrait NFT currently lives
 * in localStorage on the picker's browser (see lib/nft-portrait.ts);
 * `PlayerProfileWire` carries no `portraitNftId`. Until a future
 * server-side hookup populates `portraitImageUrl`, the mini frame
 * renders its read-only "No portrait set" empty state.
 */

import { useEffect, useMemo, useState } from "react";
import { useGame } from "@/hooks/useGameStore";
import { Modal } from "@/components/ui/modal";
import {
  BronzeButton,
  DangerButton,
  SecondaryButton,
  SteelButton,
  Stamp,
  V2Input,
} from "@/components/v2";
import type { Item } from "@/types/game";
import { computeDerivedStats } from "@/lib/combat";
import { parseWagerInput, MIN_STAKE_SUI } from "@/lib/wager-input";
import { MiniEquipmentFrame } from "./mini-equipment-frame";

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

/** Same semantic colour palette as the main Character page Section 4. */
const STAT_COLORS = {
  STR: "var(--sc-blood)",
  DEX: "var(--sc-steel)",
  INT: "var(--sc-grape)",
  END: "var(--sc-bronze)",
} as const;

export function PlayerProfileModal() {
  const { state, dispatch } = useGame();
  const open = state.openProfileWallet !== null;
  const wallet = state.openProfileWallet;
  const profile = state.playerProfile;
  const isMine =
    !!wallet &&
    !!state.character &&
    state.character.walletAddress.toLowerCase() === wallet.toLowerCase();

  const [wagerStake, setWagerStake] = useState("0.5");
  const [showWagerInput, setShowWagerInput] = useState(false);
  const [wagerInputError, setWagerInputError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setShowWagerInput(false);
    setWagerStake("0.5");
    setWagerInputError(null);
    setCopied(false);
  }, [wallet]);

  useEffect(() => {
    if (!wallet) return;
    if (
      profile &&
      profile.walletAddress.toLowerCase() === wallet.toLowerCase()
    ) {
      return;
    }
    state.socket.send({ type: "get_player_profile", walletAddress: wallet });
  }, [wallet, profile, state.socket]);

  function close() {
    dispatch({ type: "OPEN_PROFILE", walletAddress: null });
  }
  function copyWallet() {
    if (!wallet) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(wallet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const derived = useMemo(() => {
    if (!profile) return null;
    return computeDerivedStats(
      profile.stats,
      profile.equipment,
      undefined,
      profile.level,
    );
  }, [profile]);

  const eqBonusSum = useMemo(() => {
    if (!profile) return null;
    const out = { strength: 0, dexterity: 0, intuition: 0, endurance: 0 };
    for (const slot of Object.values(profile.equipment)) {
      if (!slot) continue;
      const item = slot as Item;
      out.strength += item.statBonuses.strengthBonus || 0;
      out.dexterity += item.statBonuses.dexterityBonus || 0;
      out.intuition += item.statBonuses.intuitionBonus || 0;
      out.endurance += item.statBonuses.enduranceBonus || 0;
    }
    return out;
  }, [profile]);

  function sendFriendlyChallenge() {
    if (!wallet) return;
    state.socket.send({
      type: "send_fight_request",
      toWallet: wallet,
      requestType: "friendly",
    });
    close();
  }

  function sendWagerChallenge() {
    if (!wallet) return;
    setWagerInputError(null);
    const parsed = parseWagerInput(wagerStake);
    if (!parsed.ok) {
      setWagerInputError(parsed.reason);
      return;
    }
    const stakeMist = BigInt(Math.round(parsed.amount * 1e9)).toString();
    state.socket.send({
      type: "send_fight_request",
      toWallet: wallet,
      requestType: "wager",
      stakeMist,
    });
    setShowWagerInput(false);
    close();
  }

  function openDm() {
    if (!wallet) return;
    dispatch({ type: "OPEN_DM", peerWallet: wallet });
    close();
  }

  if (!open) return null;

  return (
    <Modal open={open} onClose={close} title="Player Profile" extraWide>
      {!profile && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "40px 0",
            color: "var(--fg-3)",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              border: "2px solid var(--sc-rim-2)",
              borderTopColor: "var(--sc-bronze)",
              display: "inline-block",
              animation: "spin 1s linear infinite",
            }}
          />
          <style>{`@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
          Loading profile…
        </div>
      )}
      {profile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 18 }}>
          {/* Header — name + LV/ELO pills · wallet · W/L right-aligned */}
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <h2
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-display)",
                    fontSize: 28,
                    lineHeight: 1,
                    color: "var(--sc-bronze)",
                    letterSpacing: "0.01em",
                  }}
                >
                  {profile.name}
                </h2>
                <Stamp tone="bronze">Lv {profile.level}</Stamp>
                <Stamp tone="default" outline>
                  {profile.rating} ELO
                </Stamp>
                {!profile.fresh && (
                  <Stamp tone="default" outline>
                    cached
                  </Stamp>
                )}
              </div>
              <button
                onClick={copyWallet}
                title={profile.walletAddress}
                style={{
                  marginTop: 4,
                  background: "transparent",
                  border: 0,
                  color: "var(--fg-3)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  cursor: "pointer",
                  padding: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {truncateAddress(profile.walletAddress)}
                <span style={{ color: "var(--sc-bronze)" }}>
                  {copied ? "✓ copied" : "⎘"}
                </span>
              </button>
            </div>
            <div
              style={{
                textAlign: "right",
                fontSize: 11,
                color: "var(--fg-3)",
                fontFamily: "var(--font-mono)",
              }}
            >
              <div>
                <span style={{ color: "var(--sc-victory)", fontWeight: 800 }}>
                  {profile.wins}
                </span>
                <span style={{ color: "var(--sc-rim-2)", margin: "0 6px" }}>·</span>
                <span style={{ color: "var(--sc-blood)", fontWeight: 800 }}>
                  {profile.losses}
                </span>
                <span style={{ color: "var(--sc-rim-2)", margin: "0 6px" }}>·</span>
                {/* v5.1 — Draws in neutral parchment (no win-green / loss-red).
                    Matches the FightResultModal DRAW treatment + the ladder
                    W/L/D column. */}
                <span style={{ color: "var(--sc-parchment)", fontWeight: 800 }}>
                  {profile.draws}
                </span>
              </div>
              <div style={{ marginTop: 3 }}>
                {profile.totalFights} fight{profile.totalFights === 1 ? "" : "s"}
              </div>
              <div style={{ marginTop: 3, color: "var(--sc-parchment)" }}>
                {Math.round(profile.winRate * 100)}% win
              </div>
            </div>
          </div>

          {/* Body — MiniEquipmentFrame · Stats column */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)",
              gap: 18,
              alignItems: "start",
            }}
          >
            {/* LEFT — Equipped loadout */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontWeight: 700,
                  fontSize: 10,
                  letterSpacing: "1px",
                  textTransform: "uppercase",
                  color: "var(--sc-muted)",
                }}
              >
                Equipped Loadout
              </span>
              <MiniEquipmentFrame
                equipment={profile.equipment}
                currentHp={derived?.maxHp ?? 0}
                maxHp={derived?.maxHp ?? 0}
              />
            </div>

            {/* RIGHT — Primary Attributes + Combat Stats column (Character-page parity) */}
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontWeight: 700,
                    fontSize: 10,
                    letterSpacing: "1px",
                    textTransform: "uppercase",
                    color: "var(--sc-muted)",
                    margin: "0 0 10px",
                  }}
                >
                  Primary Attributes
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {(
                    [
                      ["STR", profile.stats.strength, eqBonusSum?.strength ?? 0, STAT_COLORS.STR],
                      ["DEX", profile.stats.dexterity, eqBonusSum?.dexterity ?? 0, STAT_COLORS.DEX],
                      ["INT", profile.stats.intuition, eqBonusSum?.intuition ?? 0, STAT_COLORS.INT],
                      ["END", profile.stats.endurance, eqBonusSum?.endurance ?? 0, STAT_COLORS.END],
                    ] as const
                  ).map(([label, base, bonus, color]) => {
                    const total = base + bonus;
                    const pct = Math.min(100, (total / 20) * 100);
                    return (
                      <div
                        key={label}
                        style={{ display: "flex", alignItems: "center", gap: 12 }}
                      >
                        <span
                          style={{
                            width: 36,
                            color: color,
                            fontWeight: 800,
                            fontSize: 12,
                            letterSpacing: "0.96px",
                            textTransform: "uppercase",
                            fontFamily: "var(--font-ui)",
                          }}
                        >
                          {label}
                        </span>
                        <div
                          style={{
                            flex: 1,
                            height: 5,
                            background: "rgba(10, 13, 18, 0.6)",
                            borderRadius: 1,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              width: `${pct}%`,
                              height: "100%",
                              background: color,
                              transition: "width var(--d-slow) var(--ease-out)",
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontWeight: 700,
                            fontSize: 12,
                            color: color,
                            minWidth: 48,
                            textAlign: "right",
                          }}
                        >
                          {bonus > 0 ? (
                            <>
                              {base}
                              <span
                                style={{
                                  color: "var(--sc-victory)",
                                  marginLeft: 4,
                                  fontSize: 11,
                                }}
                              >
                                +{bonus}
                              </span>
                            </>
                          ) : (
                            base
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {derived && (
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontWeight: 700,
                      fontSize: 10,
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                      color: "var(--sc-muted)",
                      margin: "0 0 10px",
                    }}
                  >
                    Combat Stats
                  </div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(4, 1fr)",
                      gap: 6,
                    }}
                  >
                    {(
                      [
                        ["HP", derived.maxHp, "var(--sc-blood)"],
                        ["ATK", derived.attackPower, "var(--sc-blood)"],
                        ["CRIT", `${derived.critChance}%`, "var(--sc-grape)"],
                        ["CRIT ×", `${derived.critMultiplier}x`, "var(--sc-grape)"],
                        ["EVADE", `${derived.evasionChance}%`, "var(--sc-parchment)"],
                        ["ARMOR", derived.armor, "var(--sc-parchment)"],
                        ["DEF", derived.defense, "var(--sc-blood)"],
                        ["LV", profile.level, "var(--sc-parchment)"],
                      ] as const
                    ).map(([label, val, color]) => (
                      <div
                        key={label}
                        style={{
                          background: "var(--sc-page)",
                          border: "1px solid var(--sc-rim-2)",
                          borderRadius: 2,
                          padding: "8px 10px",
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: "0.12em",
                            textTransform: "uppercase",
                            color: "var(--sc-muted)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {label}
                        </div>
                        <div
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontWeight: 700,
                            fontSize: 16,
                            color: color,
                            marginTop: 2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {val}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          {!isMine && (
            <div style={{ borderTop: "1px solid var(--sc-rim)", paddingTop: 14 }}>
              {!showWagerInput && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 8,
                  }}
                >
                  <SecondaryButton onClick={openDm} title="Open encrypted DM">
                    💬 Send Message
                  </SecondaryButton>
                  <BronzeButton onClick={() => setShowWagerInput(true)}>
                    🪙 Wager Challenge
                  </BronzeButton>
                  <SteelButton onClick={sendFriendlyChallenge}>
                    ⚔ Friendly Fight
                  </SteelButton>
                </div>
              )}
              {showWagerInput && (
                <div
                  style={{
                    background: "var(--sc-panel-2)",
                    border: "1px solid var(--sc-bronze-deep)",
                    borderLeft: "3px solid var(--sc-bronze)",
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <span
                      style={{
                        color: "var(--sc-bronze)",
                        fontFamily: "var(--font-ui)",
                        fontWeight: 700,
                        fontSize: 12,
                        letterSpacing: ".06em",
                        textTransform: "uppercase",
                      }}
                    >
                      Challenge {profile.name}
                    </span>
                    <button
                      onClick={() => {
                        setShowWagerInput(false);
                        setWagerInputError(null);
                      }}
                      style={{
                        background: "transparent",
                        border: 0,
                        color: "var(--fg-3)",
                        cursor: "pointer",
                        fontSize: 11,
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <V2Input
                      value={wagerStake}
                      onChange={(e) => setWagerStake(e.target.value)}
                      placeholder={`Min ${MIN_STAKE_SUI} SUI`}
                      style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                    />
                    <span
                      style={{
                        color: "var(--sc-bronze)",
                        fontFamily: "var(--font-mono)",
                        fontWeight: 800,
                        fontSize: 14,
                      }}
                    >
                      SUI
                    </span>
                  </div>
                  {wagerInputError && (
                    <p
                      style={{
                        margin: 0,
                        color: "var(--sc-blood)",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {wagerInputError}
                    </p>
                  )}
                  <BronzeButton
                    onClick={sendWagerChallenge}
                    style={{ width: "100%" }}
                  >
                    Send Wager Challenge
                  </BronzeButton>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 10,
                      color: "var(--fg-3)",
                      lineHeight: 1.5,
                    }}
                  >
                    Acceptance opens the wager UI on your side. You sign
                    create_wager to lock the {wagerStake || "0"} SUI escrow;
                    they sign request_accept_wager to match it, then you
                    approve or decline (v5.2 handshake).
                  </p>
                </div>
              )}
              {/* Force-include the danger primitive so future "Block player"
                  or "Report" actions are a 1-line add (Phase 2 scope). */}
              <span style={{ display: "none" }} aria-hidden>
                <DangerButton onClick={() => {}}>placeholder</DangerButton>
              </span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
