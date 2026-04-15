"use client";

import { useGame } from "@/hooks/useGameStore";
import type { GameState } from "@/hooks/useGameStore";

const AREAS: {
  id: GameState["currentArea"];
  label: string;
  icon: string;
  desc: string;
}[] = [
  { id: "arena", label: "Arena", icon: "\u2694\uFE0F", desc: "Fight players" },
  { id: "marketplace", label: "Market", icon: "\ud83c\udfea", desc: "Buy & sell" },
  { id: "tavern", label: "Tavern", icon: "\ud83c\udf7b", desc: "Chat & social" },
  { id: "hall_of_fame", label: "Hall of Fame", icon: "\ud83c\udfc6", desc: "Rankings" },
];

export function TownNav() {
  const { state, dispatch } = useGame();

  return (
    <div className="flex gap-0 overflow-x-auto">
      {AREAS.map((area) => {
        const active = state.currentArea === area.id;
        return (
          <button
            key={area.id}
            onClick={() => dispatch({ type: "SET_AREA", area: area.id })}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-bold whitespace-nowrap transition-all border-b-2 ${
              active
                ? "bg-[#0c0c0f] text-amber-200/90 border-b-amber-700/60 border-t border-l border-r border-t-amber-900/30 border-l-amber-900/20 border-r-amber-900/20 rounded-t"
                : "bg-transparent text-zinc-600 border-b-transparent hover:text-zinc-400 hover:bg-zinc-900/20"
            }`}
          >
            <span className="text-lg">{area.icon}</span>
            <div className="text-left">
              <div>{area.label}</div>
              <div className="text-[10px] opacity-40 font-normal hidden sm:block">{area.desc}</div>
            </div>
          </button>
        );
      })}
      {/* Fill remaining space with bottom border */}
      <div className="flex-1 border-b-2 border-b-transparent" />
    </div>
  );
}
