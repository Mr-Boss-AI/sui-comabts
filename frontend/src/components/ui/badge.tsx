import type { CSSProperties } from "react";
import type { Rarity } from "@/types/game";
import { RARITY_LABELS } from "@/types/game";

/**
 * Phase 2 v2 Forged Metal — pill / stamp badge.
 *
 * Pill semantics — info-dense, capitalised, monospace optional. Variants:
 *   default → outlined stamp, gunmetal fill, parchment text
 *   success → green fill (uncommon-rarity green)
 *   warning → bronze fill, dark page text (the high-attention CTA color)
 *   danger  → blood-red fill, parchment text
 *   info    → steel-blue fill, parchment text
 *
 * Uses var(--rarity-*) tokens directly so the badge's hue stays
 * synchronised with the rest of the rarity ramp.
 */

const VARIANT_STYLES: Record<string, CSSProperties> = {
  default: {
    background: "var(--sc-panel-2)",
    color: "var(--fg-2)",
    border: "1px solid var(--sc-rim-2)",
  },
  success: {
    background: "var(--rarity-uncommon)",
    color: "var(--sc-parchment)",
    border: "1px solid var(--rarity-uncommon)",
  },
  warning: {
    background: "var(--sc-bronze)",
    color: "var(--sc-page)",
    border: "1px solid var(--sc-bronze-deep)",
  },
  danger: {
    background: "var(--sc-blood)",
    color: "var(--sc-parchment)",
    border: "1px solid var(--sc-blood-deep)",
  },
  info: {
    background: "var(--sc-steel-low)",
    color: "var(--sc-steel)",
    border: "1px solid var(--sc-steel-deep)",
  },
};

interface BadgeProps {
  variant?: keyof typeof VARIANT_STYLES;
  children: React.ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Badge({ variant = "default", children, className = "", style }: BadgeProps) {
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "var(--ls-stamp)",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: "var(--r-pill)",
        lineHeight: 1.4,
        whiteSpace: "nowrap",
        ...VARIANT_STYLES[variant],
        ...style,
      }}
    >
      {children}
    </span>
  );
}

const RARITY_BG: Record<Rarity, string> = {
  1: "var(--rarity-common)",
  2: "var(--rarity-uncommon)",
  3: "var(--rarity-rare)",
  4: "var(--rarity-epic)",
  5: "var(--rarity-legendary)",
};

export function RarityBadge({ rarity }: { rarity: Rarity }) {
  const bg = RARITY_BG[rarity];
  // Bronze (legendary) reads on light → dark text; everything else
  // gets parchment text.
  const text = rarity === 5 ? "var(--sc-page)" : "var(--sc-parchment)";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "var(--ls-stamp)",
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: "var(--r-pill)",
        background: bg,
        color: text,
        border: `1px solid ${bg}`,
        whiteSpace: "nowrap",
      }}
    >
      {RARITY_LABELS[rarity]}
    </span>
  );
}
