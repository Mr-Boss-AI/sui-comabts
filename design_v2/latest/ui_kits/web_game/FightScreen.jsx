/* FightScreen.jsx — Full-bleed arena. Black canvas, Slackey splash, zone selector,
   turn timer, fight log, HP bars, Lock-In button. */

const FightScreen = ({ onExit }) => {
  const { useState, useEffect } = React;
  const [round, setRound] = useState(3);
  const [time, setTime] = useState(14);
  const [attackZones, setAttackZones] = useState(["chest"]);
  const [blockZones, setBlockZones] = useState(["head", "stomach"]);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (locked) return;
    const t = setInterval(() => setTime(t => Math.max(0, t - 1)), 1000);
    return () => clearInterval(t);
  }, [locked]);

  const ZONES = ["head","chest","stomach","belt","legs"];
  function toggle(list, setter, z) {
    setter(list.includes(z) ? list.filter(x => x !== z) : [...list, z]);
  }

  return (
    <div style={{ background: "var(--sc-night)", color: "var(--sc-parchment)", minHeight: "calc(100vh - 72px)" }}>
      <div style={{
        maxWidth: 1400, margin: "0 auto", padding: "20px 24px",
        display: "grid", gridTemplateRows: "auto 1fr auto", gap: 16,
        minHeight: "calc(100vh - 72px)",
      }}>
        {/* TOP — round banner + timer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <Stamp tone="red">Wager · 0.500 SUI</Stamp>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 56, lineHeight: 1, marginTop: 4 }}>
              ROUND <span style={{ color: "var(--sc-yellow)" }}>{round}</span>
            </div>
          </div>
          <div style={{
            position: "relative", width: 120, height: 120,
            border: "4px solid var(--sc-yellow)", borderRadius: 999,
            background: "var(--sc-night-2)", display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: time < 5 ? "0 0 0 6px rgba(244,67,54,0.4)" : "none",
            animation: time < 5 ? "wobble 0.6s ease-in-out infinite" : "none",
          }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 48, lineHeight: 1, color: time < 10 ? "var(--sc-red)" : "var(--sc-yellow)" }}>{time}s</div>
          </div>
          <Button variant="white" size="sm" onClick={onExit}>Forfeit</Button>
        </div>

        {/* MIDDLE — fighters + log */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px 1fr", gap: 24, alignItems: "start" }}>
          {/* YOU */}
          <div>
            <div style={{ background: "var(--sc-night-2)", border: "3px solid var(--sc-yellow)", borderRadius: 14, padding: 16, boxShadow: "var(--sh-sticker-yellow)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Avatar glyph="🐸" size={56} bg="var(--sc-yellow)"/>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1 }}>{PLAYER.name}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: "var(--fg-3)" }}>Lv {PLAYER.level} · {PLAYER.archetype}</div>
                </div>
                <Stamp tone="yellow">YOU</Stamp>
              </div>
              <div style={{ marginTop: 12 }}>
                <Bar value={187} max={240} fill="var(--rarity-uncommon)" />
              </div>
            </div>

            {/* Big fighter portrait */}
            <div style={{
              marginTop: 18, height: 240, position: "relative",
              display: "flex", alignItems: "flex-end", justifyContent: "center",
              background: "linear-gradient(180deg, transparent 50%, rgba(255,176,0,0.08) 100%)",
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 200, lineHeight: 1, filter: "drop-shadow(6px 6px 0 var(--sc-yellow))" }}>🐸</div>
              <div className="dmg-pop" style={{ top: 40, left: "55%" }}>-18</div>
            </div>
          </div>

          {/* CENTER — Zone selector */}
          <div>
            <div style={{ background: "var(--sc-night-2)", border: "3px solid var(--sc-yellow)", borderRadius: 14, padding: 16, boxShadow: "var(--sh-sticker-yellow)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div className="sc-stamp" style={{ color: "var(--sc-yellow)", textAlign: "center" }}>Attack</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {ZONES.map((z, i) => (
                      <button key={`a-${z}`}
                        className={`zone ${attackZones.includes(z) ? "attack" : ""}`}
                        onClick={() => !locked && toggle(attackZones, setAttackZones, z)}
                        style={{ background: attackZones.includes(z) ? "var(--sc-red)" : "var(--sc-paper)", color: attackZones.includes(z) ? "var(--sc-parchment)" : "var(--sc-parchment)" }}>
                        {z}<span className="k">{i + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="sc-stamp" style={{ color: "var(--sc-yellow)", textAlign: "center" }}>Block</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                    {ZONES.map((z, i) => (
                      <button key={`b-${z}`}
                        className={`zone ${blockZones.includes(z) ? "block" : ""}`}
                        onClick={() => !locked && toggle(blockZones, setBlockZones, z)}
                        style={{ background: blockZones.includes(z) ? "var(--sc-parchment)" : "var(--sc-paper)", color: blockZones.includes(z) ? "var(--sc-yellow)" : "var(--sc-parchment)" }}>
                        {z}<span className="k">{["Q","W","E","R","T"][i]}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Button variant={locked ? "yellow" : "red"} size="lg"
                className={locked ? "" : "press pulse-red"}
                onClick={() => setLocked(l => !l)}
                style={{ width: "100%", marginTop: 16, fontSize: 22 }}
                disabled={attackZones.length === 0 || blockZones.length === 0}>
                {locked ? "✓ Locked In" : "Lock In"}
              </Button>
              <div style={{ marginTop: 6, fontSize: 11, color: "var(--fg-3)", textAlign: "center" }}>
                {locked ? "Waiting for opponent…" : `${attackZones.length} attack · ${blockZones.length} block`}
              </div>
            </div>

            {/* Fight log */}
            <div style={{ marginTop: 16, background: "var(--sc-night-2)", border: "2px solid var(--sc-yellow)", borderRadius: 14, padding: 14, maxHeight: 200, overflow: "auto" }}>
              <div className="sc-stamp" style={{ color: "var(--sc-yellow)" }}>Round 3 · Resolution</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {FIGHT_LOG.map((l, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 13, color: l.who === "you" ? "var(--sc-yellow)" : "var(--sc-red)", minWidth: 36 }}>{l.who === "you" ? "YOU" : "FOE"}</span>
                    <div style={{
                      flex: 1, padding: "6px 10px",
                      background: l.crit ? "var(--sc-yellow)" : l.miss ? "transparent" : "var(--bg-surface-2)",
                      border: l.miss ? "1.5px dashed var(--fg-3)" : "1.5px solid var(--sc-parchment)",
                      borderRadius: 8,
                      color: l.miss ? "var(--fg-3)" : "var(--sc-parchment)",
                      fontSize: 12, fontWeight: 700, fontStyle: l.miss ? "italic" : "normal",
                    }}>
                      {l.text}
                      {l.crit && <Stamp tone="red" style={{ marginLeft: 6, fontSize: 9 }}>×1.85</Stamp>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* OPPONENT */}
          <div>
            <div style={{ background: "var(--sc-night-2)", border: "3px solid var(--sc-red)", borderRadius: 14, padding: 16, boxShadow: "4px 4px 0 0 var(--sc-red)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexDirection: "row-reverse" }}>
                <Avatar glyph="🐕" size={56} bg="var(--sc-red)"/>
                <div style={{ flex: 1, textAlign: "right" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, lineHeight: 1 }}>{OPPONENT.name}</div>
                  <div style={{ marginTop: 2, fontSize: 12, color: "var(--fg-3)" }}>Lv {OPPONENT.level} · {OPPONENT.archetype}</div>
                </div>
                <Stamp tone="red">FOE</Stamp>
              </div>
              <div style={{ marginTop: 12 }}>
                <Bar value={OPPONENT.hp.current} max={OPPONENT.hp.max} fill="var(--sc-yellow)" />
              </div>
            </div>

            <div style={{
              marginTop: 18, height: 240, position: "relative",
              display: "flex", alignItems: "flex-end", justifyContent: "center",
              background: "linear-gradient(180deg, transparent 50%, rgba(244,67,54,0.08) 100%)",
              borderRadius: 12,
            }}>
              <div style={{ fontSize: 200, lineHeight: 1, filter: "drop-shadow(-6px 6px 0 var(--sc-red))", transform: "scaleX(-1)" }}>🐕</div>
              <div className="dmg-pop" style={{ top: 80, left: "30%", color: "var(--sc-yellow)" }}>-47!</div>
            </div>
          </div>
        </div>

        {/* BOTTOM — quick reference */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "center" }}>
          <Stamp tone="outline" outline style={{ color: "var(--sc-yellow)", borderColor: "var(--sc-yellow)" }}>1 · 2 · 3 · 4 · 5 to attack</Stamp>
          <Stamp tone="outline" outline style={{ color: "var(--sc-yellow)", borderColor: "var(--sc-yellow)" }}>Q W E R T to block</Stamp>
          <Stamp tone="outline" outline style={{ color: "var(--sc-yellow)", borderColor: "var(--sc-yellow)" }}>Space to Lock In</Stamp>
          <Stamp tone="outline" outline style={{ color: "var(--sc-yellow)", borderColor: "var(--sc-yellow)" }}>20s/turn</Stamp>
        </div>
      </div>
    </div>
  );
};

window.FightScreen = FightScreen;
