/**
 * Phase 2 v2 — Fight HP bar.
 *
 * Bronze-rim chunky bar with name + level above. Color flips on HP%:
 *   > 60%  → green (healthy)
 *   30-60% → bronze (bloodied)
 *   < 30%  → blood-red (critical, with pulse)
 *
 * Matches design_v2/latest/preview/components-hpbar.html threshold
 * colour transitions.
 */

interface HpBarProps {
  name: string;
  current: number;
  max: number;
  isLeft?: boolean;
  level?: number;
}

export function HpBar({ name, current, max, isLeft = true, level }: HpBarProps) {
  const pct = Math.max(0, (current / max) * 100);
  const fill =
    pct > 60
      ? "linear-gradient(180deg, #7ba84a 0%, #5a8a3a 50%, #3f6b29 100%)"
      : pct > 30
        ? "linear-gradient(180deg, var(--sc-bronze-hot) 0%, var(--sc-bronze) 50%, var(--sc-bronze-deep) 100%)"
        : "linear-gradient(180deg, #d44a36 0%, var(--sc-blood) 50%, var(--sc-blood-deep) 100%)";
  const critical = pct < 30;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isLeft ? "flex-start" : "flex-end",
        gap: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: isLeft ? "row" : "row-reverse",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 18,
            color: "var(--sc-parchment)",
            letterSpacing: "0.01em",
            maxWidth: 200,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {name}
        </span>
        {level && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 700,
              color: "var(--sc-bronze)",
            }}
          >
            Lv.{level}
          </span>
        )}
      </div>
      <div style={{ width: "100%", maxWidth: 260 }}>
        <div
          style={{
            position: "relative",
            height: 24,
            background: "var(--sc-page)",
            border: "2px solid var(--sc-bronze)",
            overflow: "hidden",
            boxShadow: critical
              ? "0 0 0 1px var(--sc-blood), inset 0 0 0 1px rgba(0,0,0,.5)"
              : "inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 0 rgba(0,0,0,.45)",
            animation: critical ? "hp-pulse 1.2s ease-in-out infinite" : undefined,
          }}
        >
          <div
            style={{
              height: "100%",
              background: fill,
              width: `${pct}%`,
              float: isLeft ? "left" : "right",
              transition: "width 700ms cubic-bezier(0.16, 1, 0.3, 1), background 200ms linear",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 0 rgba(0,0,0,.4)",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              fontSize: 12,
              color: "var(--sc-parchment)",
              textShadow: "0 0 4px #000, 1px 1px 0 #000",
              letterSpacing: ".04em",
              pointerEvents: "none",
            }}
          >
            {Math.round(current)} / {max}
          </div>
        </div>
        <style>{`
          @keyframes hp-pulse {
            0%, 100% { box-shadow: 0 0 0 1px var(--sc-blood), inset 0 0 0 1px rgba(0,0,0,.5); }
            50%      { box-shadow: 0 0 8px 2px var(--sc-blood), inset 0 0 0 1px rgba(0,0,0,.5); }
          }
        `}</style>
      </div>
    </div>
  );
}
