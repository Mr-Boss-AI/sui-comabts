"use client";

/**
 * v5.3 — Guild-war battle screen (combats.ru-style group fight).
 *
 * The server pairs every living fighter with one enemy at a time. Each
 * exchange: pick strike + guard zones before the timer runs out (offline /
 * slow fighters act at random). When an exchange resolves you are re-paired
 * with the least-engaged free enemy. Last side standing wins; at the time
 * cap the side with more total HP% wins.
 *
 * State arrives as `war_state` pushes (hooks/useGameStore.warState).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useGame } from "@/hooks/useGameStore";
import { ZoneSelector } from "@/components/fight/zone-selector";
import { HpBar } from "@/components/fight/hp-bar";
import { BronzeButton, SecondaryButton } from "@/components/v2";
import { ITEM_TYPES, type Zone } from "@/types/game";
import type { WarFighterWire } from "@/types/ws-messages";

const card: CSSProperties = {
  background: "var(--sc-panel)", border: "1px solid var(--sc-rim)", borderRadius: "var(--r-card)",
  boxShadow: "var(--rim-top), var(--rim-bottom)", padding: 14, minWidth: 0,
};
const label: CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 800, letterSpacing: "var(--ls-button)",
  color: "var(--sc-bronze)", textTransform: "uppercase", marginBottom: 8,
};
const muted: CSSProperties = { color: "var(--fg-3)", fontSize: 13 };

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function Roster({ title, fighters, me, foe }: { title: string; fighters: WarFighterWire[]; me: string; foe: string | null }) {
  const byWallet = useMemo(() => new Map(fighters.map((f) => [f.wallet, f.name])), [fighters]);
  return (
    <div style={card}>
      <div style={label}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fighters.map((f) => {
          const dead = f.hp <= 0;
          const pct = f.maxHp ? Math.round((f.hp / f.maxHp) * 100) : 0;
          const hl = f.wallet === me ? "var(--sc-bronze)" : f.wallet === foe ? "var(--sc-blood)" : "transparent";
          return (
            <div key={f.wallet} style={{ borderLeft: `3px solid ${hl}`, paddingLeft: 8, opacity: dead ? 0.45 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name} [{f.level}]{f.wallet === me ? " (you)" : ""}
                </strong>
                <span style={{ color: dead ? "var(--fg-3)" : "var(--sc-parchment)", whiteSpace: "nowrap" }}>
                  {dead ? "☠ fallen" : `${f.hp}/${f.maxHp}`}
                </span>
              </div>
              <div style={{ height: 6, background: "var(--sc-page)", border: "1px solid var(--sc-rim)", marginTop: 3 }}>
                <div style={{ width: `${pct}%`, height: "100%", background: "var(--sc-blood)", transition: "width 400ms" }} />
              </div>
              {!dead && (
                <div style={{ ...muted, fontSize: 11, marginTop: 2 }}>
                  {f.fighting ? `⚔ vs ${byWallet.get(f.fighting) ?? "…"}` : "waiting for a free enemy"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WarBattle({ guildName, enemyName, onLeave }: { guildName?: string; enemyName?: string; onLeave: () => void }) {
  const { state } = useGame();
  const war = state.warState;
  const me = (state.character?.walletAddress ?? "").toLowerCase();
  const equip = state.committedEquipment;
  const hasShield = equip?.offhand?.itemType === ITEM_TYPES.SHIELD;
  const hasDualWield = equip?.offhand?.itemType === ITEM_TYPES.WEAPON;
  const maxAttacks = hasDualWield ? 2 : 1;
  const maxBlocks = hasShield ? 3 : 2;

  // Picks + errors are keyed by exchange id, so a new exchange starts clean.
  const exId = war?.exchange?.id ?? null;
  const [picks, setPicks] = useState<{ ex: number | null; atk: Zone[]; blk: Zone[] }>({ ex: null, atk: [], blk: [] });
  const [err, setErr] = useState<{ ex: number | null; text: string } | null>(null);
  const attackZones = picks.ex === exId ? picks.atk : [];
  const blockZones = picks.ex === exId ? picks.blk : [];
  const error = err && err.ex === exId ? err.text : null;
  const setAttackZones = useCallback((fn: (prev: Zone[]) => Zone[]) => {
    setPicks((p) => ({ ex: exId, atk: fn(p.ex === exId ? p.atk : []), blk: p.ex === exId ? p.blk : [] }));
  }, [exId]);
  const setBlockZones = useCallback((zones: Zone[]) => {
    setPicks((p) => ({ ex: exId, atk: p.ex === exId ? p.atk : [], blk: zones }));
  }, [exId]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(i); }, []);
  useEffect(() => {
    const onMsg = (msg: { type: string; error?: string }) => {
      if (msg.type === "war_error" && msg.error) setErr({ ex: exId, text: msg.error });
    };
    return state.socket.addHandler(onMsg as never);
  }, [state.socket, exId]);

  const toggleAttack = useCallback((zone: Zone) => {
    setAttackZones((prev) => {
      const count = prev.filter((z) => z === zone).length;
      if (count === 1 && maxAttacks > 1 && prev.length < maxAttacks) return [...prev, zone];
      if (count > 0) return prev.filter((z) => z !== zone);
      if (prev.length >= maxAttacks) return [...prev.slice(1), zone];
      return [...prev, zone];
    });
  }, [maxAttacks, setAttackZones]);

  const strike = useCallback(() => {
    if (!war || attackZones.length !== maxAttacks || blockZones.length !== maxBlocks) return;
    setErr(null);
    state.socket.send({ type: "war_action", warId: war.warId, attackZones, blockZones });
  }, [war, attackZones, blockZones, maxAttacks, maxBlocks, state.socket]);

  if (!war) return null;
  // Server clock offset (stamped on receipt) so countdowns ignore local clock skew.
  const serverNow = now + (war.receivedAt ? war.now - war.receivedAt : 0);
  const mySide = war.mySide;
  const left = war.fighters.filter((f) => f.side === (mySide ?? "A"));
  const right = war.fighters.filter((f) => f.side !== (mySide ?? "A"));
  const self = war.fighters.find((f) => f.wallet === me);
  const foe = war.exchange ? war.fighters.find((f) => f.wallet === war.exchange!.opponent) : undefined;
  const leftName = mySide ? (guildName ?? "Your guild") : "Side A";
  const rightName = mySide ? (enemyName ?? "The enemy") : "Side B";

  let banner: string | null = null;
  if (war.result) {
    if (war.result === "draw") banner = "The war ends in a draw — stakes returned";
    else if (!mySide) banner = `Side ${war.result} is victorious`;
    else banner = war.result === mySide ? "Victory! Your guild holds the field" : "Defeat. Your guild has fallen";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 1100, margin: "0 auto", padding: "0 16px 24px" }}>
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={label}>Guild war</div>
          <strong style={{ fontSize: 18 }}>{leftName} ⚔ {rightName}</strong>
        </div>
        <div style={{ textAlign: "right" }}>
          {war.result ? (
            <span style={muted}>{war.settled ? "Settled on chain ✔" : "Paying out on chain…"}</span>
          ) : (
            <span style={muted}>Judges call time in <strong style={{ color: "var(--sc-parchment)" }}>{clock(war.endsBy - serverNow)}</strong></span>
          )}
          <div style={{ marginTop: 6 }}><SecondaryButton size="sm" onClick={onLeave}>{war.result ? "Close" : "Leave view"}</SecondaryButton></div>
        </div>
      </div>

      {banner && (
        <div style={{ ...card, textAlign: "center", fontSize: 20, fontFamily: "var(--font-display, var(--font-ui))", color: war.result === mySide ? "var(--sc-bronze)" : "var(--sc-parchment)" }}>
          {banner}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <Roster title={leftName} fighters={left} me={me} foe={foe?.wallet ?? null} />

        <div style={card}>
          <div style={label}>Your move</div>
          {!mySide && <p style={muted}>You are watching this battle.</p>}
          {mySide && self && self.hp <= 0 && !war.result && <p style={muted}>You have fallen. Your guild fights on…</p>}
          {mySide && self && self.hp > 0 && !war.result && !war.exchange && <p style={muted}>Waiting for a free enemy…</p>}
          {war.exchange && foe && self && !war.result && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <HpBar name={foe.name} level={foe.level} current={foe.hp} max={foe.maxHp} isLeft />
              <div style={{ ...muted, textAlign: "center" }}>
                Exchange ends in <strong style={{ color: "var(--sc-parchment)" }}>{clock(war.exchange.deadline - serverNow)}</strong>
              </div>
              {war.exchange.chosen ? (
                <p style={{ ...muted, textAlign: "center" }}>Move locked in — waiting for {foe.name}…</p>
              ) : (
                <>
                  <ZoneSelector
                    variant="list"
                    selectedAttack={attackZones}
                    selectedBlock={blockZones}
                    maxAttacks={maxAttacks}
                    maxBlocks={maxBlocks}
                    onAttackToggle={toggleAttack}
                    onBlockPairSelect={setBlockZones}
                    shieldMode={hasShield}
                    dualWieldMode={hasDualWield}
                  />
                  <BronzeButton disabled={attackZones.length !== maxAttacks || blockZones.length !== maxBlocks} onClick={strike}>
                    Strike
                  </BronzeButton>
                </>
              )}
              {error && <p style={{ color: "var(--sc-blood)", fontSize: 13 }}>{error}</p>}
            </div>
          )}
        </div>

        <Roster title={rightName} fighters={right} me={me} foe={foe?.wallet ?? null} />
      </div>

      <div style={card}>
        <div style={label}>Battle log</div>
        <div style={{ display: "flex", flexDirection: "column-reverse", gap: 4, maxHeight: 260, overflowY: "auto", fontSize: 13 }}>
          {war.log.map((l, i) => (
            <div key={`${l.at}-${i}`}>
              <span style={{ color: "var(--fg-3)" }}>{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>{" "}
              {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
