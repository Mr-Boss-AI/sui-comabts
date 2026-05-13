"use client";

/**
 * Phase 2 v2 — Town navigation tabs.
 *
 * Combats.ru-style: rectangular tabs, hard 3px bronze underline on
 * active, weathered-grey on inactive, weight transitions on hover.
 * No floating shadows, no gradient pills.
 */

import { useGame } from "@/hooks/useGameStore";
import type { GameState } from "@/hooks/useGameStore";
import { V2Tab } from "@/components/v2";

const AREAS: {
  id: GameState["currentArea"];
  label: string;
  desc: string;
}[] = [
  { id: "character", label: "Character", desc: "Stats & gear" },
  { id: "arena", label: "Arena", desc: "Fight players" },
  { id: "marketplace", label: "Market", desc: "Buy & sell" },
  { id: "tavern", label: "Tavern", desc: "Chat & social" },
  { id: "hall_of_fame", label: "Hall of Fame", desc: "Rankings" },
];

export function TownNav() {
  const { state, dispatch } = useGame();

  return (
    <div
      style={{
        display: "flex",
        gap: 0,
        overflowX: "auto",
        borderBottom: "2px solid var(--sc-rim)",
        paddingLeft: 14,
      }}
    >
      {AREAS.map((area) => (
        <V2Tab
          key={area.id}
          active={state.currentArea === area.id}
          subLabel={area.desc}
          onClick={() => dispatch({ type: "SET_AREA", area: area.id })}
        >
          {area.label}
        </V2Tab>
      ))}
      <div style={{ flex: 1 }} />
    </div>
  );
}
