/* TownNav.jsx — Banner that sits below the Navbar inside the main game.
   Not actual tabs anymore — those moved into Navbar — this is a vibe-strip
   summarizing where you are and what's happening. */

const TownBanner = ({ area }) => {
  const COPY = {
    character:    { title: "Loadout",       sub: "Slot in your gear. The chain commits when you Save Loadout.",            tone: "yellow" },
    arena:        { title: "Arena",         sub: "Friendly · Ranked · Wager — pick your queue. Real SUI rides on wagers.", tone: "red" },
    marketplace:  { title: "Market",        sub: "Kiosk marketplace. 2.5% royalty on every buy. Atomic delist.",            tone: "paper" },
    tavern:       { title: "Tavern",        sub: "Global chat, DMs, fight requests. Big Bad Claude is watching.",          tone: "yellow" },
    hall_of_fame: { title: "Hall of Fame",  sub: "Leaderboard by ELO. Top 3 get the podium.",                              tone: "red" },
  };
  const c = COPY[area] || COPY.character;
  const bg = c.tone === "red" ? "var(--sc-red)"
          : c.tone === "yellow" ? "var(--sc-yellow)"
          : "var(--bg-surface-2)";
  const fg = c.tone === "red" ? "var(--sc-parchment)" : "var(--sc-parchment)";
  return (
    <div style={{
      background: bg, color: fg,
      borderBottom: "2px solid var(--sc-parchment)",
      padding: "20px 0",
    }}>
      <div className="container" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
        <div>
          <h1 className="sc-h2" style={{ margin: 0, fontSize: 48 }}>{c.title}</h1>
          <p style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 600, opacity: 0.9 }}>{c.sub}</p>
        </div>
        <Stamp tone={c.tone === "red" ? "yellow" : "black"} className="wobble" style={{ fontSize: 14, padding: "8px 14px" }}>
          {area === "arena" || area === "hall_of_fame" ? "v5 · testnet" : "On chain"}
        </Stamp>
      </div>
    </div>
  );
};

window.TownBanner = TownBanner;
