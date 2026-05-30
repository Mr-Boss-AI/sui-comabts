/* Navbar.jsx — Top bar. White bg, Slackey wordmark, navlinks with bold-on-hover.
   Spec from Ponke.xyz reference: logo left, links/identity center, balance + connect right. */

const Navbar = ({ connected, onConnect, character, area, onArea, onFight }) => {
  const { useState } = React;
  const [sound, setSound] = useState(true);
  const NAV = [
    { id: "character", label: "Character" },
    { id: "arena",     label: "Arena" },
    { id: "marketplace", label: "Market" },
    { id: "tavern",    label: "Tavern" },
    { id: "hall_of_fame", label: "Hall of Fame" },
  ];
  return (
    <nav style={{
      background: "var(--sc-panel)",
      borderBottom: "2px solid var(--sc-parchment)",
      position: "sticky", top: 0, zIndex: 40,
      boxShadow: "0 2px 0 0 rgba(0,0,0,0.06)",
    }}>
      <div className="container" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 32, lineHeight: 1, color: "var(--sc-parchment)" }}>
            SUI<span style={{ color: "var(--sc-red)", WebkitTextStroke: "2px var(--sc-parchment)" }}>COMBATS</span>
          </span>
          {character && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 16, borderLeft: "2px solid var(--sc-parchment)" }}>
              <Avatar glyph={character.glyph} size={36} />
              <div style={{ lineHeight: 1.1 }}>
                <div style={{ fontWeight: 800, fontSize: 14 }}>{character.name}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                  <Stamp tone="black">Lv {character.level}</Stamp>
                  <Stamp tone="yellow">{character.rating}</Stamp>
                </div>
              </div>
            </div>
          )}
        </div>

        {connected && (
          <div style={{ display: "flex", gap: 8 }}>
            {NAV.map(n => (
              <button key={n.id} className={`navlink ${area === n.id ? "active" : ""}`} data-label={n.label} onClick={() => onArea(n.id)}>
                {n.label}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {connected && (
            <span style={{
              display: "inline-flex", alignItems: "center", gap: 6,
              border: "2px solid var(--sc-parchment)", borderRadius: 8,
              padding: "5px 12px", background: "var(--sc-yellow)",
              fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13,
              boxShadow: "2px 2px 0 0 #000",
            }}>
              <img src="../../assets/sui-mark.svg" alt="" width="16" height="16" style={{ marginRight: 2 }}/>
              {character?.balance?.toFixed(2) ?? "0.00"} SUI
            </span>
          )}
          {connected && (
            <button onClick={() => setSound(s => !s)}
              style={{ border: 0, background: "transparent", cursor: "pointer", padding: 4 }}
              title={sound ? "Mute" : "Sound on"}>
              <ISound size={20} color="var(--sc-parchment)" />
            </button>
          )}
          {connected ? (
            <Button variant="dark" size="sm" onClick={onFight}>
              <ISwords size={14} color="var(--sc-yellow)" /> Quick Fight
            </Button>
          ) : (
            <Button variant="red" size="md" onClick={onConnect}>Connect Wallet</Button>
          )}
        </div>
      </div>
    </nav>
  );
};

window.Navbar = Navbar;
