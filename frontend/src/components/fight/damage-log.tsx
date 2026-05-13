"use client";

/**
 * Phase 2 v2 — Damage Log.
 *
 * Gunmetal background, parchment damage numbers, bronze for crits,
 * blood-red for HP loss, steel-blue for blocks, weathered grey for
 * misses. Matches design_v2/latest/preview/components-damagelog.html.
 */

import { useRef, useEffect } from "react";
import type { TurnResult, HitResult, FightState } from "@/types/game";
import { ZONE_LABELS } from "@/types/game";

interface DamageLogProps {
  log: TurnResult[];
  fight: FightState;
  myAddress: string;
}

export function DamageLog({ log, fight, myAddress }: DamageLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [log]);

  if (log.length === 0) {
    return (
      <div
        style={{
          fontSize: 12,
          color: "var(--fg-3)",
          textAlign: "center",
          padding: "16px 0",
          fontFamily: "var(--font-ui)",
          fontStyle: "italic",
        }}
      >
        Waiting for combat…
      </div>
    );
  }

  const isPlayerA = fight.playerA.walletAddress === myAddress;

  return (
    <div
      ref={scrollRef}
      className="scroll-plate"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        overflowY: "auto",
        maxHeight: 420,
        paddingRight: 8,
        fontFamily: "var(--font-ui)",
      }}
    >
      {log.map((turn) => {
        const myHits = isPlayerA ? turn.playerB.hits : turn.playerA.hits;
        const oppHits = isPlayerA ? turn.playerA.hits : turn.playerB.hits;
        return (
          <div
            key={turn.turn}
            style={{
              borderLeft: "2px solid var(--sc-bronze-deep)",
              paddingLeft: 12,
              paddingTop: 4,
              paddingBottom: 4,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: 12,
                color: "var(--sc-bronze)",
                marginBottom: 4,
                letterSpacing: "0.04em",
              }}
            >
              Turn {turn.turn}
            </div>
            {myHits.map((hit, i) => (
              <div
                key={`my-${i}`}
                style={{
                  fontSize: 12,
                  marginBottom: 2,
                  ...hitStyleOf(hit, true),
                }}
              >
                {formatMyAttack(hit)}
              </div>
            ))}
            {oppHits.map((hit, i) => (
              <div
                key={`opp-${i}`}
                style={{
                  fontSize: 12,
                  marginBottom: 2,
                  ...hitStyleOf(hit, false),
                }}
              >
                {formatOppAttack(hit)}
              </div>
            ))}
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--fg-3)",
                marginTop: 4,
              }}
            >
              Your HP{" "}
              <span style={{ color: "var(--sc-parchment)", fontWeight: 700 }}>
                {getHpAfterTurn(turn, isPlayerA)}
              </span>
              {"  ·  "}
              Foe HP{" "}
              <span style={{ color: "var(--sc-parchment)", fontWeight: 700 }}>
                {getHpAfterTurn(turn, !isPlayerA)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatMyAttack(hit: HitResult): string {
  const zone = ZONE_LABELS[hit.zone];
  if (hit.blocked) return `You → ${zone} · BLOCKED`;
  if (hit.dodged) return `You → ${zone} · DODGED`;
  if (hit.crit) return `You → ${zone} · CRIT ${hit.damage.toFixed(1)}`;
  return `You → ${zone} · ${hit.damage.toFixed(1)}`;
}

function formatOppAttack(hit: HitResult): string {
  const zone = ZONE_LABELS[hit.zone];
  if (hit.blocked) return `Foe → ${zone} · YOU BLOCKED`;
  if (hit.dodged) return `Foe → ${zone} · YOU DODGED`;
  if (hit.crit) return `Foe → ${zone} · CRIT ${hit.damage.toFixed(1)}`;
  return `Foe → ${zone} · ${hit.damage.toFixed(1)}`;
}

function hitStyleOf(hit: HitResult, isMine: boolean): { color: string; fontWeight: number } {
  if (hit.blocked) return { color: "var(--sc-steel)", fontWeight: 600 };
  if (hit.dodged) return { color: "var(--fg-3)", fontWeight: 500 };
  if (hit.crit) return { color: "var(--sc-bronze)", fontWeight: 800 };
  return isMine
    ? { color: "var(--rarity-uncommon)", fontWeight: 700 }
    : { color: "var(--sc-blood)", fontWeight: 700 };
}

function getHpAfterTurn(turn: TurnResult, isA: boolean): string {
  const hp = isA ? turn.playerA.hpAfter : turn.playerB.hpAfter;
  if (hp === undefined || hp === null) return "?";
  return `${Math.round(hp)}`;
}
