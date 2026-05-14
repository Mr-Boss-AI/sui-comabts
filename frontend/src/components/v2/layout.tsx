"use client";

/**
 * Phase 2 v2 Forged Metal — layout primitives.
 *
 * Sized + composed per the Claude Design screenshots in
 * `design_v2/screenshopts/`. Single import surface for every screen
 * rebuild (Character, Arena, Market, Tavern, Hall of Fame).
 *
 *   import { TopBanner, ScreenLayout, ThreeColumn, PodiumBlock,
 *            ListingCard, DMRow, OnlineRow }
 *     from "@/components/v2/layout";
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/* ════════════════════════════════════════════════════════════════════
 * Responsive helper — viewport-driven breakpoint state.
 * Mobile-first; consumers gate their grid shape on `bp.gte("lg")` etc.
 * ════════════════════════════════════════════════════════════════════ */

export type Breakpoint = "sm" | "md" | "lg" | "xl";

/** Returns the live viewport breakpoint. SSR-safe — `xl` initially so
 *  the desktop layout renders first paint, then re-renders client-side
 *  if the viewport is smaller. */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("xl");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apply = () => {
      const w = window.innerWidth;
      if (w >= 1440) setBp("xl");
      else if (w >= 1024) setBp("lg");
      else if (w >= 768) setBp("md");
      else setBp("sm");
    };
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);
  return bp;
}

/** Bit-flag breakpoint comparator. `bpGte("xl", currentBp)` is true
 *  only at 1440px+. Total + pure — testable. */
export function bpGte(target: Breakpoint, current: Breakpoint): boolean {
  const order: Record<Breakpoint, number> = { sm: 0, md: 1, lg: 2, xl: 3 };
  return order[current] >= order[target];
}

/* ════════════════════════════════════════════════════════════════════
 * ScreenLayout — full-viewport wrapper with the canonical max-width.
 *
 * Replaces the narrow ~896px center column the v1 layout used. Every
 * screen rebuild wraps its content in <ScreenLayout> so the visual
 * rhythm + container shape stay consistent.
 * ════════════════════════════════════════════════════════════════════ */

export function ScreenLayout({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: 1440,
        margin: "0 auto",
        padding: "0 20px 56px",
        display: "flex",
        flexDirection: "column",
        gap: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * TopBanner — Slackey title + subtitle + right-aligned pill.
 *
 * Tone variants per design-tool screenshots:
 *   bronze   — Character + Market + Tavern (warm gradient)
 *   blood    — Arena + Hall of Fame (red-tinted bar)
 *   gunmetal — fallback / utility
 *
 * Pill variants:
 *   onChain  — bronze fill, "ON CHAIN" content
 *   testnet  — red fill, "V5 · TESTNET" content
 *   live     — green pill (used inside chat, not banner)
 * ════════════════════════════════════════════════════════════════════ */

export type BannerTone = "bronze" | "blood" | "gunmetal";
export type PillKind = "onChain" | "testnet" | null;

const BANNER_BG: Record<BannerTone, string> = {
  bronze: "var(--sc-bronze)",
  blood: "var(--sc-blood)",
  gunmetal: "var(--sc-panel-2)",
};

const BANNER_TEXT: Record<BannerTone, string> = {
  bronze: "var(--sc-parchment)",
  blood: "var(--sc-parchment)",
  gunmetal: "var(--sc-parchment)",
};

/**
 * Spec: design_v2/specs/character_v2_measurements.md  §Section 2
 *   - Banner BG solid bronze, border-bottom 2px parchment
 *   - Heading: Poppins 48/800 parchment, tracking -0.96px
 *   - Subtitle: Poppins 16/400 parchment
 *   - "ON CHAIN" pill: Poppins 14/700, bronze on page-black, 116×37
 */
export function TopBanner({
  title,
  subtitle,
  pill = null,
  tone = "bronze",
}: {
  title: string;
  subtitle?: ReactNode;
  pill?: PillKind;
  tone?: BannerTone;
}) {
  const fg = BANNER_TEXT[tone];
  const subtleFg =
    tone === "bronze"
      ? "var(--sc-parchment)"
      : "rgba(232,226,212,0.85)";
  return (
    <div
      style={{
        position: "relative",
        background: BANNER_BG[tone],
        borderBottom: `2px solid ${tone === "bronze" ? "var(--sc-parchment)" : tone === "blood" ? "var(--sc-blood-deep)" : "var(--sc-rim)"}`,
        padding: "20px 26px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 24,
        flexWrap: "wrap",
        fontFamily: "var(--font-ui)",
        color: fg,
        overflow: "hidden",
      }}
    >
      <div style={{ minWidth: 0, flex: "1 1 320px" }}>
        <h1
          style={{
            margin: 0,
            fontFamily: "var(--font-ui)",
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1.05,
            color: fg,
            letterSpacing: "-0.96px",
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            style={{
              marginTop: 6,
              fontSize: 16,
              fontWeight: 400,
              color: subtleFg,
              letterSpacing: 0,
              lineHeight: 1.4,
              maxWidth: 720,
            }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {pill && <BannerPill kind={pill} />}
    </div>
  );
}

function BannerPill({ kind }: { kind: NonNullable<PillKind> }) {
  const isOnChain = kind === "onChain";
  return (
    <span
      style={{
        fontFamily: "var(--font-ui)",
        fontWeight: 700,
        fontSize: 14,
        letterSpacing: "var(--ls-stamp)",
        textTransform: "uppercase",
        padding: "8px 14px",
        width: 116,
        height: 37,
        boxSizing: "border-box",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: isOnChain ? "var(--sc-page)" : "var(--sc-blood-deep)",
        color: isOnChain ? "var(--sc-bronze)" : "var(--sc-parchment)",
        border: `1px solid ${isOnChain ? "var(--sc-bronze)" : "var(--sc-parchment)"}`,
        borderRadius: "var(--r-pill)",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {isOnChain ? "On Chain" : "V5 · Testnet"}
    </span>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * ThreeColumn — left sidebar / center main / right sidebar.
 *
 * Used by Tavern + Market. Stacks vertically below `lg` (1024px).
 * Caller supplies widths via the `left` / `right` props (defaults
 * 260 / 280 per the design screenshots).
 * ════════════════════════════════════════════════════════════════════ */

export function ThreeColumn({
  left,
  center,
  right,
  leftWidth = 260,
  rightWidth = 280,
  gap = 16,
}: {
  left: ReactNode;
  center: ReactNode;
  right: ReactNode;
  leftWidth?: number;
  rightWidth?: number;
  gap?: number;
}) {
  const bp = useBreakpoint();
  const stacked = !bpGte("lg", bp);
  if (stacked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap }}>
        {center}
        {left}
        {right}
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `${leftWidth}px minmax(0, 1fr) ${rightWidth}px`,
        gap,
        alignItems: "start",
      }}
    >
      {left}
      {center}
      {right}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * PodiumBlock — 1st / 2nd / 3rd primitive for Hall of Fame.
 * ════════════════════════════════════════════════════════════════════ */

export interface PodiumBlockProps {
  rank: 1 | 2 | 3;
  name: string;
  level: number;
  rating: number;
  /** Optional avatar — pass an <img> or emoji. Defaults to a bronze
   *  monogram if undefined. */
  avatar?: ReactNode;
  onClick?: () => void;
}

const PODIUM_HEIGHTS: Record<1 | 2 | 3, number> = { 1: 240, 2: 180, 3: 140 };
const PODIUM_NUMBER_SIZE: Record<1 | 2 | 3, number> = { 1: 88, 2: 64, 3: 52 };
const PODIUM_BG: Record<1 | 2 | 3, string> = {
  1: "var(--sc-bronze)",
  2: "var(--sc-parchment)",
  3: "var(--sc-blood)",
};
const PODIUM_BORDER: Record<1 | 2 | 3, string> = {
  1: "var(--sc-bronze-deep)",
  2: "#8a8474",
  3: "var(--sc-blood-deep)",
};
const PODIUM_LABEL_COLOR: Record<1 | 2 | 3, string> = {
  1: "var(--sc-page)",
  2: "var(--sc-page)",
  3: "var(--sc-parchment)",
};
const PODIUM_RANK_LABEL: Record<1 | 2 | 3, string> = {
  1: "1st",
  2: "2nd",
  3: "3rd",
};

export function PodiumBlock({
  rank,
  name,
  level,
  rating,
  avatar,
  onClick,
}: PodiumBlockProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        textAlign: "center",
        fontFamily: "var(--font-ui)",
        cursor: onClick ? "pointer" : "default",
      }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) onClick();
      }}
    >
      {rank === 1 && (
        <svg
          width="38"
          height="32"
          viewBox="0 0 38 32"
          fill="none"
          aria-hidden
          style={{ marginBottom: 4 }}
        >
          <path
            d="M3 26 L7 8 L14 14 L19 4 L24 14 L31 8 L35 26 Z"
            fill="var(--sc-bronze)"
            stroke="var(--sc-bronze-deep)"
            strokeWidth="2"
          />
          <circle cx="7" cy="8" r="2.5" fill="var(--sc-bronze-deep)" />
          <circle cx="19" cy="4" r="2.5" fill="var(--sc-bronze-deep)" />
          <circle cx="31" cy="8" r="2.5" fill="var(--sc-bronze-deep)" />
        </svg>
      )}
      <div
        style={{
          width: 78,
          height: 78,
          border: `2px solid ${PODIUM_BORDER[rank]}`,
          background: "var(--sc-panel-2)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          boxShadow: "var(--sh-plate-sm)",
        }}
      >
        {avatar ?? (
          <span
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--sc-bronze)",
              fontSize: 32,
              lineHeight: 1,
            }}
          >
            {name.charAt(0)}
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 24,
          color: "var(--sc-parchment)",
          lineHeight: 1.1,
          marginTop: 4,
          maxWidth: 200,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </span>
      <div style={{ display: "flex", gap: 6 }}>
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontWeight: 800,
            fontSize: 10,
            letterSpacing: "var(--ls-stamp)",
            textTransform: "uppercase",
            padding: "3px 9px",
            background: "var(--sc-page)",
            color: "var(--sc-bronze)",
            border: "1px solid var(--sc-bronze)",
            borderRadius: "var(--r-pill)",
          }}
        >
          Lv {level}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontWeight: 800,
            fontSize: 10,
            padding: "3px 9px",
            background: "var(--sc-page)",
            color: "var(--sc-parchment)",
            border: "1px solid var(--sc-rim-2)",
            borderRadius: "var(--r-pill)",
          }}
        >
          {rating}
        </span>
      </div>
      <div
        style={{
          marginTop: 12,
          width: "100%",
          height: PODIUM_HEIGHTS[rank],
          background: PODIUM_BG[rank],
          border: `3px solid ${PODIUM_BORDER[rank]}`,
          boxShadow: "var(--sh-plate-lg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          color: PODIUM_LABEL_COLOR[rank],
          fontSize: PODIUM_NUMBER_SIZE[rank],
          lineHeight: 1,
          letterSpacing: "0.02em",
          textShadow: "3px 3px 0 rgba(0,0,0,.3)",
        }}
      >
        {PODIUM_RANK_LABEL[rank]}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * ListingCard — Market full NFT-art card.
 *
 * Used by the marketplace browser. Per the design-tool screenshot:
 *   - Rarity badge top-left (LEGENDARY / EPIC / RARE / COMMON)
 *   - 2H badge top-right when applicable
 *   - Square NFT art middle (aspect-ratio 1:1)
 *   - Slackey item name
 *   - Slot + stat line in mono ("WEAPON · STR +6 / END +2")
 *   - SUI price in bronze mono + bronze Buy CTA
 * ════════════════════════════════════════════════════════════════════ */

const RARITY_TINT: Record<number, { fg: string; bg: string }> = {
  1: { fg: "var(--rarity-common)", bg: "rgba(138,138,138,.15)" },
  2: { fg: "var(--rarity-uncommon)", bg: "rgba(74,156,74,.15)" },
  3: { fg: "var(--rarity-rare)", bg: "rgba(61,109,163,.15)" },
  4: { fg: "var(--rarity-epic)", bg: "rgba(125,75,165,.18)" },
  5: { fg: "var(--rarity-legendary)", bg: "rgba(200,154,63,.16)" },
};
const RARITY_NAME: Record<number, string> = {
  1: "Common",
  2: "Uncommon",
  3: "Rare",
  4: "Epic",
  5: "Legendary",
};

export interface ListingCardProps {
  imageUrl?: string;
  name: string;
  slotLabel: string;
  rarity: number;
  /** Stat summary line — e.g. "STR +6 / END +2". */
  statSummary?: string;
  priceSui: number;
  /** Two-handed indicator — renders the "2H" stamp in the top-right. */
  twoHanded?: boolean;
  onBuy?: () => void;
  onClick?: () => void;
}

export function ListingCard({
  imageUrl,
  name,
  slotLabel,
  rarity,
  statSummary,
  priceSui,
  twoHanded,
  onBuy,
  onClick,
}: ListingCardProps) {
  const tint = RARITY_TINT[rarity] ?? RARITY_TINT[1];
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      style={{
        background: "var(--sc-panel)",
        border: `1px solid var(--sc-rim)`,
        borderRadius: "var(--r-card)",
        boxShadow: "var(--sh-plate-sm), var(--rim-top), var(--rim-bottom)",
        display: "flex",
        flexDirection: "column",
        cursor: onClick ? "pointer" : "default",
        overflow: "hidden",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        transition: "transform var(--d-fast), border-color var(--d-fast)",
      }}
      onMouseEnter={(e) => {
        if (!onClick) return;
        e.currentTarget.style.borderColor = tint.fg;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = "var(--sc-rim)";
        e.currentTarget.style.transform = "";
      }}
    >
      <div
        style={{
          position: "relative",
          aspectRatio: "1 / 1",
          background: tint.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 14,
          borderBottom: `1px solid var(--sc-rim)`,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            fontFamily: "var(--font-ui)",
            fontWeight: 800,
            fontSize: 9,
            letterSpacing: "var(--ls-stamp)",
            textTransform: "uppercase",
            padding: "3px 8px",
            background: tint.fg,
            color: rarity === 5 ? "var(--sc-page)" : "var(--sc-parchment)",
            borderRadius: "var(--r-pill)",
          }}
        >
          {RARITY_NAME[rarity] ?? "Common"}
        </span>
        {twoHanded && (
          <span
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              fontFamily: "var(--font-mono)",
              fontWeight: 800,
              fontSize: 10,
              padding: "3px 8px",
              background: "var(--sc-blood)",
              color: "var(--sc-parchment)",
              borderRadius: "var(--r-sm)",
              border: "1px solid var(--sc-blood-deep)",
            }}
          >
            2H
          </span>
        )}
        {imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={imageUrl}
            alt={name}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              filter: "drop-shadow(0 3px 6px rgba(0,0,0,.45))",
            }}
          />
        ) : (
          <span
            style={{
              fontFamily: "var(--font-display)",
              color: tint.fg,
              fontSize: 40,
            }}
          >
            ?
          </span>
        )}
      </div>
      <div
        style={{
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--sc-parchment)",
            lineHeight: 1.1,
            letterSpacing: "0.01em",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--fg-3)",
            letterSpacing: ".06em",
            textTransform: "uppercase",
          }}
        >
          {slotLabel}
          {statSummary && (
            <>
              <span style={{ color: "var(--sc-rim-2)", margin: "0 6px" }}>·</span>
              <span style={{ color: "var(--fg-2)" }}>{statSummary}</span>
            </>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 6,
            gap: 8,
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 800,
              fontSize: 15,
              color: "var(--sc-bronze)",
            }}
          >
            {priceSui.toFixed(3).replace(/\.?0+$/, "")} SUI
          </span>
          {onBuy && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onBuy();
              }}
              style={{
                fontFamily: "var(--font-ui)",
                fontWeight: 800,
                fontSize: 10,
                letterSpacing: "var(--ls-button)",
                textTransform: "uppercase",
                padding: "5px 14px",
                background: "var(--sc-blood)",
                color: "var(--sc-parchment)",
                border: "1px solid var(--sc-blood-deep)",
                borderRadius: "var(--r-button)",
                cursor: "pointer",
                boxShadow: "var(--sh-plate-sm)",
              }}
            >
              Buy
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * DMRow — Tavern DM sidebar row.
 * ════════════════════════════════════════════════════════════════════ */

export interface DMRowProps {
  name: string;
  preview?: string;
  unread?: number;
  active?: boolean;
  avatar?: ReactNode;
  onClick?: () => void;
}

export function DMRow({
  name,
  preview,
  unread,
  active,
  avatar,
  onClick,
}: DMRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: active ? "rgba(200,154,63,0.16)" : "transparent",
        borderLeft: active
          ? "3px solid var(--sc-bronze)"
          : "3px solid transparent",
        border: "0",
        borderBottom: "1px solid var(--sc-rim)",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        transition: "background var(--d-fast)",
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = "var(--sc-panel-2)";
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          flexShrink: 0,
          background: "var(--sc-panel-2)",
          border: "1px solid var(--sc-rim-2)",
          borderRadius: "var(--r-sm)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {avatar ?? (
          <span
            style={{
              fontFamily: "var(--font-display)",
              color: "var(--sc-bronze)",
              fontSize: 16,
            }}
          >
            {name.charAt(0)}
          </span>
        )}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            color: active ? "var(--sc-bronze)" : "var(--sc-parchment)",
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </div>
        {preview && (
          <div
            style={{
              fontSize: 11,
              color: "var(--fg-3)",
              marginTop: 2,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {preview}
          </div>
        )}
      </div>
      {unread && unread > 0 ? (
        <span
          style={{
            flexShrink: 0,
            minWidth: 18,
            height: 18,
            padding: "0 6px",
            borderRadius: 999,
            background: "var(--sc-blood)",
            color: "var(--sc-parchment)",
            fontFamily: "var(--font-mono)",
            fontWeight: 800,
            fontSize: 10,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * OnlineRow — Tavern online sidebar row.
 * ════════════════════════════════════════════════════════════════════ */

export interface OnlineRowProps {
  name: string;
  level: number;
  online?: boolean;
  archetypeColor?: string;
  avatar?: ReactNode;
  onClick?: () => void;
}

export function OnlineRow({
  name,
  level,
  online = true,
  archetypeColor,
  avatar,
  onClick,
}: OnlineRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        background: "transparent",
        border: 0,
        borderBottom: "1px solid rgba(44,51,61,0.55)",
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "var(--font-ui)",
        color: "var(--sc-parchment)",
        transition: "background var(--d-fast)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--sc-panel-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <div
        style={{
          width: 30,
          height: 30,
          flexShrink: 0,
          background: "var(--sc-panel-2)",
          border: "1px solid var(--sc-rim-2)",
          borderRadius: "var(--r-sm)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          fontFamily: "var(--font-display)",
          color: "var(--sc-bronze)",
          overflow: "hidden",
        }}
      >
        {avatar ?? name.charAt(0)}
      </div>
      <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 13,
            color: archetypeColor ?? "var(--sc-parchment)",
            lineHeight: 1.1,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--fg-3)",
            letterSpacing: ".06em",
          }}
        >
          Lv {level}
        </span>
      </div>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: online ? "var(--rarity-uncommon)" : "var(--sc-blood)",
          boxShadow: online
            ? "0 0 6px var(--rarity-uncommon)"
            : "0 0 4px var(--sc-blood)",
          flexShrink: 0,
        }}
        aria-label={online ? "Online" : "Idle"}
      />
    </button>
  );
}

/* ════════════════════════════════════════════════════════════════════
 * SectionHeader — Slackey title + optional right-side action / pill.
 * Used inside cards/panels for "Recent fights", "Open Wagers", "Ladder"
 * sub-sections.
 * ════════════════════════════════════════════════════════════════════ */

export function SectionHeader({
  title,
  right,
  size = "md",
}: {
  title: string;
  right?: ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const fs = size === "lg" ? 30 : size === "sm" ? 18 : 24;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
        flexWrap: "wrap",
      }}
    >
      <h2
        style={{
          margin: 0,
          fontFamily: "var(--font-display)",
          fontSize: fs,
          color: "var(--sc-parchment)",
          lineHeight: 1.05,
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </h2>
      {right}
    </div>
  );
}
