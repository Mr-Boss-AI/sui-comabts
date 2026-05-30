/* Primitives.jsx — Button, Stamp, Card, Pill, etc.
   Exposes constructors on window so screen modules can compose without imports. */

const Button = ({ variant = "white", size = "md", className = "", children, ...rest }) => (
  <button {...rest} className={`btn ${variant} ${size === "lg" ? "lg" : size === "sm" ? "sm" : ""} ${className}`}>
    {children}
  </button>
);

const Stamp = ({ tone = "black", outline, children, className = "", style }) => (
  <span style={style} className={`stamp ${outline ? "outline" : tone} ${className}`}>{children}</span>
);

const Card = ({ pad = "md", tone = "white", className = "", style, children, tilt }) => {
  const bg = tone === "yellow" ? "var(--sc-yellow)"
           : tone === "paper"  ? "var(--bg-surface-2)"
           : tone === "dark"   ? "var(--sc-night)"
           : "var(--bg-surface)";
  const color = tone === "dark" ? "var(--sc-parchment)" : undefined;
  const tiltStyle = tilt ? { transform: `rotate(${tilt}deg)` } : null;
  return (
    <div className={`sk ${className} ${pad === "lg" ? "card-pad-lg" : pad === "sm" ? "" : "card-pad"}`}
         style={{ background: bg, color, ...tiltStyle, ...style }}>
      {children}
    </div>
  );
};

const Pill = ({ children, color = "var(--sc-parchment)", bg = "var(--sc-panel-2)", className = "" }) => (
  <span className={className} style={{
    display: "inline-flex", alignItems: "center", gap: 4,
    border: `1.5px solid ${color}`, color, background: bg,
    fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 11,
    padding: "3px 8px", borderRadius: 6,
  }}>{children}</span>
);

const Bar = ({ value, max = 100, fill = "#5a8a3a", segments = 5, showVal = true, label }) => {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="bar">
      <div className="fill" style={{ width: `${pct}%`, background: fill }} />
      <div className="ticks">
        {Array.from({ length: segments }).map((_, i) => <i key={i} />)}
      </div>
      {showVal && <div className="val">{label ?? `${value} / ${max}`}</div>}
    </div>
  );
};

const Section = ({ title, action, children, style }) => (
  <section style={{ marginTop: 32, ...style }}>
    {(title || action) && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        {title && <h2 className="sc-h3" style={{ margin: 0 }}>{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

const Avatar = ({ glyph = "🐸", size = 48, bg = "var(--sc-panel-2)" }) => (
  <div style={{
    width: size, height: size,
    border: "1px solid var(--sc-bronze)", borderRadius: 4,
    background: bg, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: size * 0.6, boxShadow: "2px 2px 0 0 #000",
    flexShrink: 0,
  }}>{glyph}</div>
);

const StatRow = ({ icon, label, value, color, max = 20 }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6, width: 70, color }}>
      {icon} <span style={{ fontWeight: 800, fontSize: 12, letterSpacing: ".06em" }}>{label}</span>
    </div>
    <div style={{ flex: 1, height: 8, background: "var(--sc-page)", borderRadius: 2, overflow: "hidden", border: "1px solid var(--sc-rim-2)" }}>
      <div style={{ width: `${Math.min(100, (value / max) * 100)}%`, height: "100%", background: color, transition: "width .3s" }} />
    </div>
    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, minWidth: 28, textAlign: "right", color }}>{value}</span>
  </div>
);

Object.assign(window, { Button, Stamp, Card, Pill, Bar, Section, Avatar, StatRow });
