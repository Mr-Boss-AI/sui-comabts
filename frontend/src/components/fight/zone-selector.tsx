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
    <div style={{ display: "flex", gap: 24, alignItems: "flex-start", fontFamily: "var(--font-ui)" }}>
      {/* Attack body — blood-red selected */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--sc-blood)",
            marginBottom: 8,
            letterSpacing: "0.01em",
          }}
        >
          Attack
        </div>
        <svg viewBox="0 0 100 200" style={{ width: 112, height: 224 }}>
          {ZONES.map((zone) => {
            const isSelected = selectedAttack.includes(zone);
            const path = ZONE_PATHS[zone];
            return (
              <g key={zone}>
                <path
                  d={path.d}
                  fill={isSelected ? "rgba(181, 61, 44, 0.55)" : "rgba(26, 31, 40, 0.85)"}
                  stroke={isSelected ? "var(--sc-blood)" : "var(--sc-rim-2)"}
                  strokeWidth={isSelected ? 2 : 1}
                  style={{
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                    pointerEvents: disabled ? "none" : "auto",
                    transition: "all var(--d-fast)",
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled && !isSelected) {
                      e.currentTarget.setAttribute("fill", "rgba(181, 61, 44, 0.25)");
                      e.currentTarget.setAttribute("stroke", "var(--sc-blood)");
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!disabled && !isSelected) {
                      e.currentTarget.setAttribute("fill", "rgba(26, 31, 40, 0.85)");
                      e.currentTarget.setAttribute("stroke", "var(--sc-rim-2)");
                    }
                  }}
                  onClick={() => !disabled && onAttackToggle(zone)}
                />
                <text
                  x="50"
                  y={path.labelY}
                  textAnchor="middle"
                  fill={isSelected ? "var(--sc-parchment)" : "var(--fg-3)"}
                  fontSize="9"
                  fontWeight="800"
                  fontFamily="var(--font-ui)"
                  style={{ pointerEvents: "none", userSelect: "none", letterSpacing: ".06em", textTransform: "uppercase" }}
                >
                  {ZONE_LABELS[zone]}
                </text>
              </g>
            );
          })}
        </svg>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--sc-blood)",
            marginTop: 4,
            fontWeight: 700,
          }}
        >
          {selectedAttack.length}/{maxAttacks}
        </div>
      </div>

      {/* Block body — steel-blue selected */}
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--sc-steel)",
            marginBottom: 8,
            letterSpacing: "0.01em",
          }}
        >
          Block
        </div>
        <svg viewBox="0 0 100 200" style={{ width: 112, height: 224 }}>
          {ZONES.map((zone) => {
            const isSelected = selectedBlock.includes(zone);
            const path = ZONE_PATHS[zone];
            return (
              <g key={zone}>
                <path
                  d={path.d}
                  fill={isSelected ? "rgba(109, 143, 163, 0.55)" : "rgba(26, 31, 40, 0.85)"}
                  stroke={isSelected ? "var(--sc-steel)" : "var(--sc-rim-2)"}
                  strokeWidth={isSelected ? 2 : 1}
                  style={{
                    cursor: disabled ? "not-allowed" : "pointer",
                    opacity: disabled ? 0.4 : 1,
                    pointerEvents: disabled ? "none" : "auto",
                    transition: "all var(--d-fast)",
                  }}
                  onMouseEnter={(e) => {
                    if (!disabled && !isSelected) {
                      e.currentTarget.setAttribute("fill", "rgba(109, 143, 163, 0.22)");
                      e.currentTarget.setAttribute("stroke", "var(--sc-steel)");
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!disabled && !isSelected) {
                      e.currentTarget.setAttribute("fill", "rgba(26, 31, 40, 0.85)");
                      e.currentTarget.setAttribute("stroke", "var(--sc-rim-2)");
                    }
                  }}
                  onClick={() => !disabled && handleBlockClick(zone)}
                />
                <text
                  x="50"
                  y={path.labelY}
                  textAnchor="middle"
                  fill={isSelected ? "var(--sc-parchment)" : "var(--fg-3)"}
                  fontSize="9"
                  fontWeight="800"
                  fontFamily="var(--font-ui)"
                  style={{ pointerEvents: "none", userSelect: "none", letterSpacing: ".06em", textTransform: "uppercase" }}
                >
                  {ZONE_LABELS[zone]}
                </text>
              </g>
            );
          })}
        </svg>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--sc-steel)",
            marginTop: 4,
            fontWeight: 700,
          }}
        >
          {selectedBlock.length}/{maxBlocks}
          {shieldMode && " line"}
        </div>
      </div>
    </div>
  );
}
