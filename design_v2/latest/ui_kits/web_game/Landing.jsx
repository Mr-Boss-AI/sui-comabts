/* Landing.jsx — Wallet-not-connected hero screen. */

const Landing = ({ onConnect }) => (
  <div>
    <div className="hero" style={{ padding: "56px 0 64px" }}>
      <div className="container" style={{ position: "relative" }}>
        {/* Background watermark items */}
        <img src="../../assets/items/Skullcrusher_Maul.png" alt=""
          style={{ position: "absolute", top: 0, right: -30, width: 260, opacity: 0.15, transform: "rotate(18deg)", pointerEvents: "none" }}/>
        <img src="../../assets/items/wooden_buckler_shield.png" alt=""
          style={{ position: "absolute", bottom: -40, left: -30, width: 200, opacity: 0.12, transform: "rotate(-12deg)", pointerEvents: "none" }}/>

        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 32, alignItems: "center", position: "relative", zIndex: 2 }}>
          <div>
            <Stamp tone="black">Testnet · Live</Stamp>
            <h1 className="hero-wm" style={{ marginTop: 16 }}>
              SUI<br/><span className="red">COMBATS</span>
            </h1>
            <p style={{ fontSize: 22, fontWeight: 600, maxWidth: 520, marginTop: 16, lineHeight: 1.3 }}>
              Mint a fighter. Gear up with NFTs. Lock real SUI on the line and brawl through a 5-zone arena. <span style={{ background: "var(--sc-page)", color: "var(--sc-yellow)", padding: "0 6px", borderRadius: 4 }}>95/5</span> split on every wager.
            </p>
            <div style={{ display: "flex", gap: 16, marginTop: 28, alignItems: "center" }}>
              <Button variant="red" size="lg" onClick={onConnect}>
                Connect Wallet
              </Button>
              <Button variant="yellow" size="lg">
                Watch a Fight <IChev size={16} />
              </Button>
            </div>
            <div style={{ display: "flex", gap: 14, marginTop: 24, flexWrap: "wrap" }}>
              <Stamp tone="outline" outline>Walrus · Decentralized</Stamp>
              <Stamp tone="outline" outline>Open Source · MIT</Stamp>
              <Stamp tone="outline" outline>Move v5 Contracts</Stamp>
            </div>
          </div>

          {/* Stack of NFT cards as visual centerpiece */}
          <div style={{ position: "relative", height: 380 }}>
            <div className="sk-lg sk pop-in" style={{
              position: "absolute", top: 20, right: 80, width: 220, padding: 16,
              background: "var(--sc-panel)", transform: "rotate(-6deg)",
            }}>
              <Stamp tone="purple">Legendary</Stamp>
              <img src="../../assets/items/Skullcrusher_Maul.png" alt="" style={{ width: "100%", marginTop: 8 }}/>
              <div style={{ fontWeight: 800, marginTop: 4 }}>Skullcrusher Maul</div>
              <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, marginTop: 2 }}>0.750 SUI</div>
            </div>
            <div className="sk-lg sk pop-in" style={{
              position: "absolute", top: 100, right: 0, width: 220, padding: 16,
              background: "var(--sc-bronze)", color: "var(--sc-page)", transform: "rotate(4deg)", borderColor: "var(--sc-bronze-deep)",
            }}>
              <Stamp tone="black">Epic</Stamp>
              <img src="../../assets/items/Dancers_Aegis.png" alt="" style={{ width: "100%", marginTop: 8 }}/>
              <div style={{ fontWeight: 800, marginTop: 4 }}>Dancer's Aegis</div>
              <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, marginTop: 2 }}>0.220 SUI</div>
            </div>
            <div className="sk-lg sk pop-in" style={{
              position: "absolute", top: 200, right: 170, width: 220, padding: 16,
              background: "var(--sc-panel)", transform: "rotate(8deg)", borderColor: "var(--sc-blood)",
            }}>
              <Stamp tone="red">Legendary</Stamp>
              <img src="../../assets/items/Pendant_of_Wrath.png" alt="" style={{ width: "100%", marginTop: 8 }}/>
              <div style={{ fontWeight: 800, marginTop: 4 }}>Pendant of Wrath</div>
              <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, marginTop: 2 }}>0.690 SUI</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* "How it works" cards */}
    <div className="container" style={{ padding: "56px 0" }}>
      <h2 className="sc-h2" style={{ margin: 0 }}>Three steps. Then chaos.</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20, marginTop: 24 }}>
        {[
          { n: "01", t: "Mint your fighter", d: "One-click character mint. Living NFT — stats, wins, ELO all on chain.", bg: "var(--sc-bronze)", text: "var(--sc-page)" },
          { n: "02", t: "Gear up",            d: "Buy NFTs on the kiosk marketplace. 2H weapons, dual wield, full doll.", bg: "var(--sc-panel-2)", text: "var(--sc-parchment)" },
          { n: "03", t: "Lock in, brawl",    d: "20s turn timer, 5 zones, server-authoritative resolution. 95/5 settle.", bg: "var(--sc-blood)", text: "var(--sc-parchment)" },
        ].map((s, i) => (
          <div key={i} className="sk" style={{ padding: 24, background: s.bg, color: s.text, borderColor: i === 0 ? "var(--sc-bronze-deep)" : i === 2 ? "var(--sc-blood-deep)" : "var(--sc-rim-2)" }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 64, lineHeight: 1 }}>{s.n}</div>
            <div style={{ fontWeight: 800, fontSize: 22, marginTop: 8, letterSpacing: "-0.01em" }}>{s.t}</div>
            <div style={{ fontSize: 14, marginTop: 8, lineHeight: 1.45 }}>{s.d}</div>
          </div>
        ))}
      </div>
    </div>

    <div style={{ background: "var(--sc-page)", color: "var(--sc-parchment)", borderTop: "2px solid var(--sc-parchment)" }}>
      <div className="container" style={{ padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
        <span style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>SUI<span style={{ color: "var(--sc-red)" }}>COMBATS</span></span>
        <span style={{ opacity: 0.7 }}>Built on Sui · 35/35 Move tests · 1195/1195 QA · MIT licensed</span>
      </div>
    </div>
  </div>
);

window.Landing = Landing;
