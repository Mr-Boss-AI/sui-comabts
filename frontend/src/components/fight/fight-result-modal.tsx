"use client";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { RarityBadge } from "@/components/ui/badge";
import { useGame } from "@/hooks/useGameStore";
import type { FightState, LootBoxResult } from "@/types/game";

interface FightResultModalProps {
  fight: FightState;
  loot: LootBoxResult;
  myAddress: string;
  onClose: () => void;
}

export function FightResultModal({
  fight,
  loot,
  myAddress,
  onClose,
}: FightResultModalProps) {
  const won = fight.winner === myAddress;

  return (
    <Modal open onClose={onClose} title={won ? "Victory!" : "Defeat"}>
      <div
        style={{
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          fontFamily: "var(--font-ui)",
          color: "var(--sc-parchment)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 56,
            lineHeight: 1.05,
            color: won ? "var(--rarity-uncommon)" : "var(--sc-blood)",
            letterSpacing: "0.02em",
            textShadow: won
              ? "3px 3px 0 #000, 0 0 24px rgba(74,156,74,.4)"
              : "3px 3px 0 #000, 0 0 24px rgba(181,61,44,.4)",
          }}
        >
          {won ? "YOU WIN" : "YOU LOSE"}
        </div>

        <div style={{ color: "var(--fg-3)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          {fight.playerA.name} vs {fight.playerB.name} — {fight.log?.length ?? 0} turns
        </div>

        <div
          style={{
            borderTop: "1px solid var(--sc-rim)",
            paddingTop: 14,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--fg-3)" }}>XP Gained</span>
            <span style={{ color: "var(--sc-steel)", fontWeight: 800, fontFamily: "var(--font-mono)" }}>
              +{loot.xpGained}
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--fg-3)" }}>Rating</span>
            <span
              style={{
                fontWeight: 800,
                fontFamily: "var(--font-mono)",
                color: loot.ratingChange >= 0 ? "var(--rarity-uncommon)" : "var(--sc-blood)",
              }}
            >
              {loot.ratingChange >= 0 ? "+" : ""}
              {loot.ratingChange}
            </span>
          </div>
          {fight.wagerAmount && fight.wagerAmount > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
              <span style={{ color: "var(--fg-3)" }}>Wager</span>
              <span
                style={{
                  fontWeight: 800,
                  fontFamily: "var(--font-mono)",
                  color: won ? "var(--sc-bronze)" : "var(--sc-blood)",
                }}
              >
                {won ? "+" : "-"}
                {fight.wagerAmount} SUI
              </span>
            </div>
          )}
        </div>

        {loot.item && (
          <div style={{ borderTop: "1px solid var(--sc-rim)", paddingTop: 14 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: "var(--ls-stamp)",
                textTransform: "uppercase",
                color: "var(--sc-bronze)",
                marginBottom: 6,
              }}
            >
              Loot Drop!
            </div>
            <div
              style={{
                background: "var(--sc-panel-2)",
                border: "1px solid var(--sc-bronze-deep)",
                borderLeft: "3px solid var(--sc-bronze)",
                padding: 10,
                display: "flex",
                alignItems: "center",
                gap: 10,
                textAlign: "left",
              }}
            >
              <div
                style={{
                  fontSize: 22,
                  color: "var(--sc-bronze)",
                  fontFamily: "var(--font-display)",
                }}
              >
                {loot.item.rarity >= 4 ? "✦" : loot.item.rarity >= 3 ? "◆" : "•"}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: "var(--sc-parchment)" }}>
                  {loot.item.name}
                </div>
                <div style={{ marginTop: 4 }}>
                  <RarityBadge rarity={loot.item.rarity} />
                </div>
              </div>
            </div>
          </div>
        )}

        <Button onClick={onClose} style={{ width: "100%" }}>
          Continue
        </Button>
      </div>
    </Modal>
  );
}
