/* ArenaScreen.jsx — Three fight types + active wager lobby. */

const ArenaScreen = ({ onEnterFight }) => {
  const { useState } = React;
  const [mode, setMode] = useState("ranked");
  const WAGERS = [
    { player: "FrogLord420",   lv: 17, elo: 2310, stake: 1.000, glyph: "🐸", min: "Lv 14+" },
    { player: "PepeWizard",    lv: 16, elo: 2244, stake: 0.500, glyph: "🧙", min: "any" },
    { player: "BonkSmash",     lv: 11, elo: 1820, stake: 0.200, glyph: "🔨", min: "Lv 8+" },
    { player: "MoonCatHiss",   lv: 18, elo: 2401, stake: 2.500, glyph: "😼", min: "Lv 15+" },
  ];

  return (
    <div className="container" style={{ padding: "32px 24px 64px" }}>
      {/* Fight type chooser */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
        {[
          { id: "friendly", label: "Friendly",  desc: "No ELO. No stakes. Vibes only.",      bg: "var(--sc-parchment)",  cta: "Find a sparring partner", icon: <ISwords size={28} color="var(--sc-parchment)"/> },
          { id: "ranked",   label: "Ranked",    desc: "ELO on the line. Climb the ladder.",  bg: "var(--sc-yellow)", cta: "Enter Queue",              icon: <ICrown size={28} color="var(--sc-parchment)"/> },
          { id: "wager",    label: "Wager",     desc: "Real SUI. 95/5 to the winner.",        bg: "var(--sc-red)",    cta: "Create Wager",             icon: <ICoin size={28} color="var(--sc-parchment)"/>, dark: true },
        ].map(c => (
          <div key={c.id} className={`sk press ${mode === c.id ? "" : "tilt"}`}
               style={{
                 padding: 24, background: c.bg, color: c.dark ? "var(--sc-parchment)" : "var(--sc-parchment)",
                 boxShadow: mode === c.id ? "var(--sh-sticker-lg)" : "var(--sh-sticker)",
                 transform: mode === c.id ? "translate(-2px,-2px) rotate(-1deg)" : "none",
               }}
               onClick={() => setMode(c.id)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              {c.icon}
              {mode === c.id && <Stamp tone={c.dark ? "yellow" : "black"}>Selected</Stamp>}
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, marginTop: 16 }}>{c.label}</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 6, opacity: 0.85 }}>{c.desc}</div>
            <Button variant={c.dark ? "yellow" : "dark"} size="md" className="press"
                    style={{ marginTop: 16, width: "100%" }}
                    onClick={e => { e.stopPropagation(); onEnterFight && onEnterFight(); }}>
              {c.cta} <IChev size={14} color={c.dark ? "var(--sc-parchment)" : "var(--sc-yellow)"}/>
            </Button>
          </div>
        ))}
      </div>

      {/* Active wagers (visible only when wager mode) */}
      <Section title={mode === "wager" ? "Open wagers" : mode === "ranked" ? "Queue" : "Find a partner"}
        action={
          mode === "wager" ?
            <Button variant="red" size="sm">+ New Wager</Button>
          : mode === "ranked" ?
            <Stamp tone="yellow" className="wobble">Searching… 14s</Stamp>
          :
            <Button variant="white" size="sm">Friend request</Button>
        }>
        {mode === "wager" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
            {WAGERS.map(w => (
              <Card key={w.player} className="press tilt" pad="md" style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <Avatar glyph={w.glyph} size={64} bg="var(--sc-yellow)"/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{w.player}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center" }}>
                    <Stamp tone="black">Lv {w.lv}</Stamp>
                    <Stamp tone="outline" outline>{w.elo} ELO</Stamp>
                    <Stamp tone="outline" outline>{w.min}</Stamp>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 22 }}>{w.stake.toFixed(3)}</span>
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: "var(--fg-2)" }}>SUI</span>
                    <Stamp tone="red">Stake</Stamp>
                  </div>
                </div>
                <Button variant="red" size="md">Accept</Button>
              </Card>
            ))}
          </div>
        )}

        {mode === "ranked" && (
          <Card pad="lg" tone="paper" style={{ textAlign: "center" }}>
            <div className="wobble" style={{ display: "inline-block", fontSize: 88, lineHeight: 1, filter: "drop-shadow(4px 4px 0 var(--sc-parchment))" }}>🐸</div>
            <h3 style={{ fontFamily: "var(--font-display)", fontSize: 36, margin: "16px 0 6px" }}>Looking for fighter…</h3>
            <p style={{ color: "var(--fg-2)", fontSize: 14 }}>Matchmaking around ELO {PLAYER.rating}. ETA &lt; 60s.</p>
            <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 16 }}>
              <Button variant="white" size="md">Cancel</Button>
              <Button variant="dark" size="md">Widen ELO range</Button>
            </div>
          </Card>
        )}

        {mode === "friendly" && (
          <Card pad="lg">
            <h3 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" }}>Pick someone online</h3>
            <p style={{ margin: "4px 0 14px", color: "var(--fg-2)", fontSize: 14 }}>Send them a fight request. No ELO change either way.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {PLAYERS_ONLINE.slice(0, 4).map(p => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 12px", border: "2px solid var(--sc-parchment)", borderRadius: 10, background: "var(--bg-surface-2)" }}>
                  <Avatar glyph={p.glyph} size={40}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "var(--fg-2)" }}>Lv {p.lv} · {p.rating} ELO</div>
                  </div>
                  <Stamp tone={p.status === "online" ? "green" : p.status === "fighting" ? "red" : "outline"} outline={p.status === "afk"}>{p.status}</Stamp>
                  <Button variant="yellow" size="sm" disabled={p.status !== "online"}>Challenge</Button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
};

window.ArenaScreen = ArenaScreen;
