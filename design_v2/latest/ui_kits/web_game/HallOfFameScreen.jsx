/* HallOfFameScreen.jsx — Top 3 podium + leaderboard table. */

const HallOfFameScreen = () => {
  const top3 = LEADERS.slice(0, 3);
  const rest = LEADERS.slice(3);
  const heights = [180, 220, 150]; // 2nd, 1st (middle), 3rd
  const podiumOrder = [top3[1], top3[0], top3[2]];
  const podiumColors = ["var(--sc-parchment)", "var(--sc-yellow)", "var(--sc-red)"];
  const podiumLabels = ["2nd", "1st", "3rd"];
  const podiumStamps = ["outline","black","outline"];

  return (
    <div className="container" style={{ padding: "32px 24px 64px" }}>
      {/* PODIUM */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, alignItems: "end" }}>
        {podiumOrder.map((p, i) => p && (
          <div key={p.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            {i === 1 && <ICrown size={56} color="var(--sc-parchment)"/>}
            <Avatar glyph={p.glyph} size={i === 1 ? 96 : 72} bg={i === 1 ? "var(--sc-yellow)" : "var(--sc-parchment)"}/>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: i === 1 ? 32 : 24, lineHeight: 1 }}>{p.name}</div>
              <div style={{ marginTop: 6, display: "flex", gap: 6, justifyContent: "center" }}>
                <Stamp tone="black">Lv {p.lv}</Stamp>
                <Stamp tone="outline" outline>{p.rating}</Stamp>
              </div>
            </div>
            <div style={{
              width: "100%",
              height: heights[i],
              background: podiumColors[i],
              border: "3px solid var(--sc-parchment)",
              borderTopLeftRadius: 14, borderTopRightRadius: 14,
              boxShadow: "0 -6px 0 #000",
              display: "flex", alignItems: "flex-start", justifyContent: "center",
              paddingTop: 14, color: i === 2 ? "var(--sc-parchment)" : "var(--sc-parchment)",
              fontFamily: "var(--font-display)", fontSize: 48,
            }}>
              {podiumLabels[i]}
            </div>
          </div>
        ))}
      </div>

      {/* TABLE */}
      <Section title="Ladder" style={{ marginTop: 32 }} action={<Stamp tone="outline" outline>by ELO · 7-day</Stamp>}>
        <Card pad="md">
          <div style={{
            display: "grid", gridTemplateColumns: "60px 1fr 70px 90px 90px 90px",
            gap: 16, padding: "10px 12px", fontSize: 10, fontWeight: 700,
            letterSpacing: ".12em", textTransform: "uppercase", color: "var(--fg-2)",
            borderBottom: "2px solid var(--sc-parchment)",
          }}>
            <span>#</span><span>Fighter</span><span>Lv</span><span>ELO</span><span>W / L</span><span>Win %</span>
          </div>
          {rest.map(row => {
            const winRate = Math.round((row.wins / (row.wins + row.losses)) * 100);
            return (
              <div key={row.name} style={{
                display: "grid", gridTemplateColumns: "60px 1fr 70px 90px 90px 90px",
                gap: 16, padding: "12px", alignItems: "center",
                background: row.you ? "var(--sc-yellow)" : "transparent",
                borderRadius: row.you ? 10 : 0,
                border: row.you ? "2px solid var(--sc-parchment)" : "none",
                boxShadow: row.you ? "3px 3px 0 0 var(--sc-parchment)" : "none",
                marginTop: row.you ? 6 : 0,
                marginBottom: row.you ? 6 : 0,
              }}>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16 }}>#{row.rank}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar glyph={row.glyph} size={32}/>
                  <span style={{ fontWeight: 800 }}>{row.name}{row.you && " · you"}</span>
                </div>
                <Stamp tone="black">Lv {row.lv}</Stamp>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16 }}>{row.rating}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>
                  <span style={{ color: "var(--rarity-uncommon)" }}>{row.wins}</span>
                  {" / "}
                  <span style={{ color: "var(--sc-red)" }}>{row.losses}</span>
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>{winRate}%</span>
              </div>
            );
          })}
        </Card>
      </Section>
    </div>
  );
};

window.HallOfFameScreen = HallOfFameScreen;
