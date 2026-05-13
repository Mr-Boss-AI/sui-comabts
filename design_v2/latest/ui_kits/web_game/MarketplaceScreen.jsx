/* MarketplaceScreen.jsx — Browse / list / your kiosk. */

const ItemCard = ({ item, onClick }) => (
  <div className="press tilt sk" style={{
    background: "var(--sc-panel)", overflow: "hidden",
    display: "flex", flexDirection: "column", cursor: "pointer",
  }} onClick={onClick}>
    <div style={{ position: "relative", aspectRatio: "1 / 1", borderBottom: "2px solid var(--sc-parchment)", background: "var(--bg-surface-2)" }}>
      <Stamp tone="outline" outline style={{ position: "absolute", top: 10, left: 10, background: "var(--sc-panel)", color: RARITY_COLOR[item.rarity], borderColor: RARITY_COLOR[item.rarity] }}>
        {item.rarity}
      </Stamp>
      {item.tag && <Stamp tone="red" style={{ position: "absolute", top: 10, right: 10 }}>{item.tag}</Stamp>}
      <img src={item.img} alt={item.name} style={{ width: "100%", height: "100%", objectFit: "contain", padding: 24 }}/>
    </div>
    <div style={{ padding: "10px 14px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{item.name}</div>
      <div style={{ fontSize: 11, color: "var(--fg-2)", fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>{item.slot} · {item.stats}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16 }}>{item.price.toFixed(3)} <span style={{ color: "var(--fg-2)", fontSize: 12 }}>SUI</span></span>
        <Button variant="red" size="sm">Buy</Button>
      </div>
    </div>
  </div>
);

const MarketplaceScreen = () => {
  const { useState } = React;
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = ITEMS.filter(i =>
    (filter === "all" || i.rarity.toLowerCase() === filter) &&
    (search === "" || i.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="container" style={{ padding: "32px 24px 64px", display: "grid", gridTemplateColumns: "240px 1fr 280px", gap: 24 }}>
      {/* LEFT — filters */}
      <div>
        <Card pad="md">
          <div className="sc-stamp" style={{ color: "var(--fg-2)" }}>Search</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, border: "2px solid var(--sc-parchment)", borderRadius: 8, padding: "8px 12px", background: "var(--sc-panel)", boxShadow: "2px 2px 0 0 #000" }}>
            <ISearch size={16} color="var(--sc-parchment)"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Maul, ring, hood…"
                   style={{ border: 0, outline: 0, flex: 1, background: "transparent", fontFamily: "var(--font-ui)", fontSize: 14 }}/>
          </div>

          <div className="sc-stamp" style={{ color: "var(--fg-2)", marginTop: 18 }}>Rarity</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {["all","common","uncommon","rare","epic","legendary"].map(r => (
              <button key={r}
                onClick={() => setFilter(r)}
                style={{
                  border: "2px solid var(--sc-parchment)", borderRadius: 999,
                  padding: "6px 12px", fontWeight: 700, fontSize: 12,
                  textTransform: "uppercase", letterSpacing: ".08em",
                  background: filter === r ? "var(--sc-parchment)" : "var(--sc-parchment)",
                  color: filter === r ? "var(--sc-yellow)" : "var(--sc-parchment)",
                  cursor: "pointer", textAlign: "left",
                  fontFamily: "var(--font-ui)",
                }}>
                {r === "all" ? "All rarities" : r}
              </button>
            ))}
          </div>

          <div className="sc-stamp" style={{ color: "var(--fg-2)", marginTop: 18 }}>Slot</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {["weapon","offhand","helmet","chest","gloves","boots","ring","necklace"].map(s => (
              <Stamp key={s} tone="outline" outline className="press" style={{ cursor: "pointer" }}>{s}</Stamp>
            ))}
          </div>
        </Card>
      </div>

      {/* CENTER — grid */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 className="sc-h3" style={{ margin: 0 }}>{filtered.length} listings</h2>
          <div style={{ display: "flex", gap: 6 }}>
            <Stamp tone="black">Low to High</Stamp>
            <Stamp tone="outline" outline>Recent</Stamp>
            <Stamp tone="outline" outline>Rarity</Stamp>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {filtered.map(it => <ItemCard key={it.id} item={it}/>)}
        </div>
      </div>

      {/* RIGHT — my kiosk */}
      <div>
        <Section title="Your kiosk" style={{ marginTop: 0 }}
          action={<Stamp tone="yellow">2 listed</Stamp>}>
          <Card pad="md">
            <p style={{ fontSize: 13, color: "var(--fg-2)", margin: 0, lineHeight: 1.45 }}>
              Listings get 2.5% royalty on sale. Delist returns items to your wallet atomically.
            </p>
            <Button variant="yellow" size="md" style={{ marginTop: 12, width: "100%" }}>+ List an item</Button>

            <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
              {[ITEMS[2], ITEMS[5]].map(it => (
                <div key={it.id} style={{ display: "flex", gap: 10, padding: 8, border: "2px solid var(--sc-parchment)", borderRadius: 10, background: "var(--bg-surface-2)" }}>
                  <img src={it.img} style={{ width: 48, height: 48, objectFit: "contain", background: "var(--sc-panel)", border: "1.5px solid var(--sc-parchment)", borderRadius: 6 }}/>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{it.name}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700 }}>{it.price.toFixed(3)} SUI</div>
                  </div>
                  <button style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--sc-red)", fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Delist</button>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      </div>
    </div>
  );
};

window.MarketplaceScreen = MarketplaceScreen;
