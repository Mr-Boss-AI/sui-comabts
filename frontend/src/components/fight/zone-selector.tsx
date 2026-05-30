"use client";

import { ZONES, ZONE_LABELS, type Zone } from "@/types/game";

// Each zone blocks itself + the zone below it (circular: legs wraps to head)
export const BLOCK_PAIRS: Record<Zone, Zone[]> = {
  head: ["head", "chest"],
  chest: ["chest", "stomach"],
  stomach: ["stomach", "belt"],
  belt: ["belt", "legs"],
  legs: ["legs", "head"],
};

// Shield blocks clicked zone + next two down (circular)
export const SHIELD_LINES: Record<Zone, Zone[]> = {
  head: ["head", "chest", "stomach"],
  chest: ["chest", "stomach", "belt"],
  stomach: ["stomach", "belt", "legs"],
  belt: ["belt", "legs", "head"],
  legs: ["legs", "head", "chest"],
};

// Phase 3 Fight-Room redesign — 4-letter zone labels for the compact
// list variant. Stays a constant (not derived from ZONE_LABELS) so the
// mockup-matching abbreviations are deterministic and pinned by QA.
export const ZONE_LABEL_SHORT: Record<Zone, string> = {
  head: "HEAD",
  chest: "CHEST",
  stomach: "STOM",
  belt: "BELT",
  legs: "LEGS",
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
  /**
   * Phase 3 Fight-Room redesign:
   *   "body" → original SVG silhouette with two side-by-side bodies
   *   "list" → compact vertical stack (ATK above BLK), 5 buttons per
   *            section, sized to fit a ~100px-wide "YOUR MOVE" column.
   *
   * Defaults to "body" for back-compat — any callers added before the
   * Phase-3 fight-arena rewrite keep the SVG layout.
   */
  variant?: "body" | "list";
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
  variant = "body",
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

  if (variant === "list") {
    return (
      <ZoneSelectorList
        selectedAttack={selectedAttack}
        selectedBlock={selectedBlock}
        maxAttacks={maxAttacks}
        maxBlocks={maxBlocks}
        onAttackToggle={onAttackToggle}
        onBlockClick={handleBlockClick}
        shieldMode={shieldMode}
        disabled={disabled}
      />
    );
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

/**
 * Phase 3 Fight-Room — compact vertical "YOUR MOVE" column.
 *
 *   ATK label (blood-red) + 5 stacked zone buttons
 *   BLK label (steel-blue) + 5 stacked zone buttons
 *
 * Selection styling matches the SVG variant: blood-red highlight for
 * selected ATK, steel-blue highlight for selected BLK. Block-pair /
 * shield-line / dual-wield-single semantics are owned by the parent
 * `ZoneSelector` via `handleBlockClick` (passed in as `onBlockClick`).
 */
interface ZoneSelectorListProps {
  selectedAttack: Zone[];
  selectedBlock: Zone[];
  maxAttacks: number;
  maxBlocks: number;
  onAttackToggle: (zone: Zone) => void;
  onBlockClick: (zone: Zone) => void;
  shieldMode?: boolean;
  disabled?: boolean;
}

/**
 * Tabler-style outline icons. We don't ship the npm @tabler/icons-react
 * package, so the v3 design's "ti-sword / ti-shield" call-outs are
 * rendered as inline SVG matching Tabler's stroke-width-2 line style.
 * `aria-hidden` because the parent button already has an accessible
 * name (`ATK head` / `BLK head` etc.).
 */
function IconSword({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14.5 17.5 L3 6 V3 H6 L17.5 14.5" />
      <path d="m13 19 6-6" />
      <path d="m16 16 4 4" />
      <path d="m19 21 2-2" />
    </svg>
  );
}
function IconShield({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3 L20 6 V11 C20 16 16.5 19.5 12 21 C7.5 19.5 4 16 4 11 V6 Z" />
    </svg>
  );
}
function IconCheck({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 12l5 5 9-11" />
    </svg>
  );
}

/**
 * Glow-pulse keyframes (~1s ease-in-out). Injected once, scoped via a
 * fixed class name so multiple instances share the same rule. Kept
 * inline so the component is self-contained — no global stylesheet
 * coupling beyond the tokens it already uses.
 */
const PULSE_CSS = `
@keyframes zs-pulse-red {
  0%, 100% { box-shadow: var(--sh-plate-sm), 0 0 0 1px var(--sc-blood), 0 0 8px rgba(226, 75, 74, 0.45); }
  50%      { box-shadow: var(--sh-plate-sm), 0 0 0 1px var(--sc-blood), 0 0 14px 2px rgba(226, 75, 74, 0.75); }
}
@keyframes zs-pulse-blue {
  0%, 100% { box-shadow: var(--sh-plate-sm), 0 0 0 1px var(--sc-steel), 0 0 8px rgba(55, 138, 221, 0.40); }
  50%      { box-shadow: var(--sh-plate-sm), 0 0 0 1px var(--sc-steel), 0 0 14px 2px rgba(55, 138, 221, 0.75); }
}
`;

/**
 * One ATK or BLK button — a compact icon-only cell with checkmark on
 * select. Stable visual width (no layout shift) because the check
 * overlays the icon corner instead of pushing it.
 */
function ZoneActionButton(props: {
  kind: "atk" | "blk";
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  zoneLabel: string;
}) {
  const isAtk = props.kind === "atk";
  const accent = isAtk ? "var(--sc-blood)" : "var(--sc-steel)";
  const accentDeep = isAtk ? "var(--sc-blood-deep)" : "var(--sc-steel-deep)";
  const glowRgba = isAtk ? "rgba(226, 75, 74, 0.6)" : "rgba(55, 138, 221, 0.6)";
  const tintBg = isAtk ? "rgba(181, 61, 44, 0.22)" : "rgba(109, 143, 163, 0.22)";
  const pulseKf = isAtk ? "zs-pulse-red" : "zs-pulse-blue";

  return (
    <button
      type="button"
      onClick={() => !props.disabled && props.onClick()}
      disabled={props.disabled}
      aria-label={`${isAtk ? "Attack" : "Block"} ${props.zoneLabel}${props.selected ? " (selected)" : ""}`}
      title={`${isAtk ? "Attack" : "Block"} ${props.zoneLabel}`}
      style={{
        width: "100%",
        minHeight: 34,
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 8px",
        border: `2px solid ${props.selected ? accent : accentDeep}`,
        background: props.selected ? tintBg : "var(--sc-panel-2)",
        color: props.selected ? "var(--sc-parchment)" : accent,
        borderRadius: "var(--r-sharp)",
        boxShadow: props.selected
          ? `var(--sh-plate-sm), 0 0 0 1px ${accent}, 0 0 12px 2px ${glowRgba}`
          : "var(--sh-plate-sm)",
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.45 : 1,
        transition:
          "background var(--d-fast), color var(--d-fast), border-color var(--d-fast), transform var(--d-fast), box-shadow var(--d-fast)",
        animation: props.selected ? `${pulseKf} 1.4s ease-in-out infinite` : undefined,
      }}
      onMouseEnter={(e) => {
        if (props.disabled || props.selected) return;
        e.currentTarget.style.borderColor = accent;
        e.currentTarget.style.color = "var(--sc-parchment)";
        e.currentTarget.style.background = tintBg;
        e.currentTarget.style.transform = "translate(-1px, -1px)";
        e.currentTarget.style.boxShadow = "var(--sh-plate-lg)";
      }}
      onMouseLeave={(e) => {
        if (props.disabled || props.selected) return;
        e.currentTarget.style.borderColor = accentDeep;
        e.currentTarget.style.color = accent;
        e.currentTarget.style.background = "var(--sc-panel-2)";
        e.currentTarget.style.transform = "";
        e.currentTarget.style.boxShadow = "var(--sh-plate-sm)";
      }}
      onMouseDown={(e) => {
        if (props.disabled) return;
        e.currentTarget.style.transform = "translate(1px, 1px)";
      }}
      onMouseUp={(e) => {
        if (props.disabled) return;
        e.currentTarget.style.transform = props.selected ? "" : "translate(-1px, -1px)";
      }}
    >
      {isAtk ? <IconSword size={18} /> : <IconShield size={18} />}
      {props.selected && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: -7,
            right: -7,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: accent,
            color: "var(--sc-page)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: `0 0 6px ${glowRgba}`,
            border: "1px solid var(--sc-page)",
          }}
        >
          <IconCheck size={11} />
        </span>
      )}
    </button>
  );
}

function ZoneSelectorList({
  selectedAttack,
  selectedBlock,
  maxAttacks,
  maxBlocks,
  onAttackToggle,
  onBlockClick,
  shieldMode,
  disabled,
}: ZoneSelectorListProps) {
  /**
   * v3 polish — row-paired grid. Each body zone gets one row
   * (ATK button · zone label · BLK button); the two counter chips
   * (ATK n/max, BLK n/max) span the header row above.
   *
   *   grid-template-columns: 1fr auto 1fr
   *   grid-template-rows:    auto repeat(5, auto)
   *
   * Layout choice: a *single* grid (rather than two side-by-side
   * column flexes) so the ATK / BLK buttons stay vertically aligned
   * with the bronze zone label between them — guaranteed by the grid
   * tracks, not eyeballed pixel pushes.
   */
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
      }}
      data-testid="zone-selector-list"
    >
      <style>{PULSE_CSS}</style>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gridTemplateRows: "auto repeat(5, auto)",
          columnGap: 8,
          rowGap: 6,
          alignItems: "center",
        }}
      >
        {/* Header row — ATK counter (left), BLK counter (right). */}
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "var(--ls-button)",
            color: "var(--sc-blood)",
            textAlign: "left",
            textTransform: "uppercase",
          }}
        >
          ATK{" "}
          <span style={{ color: "var(--sc-bronze)", fontWeight: 700 }}>
            {selectedAttack.length}/{maxAttacks}
          </span>
        </div>
        <div aria-hidden />
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "var(--ls-button)",
            color: "var(--sc-steel)",
            textAlign: "right",
            textTransform: "uppercase",
          }}
        >
          BLK{" "}
          <span style={{ color: "var(--sc-bronze)", fontWeight: 700 }}>
            {selectedBlock.length}/{maxBlocks}
            {shieldMode ? " line" : ""}
          </span>
        </div>

        {/* Zone rows — ATK button | label | BLK button per row. */}
        {ZONES.map((zone) => {
          const atkSelected = selectedAttack.includes(zone);
          const blkSelected = selectedBlock.includes(zone);
          return (
            <div key={zone} style={{ display: "contents" }}>
              <ZoneActionButton
                kind="atk"
                selected={atkSelected}
                disabled={disabled}
                onClick={() => onAttackToggle(zone)}
                zoneLabel={ZONE_LABELS[zone]}
              />
              <div
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: "var(--ls-button)",
                  color: "var(--sc-bronze)",
                  textTransform: "uppercase",
                  textAlign: "center",
                  padding: "0 6px",
                  whiteSpace: "nowrap",
                }}
              >
                {ZONE_LABELS[zone].toUpperCase()}
              </div>
              <ZoneActionButton
                kind="blk"
                selected={blkSelected}
                disabled={disabled}
                onClick={() => onBlockClick(zone)}
                zoneLabel={ZONE_LABELS[zone]}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
