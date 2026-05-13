"use client";

/**
 * Phase 2 v2 — Player Profile modal.
 *
 * Shared surface used by Tavern (sidebar click) and Hall of Fame
 * (row click). Bronze-rim modal, 10-slot equipment doll on the
 * left, primary attributes + combat stats + W/L on the right, and
 * three primary actions at the bottom (Send Message · Wager
 * Challenge · Friendly Fight).
 *
 * All slot rendering reads from var(--rarity-*) and uses the
 * chunky 2px rim treatment matching the Character screen frame.
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
  SectionLabel,
} from "@/components/v2";
import {
  EQUIPMENT_SLOT_LABELS,
  RARITY_LABELS,
  type EquipmentSlots,
  type Item,
  type Rarity,
} from "@/types/game";
import { computeDerivedStats } from "@/lib/combat";
import { parseWagerInput, MIN_STAKE_SUI } from "@/lib/wager-input";

const RARITY_BORDER: Record<Rarity, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--rarity-epic)",
  5: "var(--rarity-legendary)",
};

function truncateAddress(addr: string): string {
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function ProfileSlot({
  slot,
  item,
}: {
  slot: keyof EquipmentSlots;
  item: Item | null;
}) {
  const border = item ? RARITY_BORDER[item.rarity] : "var(--sc-rim-2)";
  return (
    <div
      title={
        item
          ? `${item.name} (${RARITY_LABELS[item.rarity]} Lv.${item.levelReq})`
          : EQUIPMENT_SLOT_LABELS[slot]
      }
      style={{
        width: 50,
        height: 56,
        border: `2px solid ${border}`,
        background: "var(--sc-page)",
        borderRadius: 2,
        boxShadow: "var(--rim-top), var(--rim-bottom)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {item ? (
        item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt={item.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              padding: 3,
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: border as string,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              padding: 2,
              textAlign: "center",
              lineHeight: 1.1,
            }}
          >
            {EQUIPMENT_SLOT_LABELS[slot].slice(0, 4)}
          </span>
        )
      ) : (
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: "var(--fg-3)",
            letterSpacing: ".10em",
            textTransform: "uppercase",
          }}
        >
          {EQUIPMENT_SLOT_LABELS[slot].slice(0, 3)}
        </span>
      )}
    </div>
  );
}

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
      out.strength += slot.statBonuses.strengthBonus || 0;
      out.dexterity += slot.statBonuses.dexterityBonus || 0;
      out.intuition += slot.statBonuses.intuitionBonus || 0;
      out.endurance += slot.statBonuses.enduranceBonus || 0;
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
    <Modal open={open} onClose={close} title="Player Profile" wide>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Header */}
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
                    fontSize: 24,
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
                <span style={{ color: "var(--rarity-uncommon)", fontWeight: 800 }}>
                  {profile.wins}
                </span>
                <span style={{ color: "var(--sc-rim-2)", margin: "0 6px" }}>·</span>
                <span style={{ color: "var(--sc-blood)", fontWeight: 800 }}>
                  {profile.losses}
                </span>
              </div>
              <div style={{ marginTop: 3 }}>
                {profile.totalFights} fight
                {profile.totalFights === 1 ? "" : "s"}
              </div>
              <div style={{ marginTop: 3, color: "var(--sc-parchment)" }}>
                {Math.round(profile.winRate * 100)}% win
              </div>
            </div>
          </div>

          {/* Body: doll + stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 18,
              alignItems: "start",
            }}
          >
            {/* Equipment doll */}
            <div>
              <SectionLabel>Equipped Loadout</SectionLabel>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  gap: 6,
                }}
              >
                {(Object.keys(EQUIPMENT_SLOT_LABELS) as Array<keyof EquipmentSlots>).map((slot) => (
                  <div
                    key={slot}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 3,
                    }}
                  >
                    <ProfileSlot slot={slot} item={profile.equipment[slot]} />
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        color: "var(--fg-3)",
                        letterSpacing: ".08em",
                        textTransform: "uppercase",
                      }}
                    >
                      {EQUIPMENT_SLOT_LABELS[slot]}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div>
                <SectionLabel>Primary Attributes</SectionLabel>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {(
                    [
                      ["STR", profile.stats.strength, eqBonusSum?.strength ?? 0, "var(--stat-str)"],
                      ["DEX", profile.stats.dexterity, eqBonusSum?.dexterity ?? 0, "var(--stat-dex)"],
                      ["INT", profile.stats.intuition, eqBonusSum?.intuition ?? 0, "var(--stat-int)"],
                      ["END", profile.stats.endurance, eqBonusSum?.endurance ?? 0, "var(--stat-end)"],
                    ] as const
                  ).map(([label, base, bonus, color]) => (
                    <div
                      key={label as string}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          color: "var(--fg-3)",
                          fontWeight: 800,
                          fontSize: 11,
                          letterSpacing: ".06em",
                        }}
                      >
                        {label}
                      </span>
                      <span
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontWeight: 700,
                          fontSize: 12,
                          color: color as string,
                        }}
                      >
                        {bonus > 0 ? (
                          <>
                            {base}{" "}
                            <span style={{ color: "var(--rarity-uncommon)" }}>
                              +{bonus}
                            </span>
                          </>
                        ) : (
                          base
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {derived && (
                <div>
                  <SectionLabel>Combat Stats</SectionLabel>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(2, 1fr)",
                      gap: 4,
                      fontSize: 11,
                    }}
                  >
                    {(
                      [
                        ["HP", derived.maxHp, "var(--stat-hp)"],
                        ["ATK", derived.attackPower, "var(--sc-blood)"],
                        ["Crit%", `${derived.critChance}%`, "var(--stat-int)"],
                        ["Crit×", `${derived.critMultiplier}x`, "var(--stat-int)"],
                        ["Evade", `${derived.evasionChance}%`, "var(--stat-dex)"],
                        ["Armor", derived.armor, "var(--sc-steel)"],
                        ["Def", derived.defense, "var(--sc-bronze)"],
                      ] as const
                    ).map(([label, val, color]) => (
                      <div
                        key={label as string}
                        style={{
                          background: "var(--sc-page)",
                          border: "1px solid var(--sc-rim-2)",
                          padding: "4px 8px",
                          display: "flex",
                          justifyContent: "space-between",
                          borderRadius: 2,
                        }}
                      >
                        <span style={{ color: "var(--fg-3)", fontWeight: 700, fontSize: 10, letterSpacing: ".10em", textTransform: "uppercase" }}>
                          {label}
                        </span>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontWeight: 700,
                            color: color as string,
                          }}
                        >
                          {val}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          {!isMine && (
            <div
              style={{
                borderTop: "1px solid var(--sc-rim)",
                paddingTop: 14,
              }}
            >
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
                    they sign accept_wager to match it.
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
