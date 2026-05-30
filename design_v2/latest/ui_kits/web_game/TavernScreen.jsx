/* TavernScreen.jsx — Global chat + DM + player sidebar. */

const TavernScreen = () => {
  const { useState } = React;
  const [draft, setDraft] = useState("");
  const [log, setLog] = useState(TAVERN_LOG);

  function send() {
    if (!draft.trim()) return;
    setLog(l => [...l, { who: "you", text: draft, ts: "now", color: "var(--sc-yellow)", self: true }]);
    setDraft("");
  }

  return (
    <div className="container" style={{ padding: "32px 24px 64px", display: "grid", gridTemplateColumns: "280px 1fr 240px", gap: 24, height: "calc(100vh - 72px - 110px)" }}>

      {/* LEFT — DM list */}
      <div>
        <Card pad="md">
          <div className="sc-stamp" style={{ color: "var(--fg-2)" }}>Direct Messages</div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {PLAYERS_ONLINE.slice(0, 5).map((p, i) => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, borderRadius: 10, background: i === 0 ? "var(--sc-yellow)" : "transparent", border: i === 0 ? "2px solid var(--sc-parchment)" : "2px solid transparent", cursor: "pointer" }}>
                <Avatar glyph={p.glyph} size={36}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {i === 0 ? "gg that crit was cooked" : i === 1 ? "wager 1.0 if you down" : "—"}
                  </div>
                </div>
                {i === 0 && <span style={{ width: 8, height: 8, borderRadius: 999, background: "var(--sc-red)" }}/>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* CENTER — global tavern */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
        <Card pad="md" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 12, borderBottom: "2px solid var(--sc-parchment)" }}>
            <div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 28, lineHeight: 1 }}>The Tavern</div>
              <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 2 }}>Global · {PLAYERS_ONLINE.length} online</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Stamp tone="green">Live</Stamp>
              <Button variant="white" size="sm">Mute</Button>
            </div>
          </div>

          <div className="scroll-y" style={{ flex: 1, padding: "16px 4px", display: "flex", flexDirection: "column", gap: 10 }}>
            {log.map((m, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, justifyContent: m.self ? "flex-end" : "flex-start" }}>
                {!m.self && <Avatar glyph={m.bot ? "🤖" : "🐸"} size={32} bg={m.bot ? "var(--sc-parchment)" : m.color}/>}
                <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", alignItems: m.self ? "flex-end" : "flex-start" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ fontWeight: 800, fontSize: 13, color: m.bot ? "var(--sc-parchment)" : m.color }}>{m.who}{m.bot && " · bot"}</span>
                    <span style={{ fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>{m.ts}</span>
                  </div>
                  <div style={{
                    marginTop: 4, padding: "8px 14px",
                    background: m.self ? "var(--sc-yellow)" : m.bot ? "var(--sc-parchment)" : "var(--sc-parchment)",
                    color: m.bot ? "var(--sc-yellow)" : "var(--sc-parchment)",
                    border: "2px solid var(--sc-parchment)", borderRadius: 14,
                    fontSize: 14, fontWeight: 600,
                    boxShadow: "2px 2px 0 0 #000",
                  }}>{m.text}</div>
                </div>
                {m.self && <Avatar glyph="🐸" size={32}/>}
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, paddingTop: 12, borderTop: "2px solid var(--sc-parchment)" }}>
            <input
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => e.key === "Enter" && send()}
              placeholder="Say something… /wager NAME 0.5"
              className="input"
              style={{ flex: 1 }}
            />
            <Button variant="red" size="md" onClick={send}>
              <ISend size={16} color="var(--sc-parchment)"/> Send
            </Button>
          </div>
        </Card>
      </div>

      {/* RIGHT — players online */}
      <div>
        <Card pad="md">
          <div className="sc-stamp" style={{ color: "var(--fg-2)" }}>Online · {PLAYERS_ONLINE.length}</div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {PLAYERS_ONLINE.map(p => (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 8 }}>
                <Avatar glyph={p.glyph} size={28}/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: "var(--fg-3)", fontFamily: "var(--font-mono)" }}>Lv {p.lv}</div>
                </div>
                <span style={{
                  width: 8, height: 8, borderRadius: 999,
                  background: p.status === "online" ? "var(--rarity-uncommon)" :
                              p.status === "fighting" ? "var(--sc-red)" : "var(--fg-3)",
                }}/>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

window.TavernScreen = TavernScreen;
