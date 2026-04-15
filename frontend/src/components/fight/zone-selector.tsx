"use client";

import { ZONES, ZONE_LABELS, type Zone } from "@/types/game";

// Each zone blocks itself + the zone below it (circular: legs wraps to head)
const BLOCK_PAIRS: Record<Zone, Zone[]> = {
  head: ["head", "chest"],
  chest: ["chest", "stomach"],
  stomach: ["stomach", "belt"],
  belt: ["belt", "legs"],
  legs: ["legs", "head"],
};

// Shield blocks clicked zone + next two down (circular)
const SHIELD_LINES: Record<Zone, Zone[]> = {
  head: ["head", "chest", "stomach"],
  chest: ["chest", "stomach", "belt"],
  stomach: ["stomach", "belt", "legs"],
  belt: ["belt", "legs", "head"],
  legs: ["legs", "head", "chest"],
};

// SVG body zone hit areas (y-coordinates for each zone on a 100x200 viewBox)
const ZONE_PATHS: Record<Zone, { d: string; labelY: number }> = {
  head:    { d: "M35 5 Q35 0 50 0 Q65 0 65 5 L65 30 Q65 35 50 35 Q35 35 35 30 Z", labelY: 18 },
  chest:   { d: "M25 38 L75 38 L78 70 L22 70 Z", labelY: 54 },
  stomach: { d: "M22 73 L78 73 L76 105 L24 105 Z", labelY: 89 },
  belt:    { d: "M24 108 L76 108 L74 130 L26 130 Z", labelY: 119 },
  legs:    { d: "M26 133 L44 133 L42 195 L20 195 L26 133 M56 133 L74 133 L80 195 L58 195 L56 133 Z", labelY: 165 },
};

interface ZoneSelectorProps {
  selectedAttack: Zone[];
  selectedBlock: Zone[];
  maxAttacks: number;
  maxBlocks: number;
  onAttackToggle: (zone: Zone) => void;
  onBlockPairSelect: (zones: Zone[]) => void;
  shieldMode?: boolean;
  dualWieldMode?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

export function ZoneSelector({
  selectedAttack,
  selectedBlock,
  maxAttacks,
  maxBlocks,
  onAttackToggle,
  onBlockPairSelect,
  shieldMode,
  dualWieldMode,
  disabled,
}: ZoneSelectorProps) {
  function handleBlockClick(zone: Zone) {
    if (shieldMode) {
      onBlockPairSelect(SHIELD_LINES[zone]);
    } else if (dualWieldMode) {
      if (selectedBlock.includes(zone)) onBlockPairSelect([]);
      else onBlockPairSelect([zone]);
    } else {
      const pair = BLOCK_PAIRS[zone];
      if (selectedBlock.length === 2 && selectedBlock.includes(pair[0]) && selectedBlock.includes(pair[1])) {
        onBlockPairSelect([]);
      } else {
        onBlockPairSelect(pair);
      }
    }
  }

  return (
    <div className="flex gap-6 items-start">
      {/* Attack body */}
      <div className="text-center">
        <div className="text-xs text-red-400 font-bold mb-2 uppercase tracking-wider">Attack</div>
        <svg viewBox="0 0 100 200" className="w-28 h-56">
          {ZONES.map((zone) => {
            const isSelected = selectedAttack.includes(zone);
            const path = ZONE_PATHS[zone];
            return (
              <g key={zone}>
                <path
                  d={path.d}
                  fill={isSelected ? "rgba(220, 38, 38, 0.5)" : "rgba(63, 63, 70, 0.3)"}
                  stroke={isSelected ? "#ef4444" : "#52525b"}
                  strokeWidth={isSelected ? "2" : "1"}
                  className={`${disabled ? "pointer-events-none opacity-40" : "cursor-pointer hover:fill-red-900/40 hover:stroke-red-500"} transition-all`}
                  onClick={() => !disabled && onAttackToggle(zone)}
                />
                <text
                  x="50" y={path.labelY}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  fill={isSelected ? "#fca5a5" : "#71717a"}
                  fontSize="9"
                  fontWeight="bold"
                >
                  {ZONE_LABELS[zone]}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="text-xs text-zinc-500 mt-1">{selectedAttack.length}/{maxAttacks}</div>
      </div>

      {/* Block body */}
      <div className="text-center">
        <div className="text-xs text-blue-400 font-bold mb-2 uppercase tracking-wider">Block</div>
        <svg viewBox="0 0 100 200" className="w-28 h-56">
          {ZONES.map((zone) => {
            const isSelected = selectedBlock.includes(zone);
            const path = ZONE_PATHS[zone];
            return (
              <g key={zone}>
                <path
                  d={path.d}
                  fill={isSelected ? "rgba(37, 99, 235, 0.5)" : "rgba(63, 63, 70, 0.3)"}
                  stroke={isSelected ? "#3b82f6" : "#52525b"}
                  strokeWidth={isSelected ? "2" : "1"}
                  className={`${disabled ? "pointer-events-none opacity-40" : "cursor-pointer hover:fill-blue-900/40 hover:stroke-blue-500"} transition-all`}
                  onClick={() => !disabled && handleBlockClick(zone)}
                />
                <text
                  x="50" y={path.labelY}
                  textAnchor="middle"
                  className="pointer-events-none select-none"
                  fill={isSelected ? "#93c5fd" : "#71717a"}
                  fontSize="9"
                  fontWeight="bold"
                >
                  {ZONE_LABELS[zone]}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="text-xs text-zinc-500 mt-1">
          {selectedBlock.length}/{maxBlocks}
          {shieldMode && " line"}
        </div>
      </div>
    </div>
  );
}
