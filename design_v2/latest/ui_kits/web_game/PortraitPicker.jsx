/* PortraitPicker.jsx — modal for choosing an NFT to display in the
   character portrait frame. Cosmetic only, no stat impact.

   Props:
     current  — currently-set NFT (or null)
     items    — array of NFTs to display
     onPick   — called with an item when user clicks "Set as Portrait"
     onClear  — clear portrait
     onClose  — close modal without changes */

const PortraitPicker = ({ current, items = [], onClose, onPick, onClear }) => {
  const { useState, useEffect } = React;
  const [hovered, setHovered] = useState(null);
  const [selected, setSelected] = useState(current);
  const [failedImgs, setFailedImgs] = useState({});

  // Esc closes
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isEmpty = items.length === 0;

  return (
    <>
      {/* Scrim */}
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
        zIndex: 100, animation: "pp-fade 200ms var(--ease-out) both",
      }}/>
      {/* Modal */}
      <div style={{
        position: "fixed", left: "50%", top: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(720px, 92vw)", maxHeight: "85vh",
        background: "var(--sc-panel)",
        border: "2px solid var(--sc-bronze)",
        borderRadius: 0,
        boxShadow: "0 24px 64px -8px rgba(0,0,0,.9), inset 0 1px 0 rgba(255,255,255,.05)",
        zIndex: 101,
        display: "flex", flexDirection: "column",
        animation: "pp-pop 280ms var(--ease-pop) both",
        fontFamily: "var(--font-ui)",
      }}>
        <style>{`
          @keyframes pp-fade { from { opacity: 0 } to { opacity: 1 } }
          @keyframes pp-pop { from { opacity: 0; transform: translate(-50%, -46%) scale(.96) } to { opacity: 1; transform: translate(-50%, -50%) scale(1) } }
          .pp-grid::-webkit-scrollbar { width: 6px; }
          .pp-grid::-webkit-scrollbar-thumb { background: var(--sc-rim-2); border-radius: 3px; }
          .pp-thumb { transition: transform .15s, border-color .15s; }
          .pp-thumb:hover { transform: translateY(-2px); border-color: var(--sc-bronze) !important; }
          @keyframes shimmer { from { background-position: -200% 0 } to { background-position: 200% 0 } }
        `}</style>

        {/* Header */}
        <div style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--sc-rim)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          gap: 16,
        }}>
          <div>
            <Stamp tone="black" style={{ color: "var(--sc-bronze)", borderColor: "var(--sc-bronze)" }}>Cosmetic · No stat impact</Stamp>
            <h2 style={{ margin: "8px 0 2px", fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em", color: "var(--sc-bronze)" }}>Choose Portrait</h2>
            <p style={{ margin: 0, fontSize: 13, color: "var(--fg-2)", lineHeight: 1.4 }}>
              Display any NFT from your wallet — pure cosmetic, no stat impact.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            border: "1px solid var(--sc-rim-2)", background: "var(--sc-page)",
            color: "var(--fg-2)", padding: 6, cursor: "pointer", borderRadius: 2,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <IX size={16} color="var(--fg-2)"/>
          </button>
        </div>

        {/* Body */}
        <div className="pp-grid scroll-y" style={{ padding: 16, overflowY: "auto", flex: 1, minHeight: 240 }}>
          {isEmpty ? (
            <PortraitEmpty />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
              {items.map(it => {
                const isSelected = selected?.id === it.id;
                const failed = failedImgs[it.id];
                return (
                  <button key={it.id} className="pp-thumb"
                    onClick={() => setSelected(it)}
                    onMouseEnter={() => setHovered(it.id)}
                    onMouseLeave={() => setHovered(null)}
                    title={`${it.name} · ${it.rarity}`}
                    style={{
                      position: "relative",
                      background: "var(--sc-page)",
                      border: `2px solid ${isSelected ? "var(--sc-bronze)" : RARITY_COLOR[it.rarity] || "var(--sc-rim-2)"}`,
                      borderRadius: 0, padding: 6,
                      display: "flex", flexDirection: "column", gap: 4,
                      cursor: "pointer", fontFamily: "var(--font-ui)",
                      boxShadow: isSelected
                        ? "0 0 0 1px var(--sc-bronze), inset 0 0 0 1px rgba(200,154,63,.4)"
                        : "inset 0 1px 0 rgba(255,255,255,.04)",
                    }}>
                    <div style={{
                      aspectRatio: "1 / 1", background: "var(--sc-panel-2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      position: "relative", overflow: "hidden",
                    }}>
                      {failed ? (
                        <div style={{
                          padding: 4, fontSize: 9, fontWeight: 700, color: "var(--fg-3)",
                          letterSpacing: ".06em", textTransform: "uppercase", textAlign: "center",
                        }}>{it.name}</div>
                      ) : (
                        <img src={it.img} alt={it.name}
                             onError={() => setFailedImgs(m => ({ ...m, [it.id]: true }))}
                             style={{ width: "100%", height: "100%", objectFit: "contain", padding: 4 }}/>
                      )}
                      {isSelected && (
                        <div style={{
                          position: "absolute", top: 4, right: 4,
                          width: 22, height: 22, borderRadius: 999,
                          background: "var(--sc-bronze)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          boxShadow: "0 0 0 2px var(--sc-page)",
                        }}>
                          <ICheck size={14} color="var(--sc-page)"/>
                        </div>
                      )}
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: "var(--fg-1)",
                      textAlign: "center", lineHeight: 1.2,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }} title={it.name}>{it.name}</div>
                    <div style={{
                      fontSize: 8, fontWeight: 700, letterSpacing: ".1em",
                      textTransform: "uppercase", color: RARITY_COLOR[it.rarity],
                      textAlign: "center",
                    }}>{it.rarity}</div>
                    {hovered === it.id && (
                      <div style={{
                        position: "absolute", left: "50%", bottom: "calc(100% + 6px)",
                        transform: "translateX(-50%)",
                        background: "var(--sc-page)", border: "1px solid var(--sc-bronze)",
                        padding: "4px 8px", fontSize: 10, color: "var(--sc-parchment)",
                        whiteSpace: "nowrap", zIndex: 5, pointerEvents: "none",
                      }}>
                        {it.name} <span style={{ color: "var(--fg-3)" }}>· SUI Combats Catalog</span>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 20px",
          borderTop: "1px solid var(--sc-rim)",
          background: "var(--sc-panel-2)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <button onClick={() => onClear?.()}
            style={{
              background: "transparent", border: "0", color: "var(--fg-3)",
              fontFamily: "var(--font-ui)", fontWeight: 700, fontSize: 11,
              letterSpacing: ".08em", textTransform: "uppercase", cursor: "pointer",
              padding: "6px 0",
            }}>
            Clear portrait
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="white" size="md" onClick={onClose}>Cancel</Button>
            <Button variant="yellow" size="md"
              disabled={!selected || selected.id === current?.id}
              onClick={() => onPick?.(selected)}>
              Set as Portrait
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

const PortraitEmpty = () => (
  <div style={{
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    padding: "40px 20px", textAlign: "center", gap: 12,
    color: "var(--fg-2)", minHeight: 200,
  }}>
    <div style={{
      width: 56, height: 56, border: "2px dashed var(--sc-rim-2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "var(--sc-ash)",
    }}>
      <IStore size={28} color="var(--sc-ash)"/>
    </div>
    <div style={{ fontWeight: 800, fontSize: 16, color: "var(--sc-parchment)" }}>No NFTs found</div>
    <div style={{ fontSize: 13, maxWidth: 360, lineHeight: 1.45 }}>
      Browse the marketplace or import from another wallet to set one as your portrait.
    </div>
    <a href="#" style={{
      marginTop: 4, color: "var(--sc-bronze)", fontWeight: 700, fontSize: 12,
      letterSpacing: ".08em", textTransform: "uppercase", textDecoration: "none",
      borderBottom: "1px solid var(--sc-bronze)", paddingBottom: 2,
    }}>Open Marketplace →</a>
  </div>
);

const PortraitLoading = () => (
  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
    {Array.from({ length: 10 }).map((_, i) => (
      <div key={i} style={{
        aspectRatio: "1 / 1",
        background: "linear-gradient(90deg, var(--sc-panel-2) 0%, var(--sc-panel-3) 50%, var(--sc-panel-2) 100%)",
        backgroundSize: "200% 100%",
        animation: "shimmer 1.6s linear infinite",
        border: "1px solid var(--sc-rim-2)",
      }}/>
    ))}
  </div>
);

Object.assign(window, { PortraitPicker, PortraitEmpty, PortraitLoading });
