/* CharacterScreen.jsx — v3 layout.
   Combats.ru / Russian-MMORPG reference: tall rectangular slots arranged in
   two vertical columns with a tall central NFT portrait, HP bar above the
   portrait, and an ornament panel below.

   Slot inventory (matching reference, 13 slots):
     LEFT  (top → bottom):  helmet · shoulders* · weapon · chest · belt
     RIGHT (top → bottom):  necklace · [ring1 ring2 ring3*] · gloves · offhand · pants* · boots
   * = future-contract slot. Placeholder tiles render disabled/dimmed today;
       wire up when the new Move contract ships the additional Item slot_types.
       This keeps the layout stable across the contract upgrade. */

const PORTRAIT_KEY = "sui_combats_portrait_v1";

/* ------------------------------------------------------------ slot tile */
const SlotTile = ({ item, IconComp, onClick, w, h, future, dirty, locked, label }) => {
  const rarityColor = item ? RARITY_COLOR[item.rarity] : null;
  return (
    <button
      onClick={future || locked ? undefined : onClick}
      className="press"
      title={future ? `${label || "Slot"} — coming in v6 contract` : item ? item.name : label || "Empty slot"}
      style={{
        width: w, height: h, padding: 0, cursor: future ? "not-allowed" : "pointer",
        background: future ? "var(--sc-page)" : "var(--sc-panel-2)",
        border: `2px solid ${rarityColor || "var(--sc-rim-2)"}`,
        borderRadius: 2,
        opacity: future ? 0.45 : 1,
        boxShadow: dirty
          ? "0 0 0 1px var(--sc-bronze)"
          : "inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.55), 1px 1px 0 rgba(0,0,0,.6)",
        position: "relative", overflow: "hidden",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "transform .15s, border-color .15s, box-shadow .15s",
      }}>
      {item ? (
        <img src={item.img} alt={item.name}
             style={{ width: "100%", height: "100%", objectFit: "contain", padding: 4,
                      filter: "drop-shadow(0 2px 2px rgba(0,0,0,.5))" }}/>
      ) : (
        <IconComp size={Math.min(w, h) * 0.42} color={future ? "var(--sc-ash-2)" : "var(--sc-ash)"} />
      )}
      {future && (
        <span style={{
          position: "absolute", bottom: 2, right: 3,
          fontFamily: "var(--font-mono)", fontSize: 8, fontWeight: 700,
          color: "var(--sc-bronze)", letterSpacing: ".06em",
          background: "rgba(10,13,18,.85)", padding: "1px 3px",
        }}>v6</span>
      )}
      {dirty && (
        <span style={{
          position: "absolute", top: -3, right: -3, width: 8, height: 8,
          borderRadius: 999, background: "var(--sc-bronze)",
          boxShadow: "0 0 6px var(--sc-bronze-hot)",
        }} />
      )}
    </button>
  );
};

/* ----------------------------------------------------------- HP bar at top */
const HpBar = ({ current, max }) => {
  const pct = Math.min(100, (current / max) * 100);
  return (
    <div style={{
      position: "relative", height: 22,
      background: "var(--sc-page)",
      border: "2px solid var(--sc-bronze)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.06), inset 0 -2px 0 rgba(0,0,0,.55)",
    }}>
      <div style={{
        position: "absolute", inset: 0,
        background: `linear-gradient(180deg, #7ba84a 0%, #5a8a3a 50%, #3f6b29 100%)`,
        width: `${pct}%`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,.25), inset 0 -1px 0 rgba(0,0,0,.4)",
      }}/>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13,
        color: "var(--sc-parchment)",
        textShadow: "0 0 4px rgba(0,0,0,.9), 1px 1px 0 #000",
        letterSpacing: "0.06em",
      }}>{current.toLocaleString()} / {max.toLocaleString()}</div>
    </div>
  );
};

/* ------------------------------------------------------- Portrait frame */
const PortraitFrame = ({ portrait, onClick }) => (
  <button onClick={onClick} className="press"
    style={{
      flex: 1, padding: 0, cursor: "pointer", overflow: "hidden",
      width: "100%", minHeight: 0,
      background: portrait ? "var(--sc-page)" : "#0a0a0c",
      border: "2px solid var(--sc-bronze)",
      borderRadius: 0,
      boxShadow: "inset 0 0 0 1px rgba(0,0,0,.4), inset 0 2px 4px rgba(0,0,0,.6)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 14,
      position: "relative",
    }}>
    {portrait ? (
      <>
        <img src={portrait.img} alt={portrait.name}
             style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
        <span style={{
          position: "absolute", left: 6, top: 6,
          fontFamily: "var(--font-ui)", fontSize: 9, fontWeight: 700,
          letterSpacing: ".14em", textTransform: "uppercase",
          color: "var(--sc-bronze)", background: "rgba(10,13,18,.85)",
          padding: "3px 8px", border: "1px solid var(--sc-bronze)",
        }}>Portrait</span>
      </>
    ) : (
      <>
        <div style={{
          width: 60, height: 60,
          border: "2px solid var(--sc-bronze)",
          color: "var(--sc-bronze)",
          display: "flex", alignItems: "center", justifyContent: "center",
          opacity: 0.55,
        }}>
          <IPlus size={36} color="var(--sc-bronze)" stroke={3}/>
        </div>
        <div style={{
          fontFamily: "var(--font-ui)", fontWeight: 800, fontSize: 14,
          letterSpacing: ".18em", textTransform: "uppercase",
          color: "var(--sc-ash)", textAlign: "center",
        }}>Place your NFT here</div>
        <div style={{
          fontFamily: "var(--font-ui)", fontSize: 11,
          color: "var(--sc-ash-2)", textAlign: "center",
          maxWidth: 200, lineHeight: 1.45,
          marginTop: -8,
        }}>Click to choose a portrait —<br/>cosmetic only</div>
      </>
    )}
  </button>
);

/* ----------------------------------------- Ornament panel beneath portrait
   Tribal heraldic flourish to soften the bottom of the frame. Pure
   decoration; bronze on dark steel. */
const Ornament = () => (
  <div style={{
    height: 56, background: "var(--sc-panel-3)",
    border: "1px solid var(--sc-rim-2)",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,.04), inset 0 -1px 0 rgba(0,0,0,.55)",
    display: "flex", alignItems: "center", justifyContent: "center",
    overflow: "hidden",
  }}>
    <svg viewBox="0 0 360 60" width="100%" height="100%" fill="none">
      <g stroke="var(--sc-rim-2)" strokeWidth="1.5" strokeLinecap="round">
        <path d="M40 30 Q 80 8 130 22 Q 160 30 170 30" />
        <path d="M40 30 Q 80 52 130 38 Q 160 30 170 30" />
        <path d="M70 12 L 60 24 M 90 18 L 78 28 M 50 18 L 62 30" />
        <path d="M320 30 Q 280 8 230 22 Q 200 30 190 30" />
        <path d="M320 30 Q 280 52 230 38 Q 200 30 190 30" />
        <path d="M290 12 L 300 24 M 270 18 L 282 28 M 310 18 L 298 30" />
      </g>
      <g stroke="var(--sc-bronze)" strokeWidth="1.5" fill="none">
        <circle cx="180" cy="30" r="14" />
        <circle cx="180" cy="30" r="9" />
      </g>
      <text x="180" y="34" textAnchor="middle"
            fontFamily="var(--font-display)" fontSize="13"
            fill="var(--sc-bronze)" letterSpacing="1">SUI</text>
    </svg>
  </div>
);

/* ----------------------------------------- Title bar above the frame */
const FrameTitle = ({ player }) => (
  <div style={{
    display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    padding: "10px 0", fontFamily: "var(--font-ui)",
  }}>
    {/* class crest */}
    <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--sc-bronze)" stroke="var(--sc-page)" strokeWidth="1.2">
      <path d="M12 2L22 9L20 22L12 18L4 22L2 9z"/>
    </svg>
    <span style={{
      fontFamily: "var(--font-display)", fontSize: 26, lineHeight: 1,
      color: "var(--sc-bronze)", letterSpacing: "0.02em",
    }}>{player.archetype}</span>
    <span style={{
      fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 18,
      color: "var(--sc-bronze)", opacity: .85,
    }}>[{player.level}]</span>
    <button title="Build info" style={{
      width: 22, height: 22, padding: 0,
      background: "var(--sc-steel)", color: "var(--sc-parchment)",
      border: "1px solid var(--sc-steel-deep)",
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "serif", fontWeight: 900, fontSize: 13, fontStyle: "italic",
    }}>i</button>
  </div>
);

/* ------------------------------------------ THE NEW EQUIPMENT FRAME */
const EquipmentFrame = ({ equipped, portrait, onPortrait, hp, player, tweaks }) => {
  const bigW = tweaks.bigSlotW;
  const bigH = tweaks.bigSlotH;
  const ringS = tweaks.ringSlotSize;
  const beltH = tweaks.beltSlotH;
  const colGap = tweaks.colGap;
  const slotGap = tweaks.slotGap;

  const colWidth = bigW;
  const frameInnerPad = tweaks.framePad;

  return (
    <div style={{ width: "fit-content" }}>
      <FrameTitle player={player} />

      {/* The double-bronze outer frame */}
      <div style={{
        background: "var(--sc-panel)",
        border: "2px solid var(--sc-bronze-deep)",
        boxShadow: "0 0 0 1px var(--sc-rim) inset, var(--sh-plate-lg)",
        padding: frameInnerPad,
        display: "grid",
        gridTemplateColumns: `${colWidth}px ${colGap}px 1fr ${colGap}px ${colWidth}px`,
        alignItems: "stretch",
      }}>
        {/* LEFT COLUMN */}
        <div style={{ display: "flex", flexDirection: "column", gap: slotGap, gridColumn: 1 }}>
          <SlotTile item={equipped.helmet}    IconComp={IHelm}    w={bigW} h={bigH} label="Helmet"/>
          <SlotTile                            IconComp={IShield}  w={bigW} h={bigH} future label="Shoulders"/>
          <SlotTile item={equipped.weapon}    IconComp={ISword}   w={bigW} h={bigH} label="Weapon" dirty/>
          <SlotTile item={equipped.chest}     IconComp={IChest}   w={bigW} h={bigH} label="Chest"/>
          <SlotTile item={equipped.belt}      IconComp={IBelt}    w={bigW} h={beltH} label="Belt"/>
        </div>

        {/* GAP COLUMN */}
        <div style={{ gridColumn: 2 }} />

        {/* CENTER (HP + portrait + ornament) */}
        <div style={{
          gridColumn: 3, display: "flex", flexDirection: "column", gap: slotGap,
          minHeight: bigH * 4 + beltH + slotGap * 4,
        }}>
          <HpBar current={hp.current} max={hp.max} />
          <PortraitFrame portrait={portrait} onClick={onPortrait} />
          <Ornament />
        </div>

        {/* GAP COLUMN */}
        <div style={{ gridColumn: 4 }} />

        {/* RIGHT COLUMN */}
        <div style={{ display: "flex", flexDirection: "column", gap: slotGap, gridColumn: 5 }}>
          <SlotTile item={equipped.necklace} IconComp={IAmulet}  w={bigW} h={bigH} label="Necklace"/>
          {/* ring row */}
          <div style={{
            display: "flex", justifyContent: "space-between", gap: slotGap,
            height: ringS,
          }}>
            <SlotTile item={equipped.ring1} IconComp={IRing} w={ringS} h={ringS} label="Ring 1"/>
            <SlotTile item={equipped.ring2} IconComp={IRing} w={ringS} h={ringS} label="Ring 2"/>
            <SlotTile                       IconComp={IRing} w={ringS} h={ringS} future label="Ring 3"/>
          </div>
          <SlotTile item={equipped.gloves}    IconComp={IGloves}  w={bigW} h={bigH - (ringS + slotGap) / 2} label="Gloves"/>
          <SlotTile item={equipped.offhand}   IconComp={IShield}  w={bigW} h={bigH} label="Off-hand"/>
          <SlotTile                            IconComp={IBoots}   w={bigW} h={bigH} future label="Pants"/>
          <SlotTile item={equipped.boots}     IconComp={IBoots}   w={bigW} h={beltH} label="Boots"/>
        </div>
      </div>
    </div>
  );
};

/* ===================================================== Top-level screen */
const CharacterScreen = ({ player, tweaks = {} }) => {
  const { useState, useEffect } = React;
  const derived = player.derived;
  const winRate = Math.round((player.wins / (player.wins + player.losses)) * 100);
  const xpPct = (player.xp.current / player.xp.span) * 100;

  // Tweaks with defaults tuned to the reference image proportions.
  const T = {
    bigSlotW:      tweaks.bigSlotW      ?? 96,
    bigSlotH:      tweaks.bigSlotH      ?? 108,
    ringSlotSize:  tweaks.ringSlotSize  ?? 44,
    beltSlotH:     tweaks.beltSlotH     ?? 56,
    colGap:        tweaks.colGap        ?? 8,
    slotGap:       tweaks.slotGap       ?? 6,
    framePad:      tweaks.framePad      ?? 12,
    statRowPad:    tweaks.statRowPad    ?? 4,
  };

  const [portrait, setPortrait] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    try { const raw = localStorage.getItem(PORTRAIT_KEY); if (raw) setPortrait(JSON.parse(raw)); } catch {}
  }, []);

  function saveChoice(it) {
    setPortrait(it); setPickerOpen(false);
    try {
      if (it) localStorage.setItem(PORTRAIT_KEY, JSON.stringify(it));
      else localStorage.removeItem(PORTRAIT_KEY);
    } catch {}
  }

  const hp = { current: derived.maxHp, max: derived.maxHp };

  return (
    <div className="container" style={{ padding: "20px 24px 56px", display: "grid", gridTemplateColumns: "auto 1fr 280px", gap: 24, alignItems: "flex-start" }}>
      <EquipmentFrame
        equipped={EQUIPPED}
        portrait={portrait}
        onPortrait={() => setPickerOpen(true)}
        hp={hp}
        player={player}
        tweaks={T}
      />

      {/* MIDDLE — stats */}
      <div>
        <Card pad="md">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <Stamp tone="red">{player.archetype}</Stamp>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 36, margin: "6px 0 0", lineHeight: 1, color: "var(--sc-bronze)" }}>{player.name}</h2>
              <div style={{ marginTop: 6, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <Stamp tone="black">Lv {player.level}</Stamp>
                <Stamp tone="yellow">{player.rating} ELO</Stamp>
                <span style={{ fontSize: 12, color: "var(--fg-2)", fontWeight: 600 }}>
                  {player.wins}W · {player.losses}L · {winRate}%
                </span>
              </div>
            </div>
            <Button variant="white" size="sm">+{player.unallocated} pts</Button>
          </div>

          <div className="divider" style={{ margin: "10px 0" }}/>

          <div>
            <div className="sc-stamp" style={{ color: "var(--fg-3)" }}>Primary Attributes</div>
            <div style={{ marginTop: 6 }}>
              {[
                ["STR", player.stats.strength,  "var(--stat-str)",
                  <svg width="14" height="14" viewBox="0 0 24 24" stroke="var(--stat-str)" strokeWidth="2.4" fill="none" strokeLinecap="round"><path d="M6 12c0-3 2-5 5-5s4 2 5 5l2 0c0 4-3 7-7 7s-7-3-7-7z"/></svg>],
                ["DEX", player.stats.dexterity, "var(--stat-dex)", <IBolt size={14} color="var(--stat-dex)"/>],
                ["INT", player.stats.intuition, "var(--stat-int)", <ISpark size={14} color="var(--stat-int)"/>],
                ["END", player.stats.endurance, "var(--stat-end)", <IShieldPlus size={14} color="var(--stat-end)"/>],
              ].map(([label, val, c, icon]) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: 10, padding: `${T.statRowPad}px 0` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, width: 64, color: c }}>
                    {icon}<span style={{ fontWeight: 800, fontSize: 12, letterSpacing: ".08em" }}>{label}</span>
                  </div>
                  <div style={{ flex: 1, height: 7, background: "var(--sc-page)", borderRadius: 2, overflow: "hidden", border: "1px solid var(--sc-rim-2)" }}>
                    <div style={{ width: `${Math.min(100, (val / 20) * 100)}%`, height: "100%", background: c }}/>
                  </div>
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12, minWidth: 22, textAlign: "right", color: c }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="divider soft" style={{ margin: "8px 0" }}/>

          <div>
            <div className="sc-stamp" style={{ color: "var(--fg-3)" }}>Combat Stats</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 5, marginTop: 6 }}>
              {[
                ["HP",     derived.maxHp,                "var(--stat-hp)"],
                ["ATK",    derived.attackPower,          "var(--sc-blood)"],
                ["Crit",   `${derived.critChance}%`,     "var(--stat-int)"],
                ["Crit ×", `${derived.critMultiplier}x`, "var(--stat-int)"],
                ["Evade",  `${derived.evasionChance}%`,  "var(--stat-dex)"],
                ["Armor",  derived.armor,                "var(--sc-steel)"],
                ["Def",    derived.defense,              "var(--sc-bronze)"],
                ["Lv",     player.level,                 "var(--sc-parchment)"],
              ].map(([l, v, c]) => (
                <div key={l} style={{ background: "var(--sc-page)", border: "1px solid var(--sc-rim-2)", borderRadius: 2, padding: "5px 8px" }}>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "var(--fg-3)" }}>{l}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 16, color: c, marginTop: 1 }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700, letterSpacing: ".10em", textTransform: "uppercase", color: "var(--fg-3)" }}>
              <span>Lv {player.level} → {player.level + 1}</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{player.xp.current.toLocaleString()} / {player.xp.span.toLocaleString()} XP</span>
            </div>
            <div className="bar gold" style={{ height: 10, marginTop: 4 }}>
              <div className="fill" style={{ width: `${xpPct}%` }}/>
              <div className="ticks"><i/><i/><i/><i/><i/></div>
            </div>
          </div>
        </Card>

        <Section title="Recent fights" style={{ marginTop: 18 }}>
          <Card pad="md">
            {FIGHT_HISTORY.map((f, i) => (
              <div key={i} style={{
                display: "grid", gridTemplateColumns: "60px 1fr 80px 100px", gap: 12, padding: "8px 0",
                borderBottom: i === FIGHT_HISTORY.length - 1 ? "none" : "1px solid var(--sc-rim)",
                alignItems: "center",
              }}>
                <Stamp tone={f.result === "win" ? "green" : "red"}>{f.result === "win" ? "Win" : "Loss"}</Stamp>
                <span style={{ fontWeight: 700, fontSize: 13 }}>vs {f.opp}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13, color: f.elo.startsWith("+") ? "var(--rarity-uncommon)" : "var(--sc-blood)" }}>{f.elo}</span>
                <span style={{ fontSize: 11, color: "var(--fg-3)", textAlign: "right" }}>{f.reason}</span>
              </div>
            ))}
          </Card>
        </Section>
      </div>

      <div>
        <Section title="Inventory" style={{ marginTop: 0 }}
          action={<Stamp tone="outline" outline>{ITEMS.length}</Stamp>}>
          <Card pad="md">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
              {ITEMS.slice(0, 12).map(it => (
                <div key={it.id} className="press" style={{
                  border: `1px solid ${RARITY_COLOR[it.rarity]}`, borderRadius: 2,
                  background: "var(--sc-page)", padding: 4,
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,.04), inset 0 -1px 0 rgba(0,0,0,.5)",
                  aspectRatio: "1 / 1", display: "flex", flexDirection: "column",
                }}>
                  <img src={it.img} alt={it.name} style={{ width: "100%", flex: 1, objectFit: "contain" }}/>
                  <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: ".05em", textAlign: "center", lineHeight: 1.1, color: RARITY_COLOR[it.rarity], textTransform: "uppercase" }}>{it.slot}</div>
                </div>
              ))}
            </div>
          </Card>
        </Section>
      </div>

      {pickerOpen && (
        <PortraitPicker current={portrait} items={ITEMS}
          onClose={() => setPickerOpen(false)}
          onPick={saveChoice} onClear={() => saveChoice(null)} />
      )}
    </div>
  );
};

window.CharacterScreen = CharacterScreen;
