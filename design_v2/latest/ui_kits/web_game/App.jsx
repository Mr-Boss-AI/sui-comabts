/* App.jsx — Router + Tweaks panel. */

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "bigSlotW": 96,
  "bigSlotH": 108,
  "ringSlotSize": 44,
  "beltSlotH": 56,
  "colGap": 8,
  "slotGap": 6,
  "framePad": 12,
  "statRowPad": 4
}/*EDITMODE-END*/;

function App() {
  const { useState } = React;
  const [connected, setConnected] = useState(false);
  const [area, setArea] = useState("character");
  const [fighting, setFighting] = useState(false);
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  function renderApp() {
    if (!connected) {
      return (
        <>
          <Navbar connected={false} onConnect={() => setConnected(true)} />
          <Landing onConnect={() => setConnected(true)} />
        </>
      );
    }
    if (fighting) {
      return (
        <>
          <Navbar connected character={PLAYER} area={area} onArea={setArea} onFight={() => setFighting(true)} />
          <FightScreen onExit={() => setFighting(false)} />
        </>
      );
    }
    return (
      <>
        <Navbar connected character={PLAYER} area={area} onArea={setArea} onFight={() => setFighting(true)} />
        <TownBanner area={area} />
        {area === "character"    && <CharacterScreen player={PLAYER} tweaks={t} />}
        {area === "arena"        && <ArenaScreen onEnterFight={() => setFighting(true)} />}
        {area === "marketplace"  && <MarketplaceScreen />}
        {area === "tavern"       && <TavernScreen />}
        {area === "hall_of_fame" && <HallOfFameScreen />}
      </>
    );
  }

  return (
    <div className="app">
      {renderApp()}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Equipment slots" />
        <TweakSlider label="Big slot W"     value={t.bigSlotW}     min={72} max={140} step={2} unit="px"
                     onChange={v => setTweak('bigSlotW', v)} />
        <TweakSlider label="Big slot H"     value={t.bigSlotH}     min={80} max={160} step={2} unit="px"
                     onChange={v => setTweak('bigSlotH', v)} />
        <TweakSlider label="Ring slot"      value={t.ringSlotSize} min={32} max={64}  step={2} unit="px"
                     onChange={v => setTweak('ringSlotSize', v)} />
        <TweakSlider label="Belt / Boots H" value={t.beltSlotH}    min={40} max={88}  step={2} unit="px"
                     onChange={v => setTweak('beltSlotH', v)} />
        <TweakSection label="Frame spacing" />
        <TweakSlider label="Column gap"     value={t.colGap}       min={0}  max={20}  step={1} unit="px"
                     onChange={v => setTweak('colGap', v)} />
        <TweakSlider label="Slot gap"       value={t.slotGap}      min={2}  max={14}  step={1} unit="px"
                     onChange={v => setTweak('slotGap', v)} />
        <TweakSlider label="Frame padding"  value={t.framePad}     min={4}  max={24}  step={2} unit="px"
                     onChange={v => setTweak('framePad', v)} />
        <TweakSection label="Stats panel" />
        <TweakSlider label="Row padding"    value={t.statRowPad}   min={2}  max={12}  step={1} unit="px"
                     onChange={v => setTweak('statRowPad', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
