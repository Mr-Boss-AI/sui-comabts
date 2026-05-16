"use client";

/**
 * Phase 3 Fight-Room Layout v2 (2026-05-16).
 *
 * Layout + chrome refactor. Same fight logic, WS messages, state, HP
 * thresholds, lock-in behaviour, zone-selection rules. Polish pass over
 * the v1 redesign:
 *
 *   ┌──────────┬────────┬──────────┐  TOP    HP card · timer card · HP
 *   │  Sx HP   │ TIMER  │  Foe HP  │         card. Grid 1fr auto 1fr.
 *   ├──────────┼────────┼──────────┤
 *   │          │ YOUR   │          │  MID    Doll panel · 200-px move
 *   │   doll   │ MOVE   │   doll   │         column · doll panel. Grid
 *   │ (mini-eq)│ stack  │ (mini-eq)│         1fr 200px 1fr.
 *   ├──────────┴────────┴──────────┤
 *   │         BATTLE LOG           │  BOT    Full-width log.
 *   └──────────────────────────────┘
 *
 * Fighter dolls reuse `MiniEquipmentFrame` from
 * `components/social/mini-equipment-frame.tsx` — the same read-only
 * presentational frame the Player Profile modal uses. We pass
 * `hideHpBar` so the doll keeps the portrait + 10 equipment slots but
 * doesn't duplicate the health gauge already shown in the top row.
 *
 * The local player's NFT portrait (cosmetic, localStorage-only) is
 * resolved via `readPortrait` and threaded into the doll; the opponent
 * shows the empty-portrait state.
 *
 * "YOUR MOVE" uses `ZoneSelector variant="list"` which renders chunky
 * bronze-bordered zone buttons with full HEAD/CHEST/STOMACH/BELT/LEGS
 * labels in the existing game-button chrome (`var(--r-sharp)`,
 * `var(--sh-plate-sm)`, `var(--ls-button)`). Selected ATK = blood-red
 * accent + glow; selected BLK = steel-blue accent + glow.
 *
 * Pinned by scripts/qa-fight-arena-layout.ts.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import { useGame } from "@/hooks/useGameStore";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { ZoneSelector } from "./zone-selector";
import { HpBar } from "./hp-bar";
import { DamageLog } from "./damage-log";
import { TurnTimer } from "./turn-timer";
import { OpponentDisconnectedBanner } from "./opponent-disconnected-banner";
import { FightResultModal } from "./fight-result-modal";
import { MiniEquipmentFrame } from "@/components/social/mini-equipment-frame";
import { setAcknowledgedFightId } from "@/lib/fight-outcome-ack";
import { readPortrait } from "@/lib/nft-portrait";
import { ITEM_TYPES, type Zone, type EquipmentSlots } from "@/types/game";

/** Card chrome shared by the top cards, fighter panels, and log panel. */
const CARD: React.CSSProperties = {
  background: "var(--sc-panel)",
  border: "1px solid var(--sc-rim)",
  borderRadius: "var(--r-card)",
  boxShadow: "var(--rim-top), var(--rim-bottom)",
};

/** Bronze section label — matches existing UI section headers. */
const SECTION_LABEL: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "var(--ls-button)",
  color: "var(--sc-bronze)",
  textAlign: "center",
  marginBottom: 10,
  textTransform: "uppercase",
};

/** Top-row HP card — HpBar fills the full card width. */
function HpCard({
  name,
  level,
  current,
  max,
  isLeft,
}: {
  name: string;
  level: number;
  current: number;
  max: number;
  isLeft: boolean;
}) {
  return (
    <div
      style={{
        ...CARD,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 0,
      }}
    >
      <HpBar name={name} current={current} max={max} isLeft={isLeft} level={level} />
    </div>
  );
}

/** Top-row centre card — seconds · "TURN N" · wager pill. */
function TurnCard({
  deadline,
  paused,
  pausedRemainingMs,
  turn,
  wagerAmount,
}: {
  deadline: number | null;
  paused: boolean;
  pausedRemainingMs: number | null;
  turn: number;
  wagerAmount: number | null;
}) {
  return (
    <div
      style={{
        ...CARD,
        padding: "10px 14px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        maxWidth: 160,
        minWidth: 120,
      }}
    >
      {deadline !== null ? (
        <TurnTimer deadline={deadline} paused={paused} pausedRemainingMs={pausedRemainingMs} />
      ) : (
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 38,
            color: "var(--fg-3)",
            lineHeight: 1,
          }}
        >
          —
        </div>
      )}
      <div
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: "var(--ls-button)",
          color: "var(--sc-bronze)",
          textTransform: "uppercase",
        }}
      >
        Turn {turn}
      </div>
      {wagerAmount && wagerAmount > 0 ? (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            fontWeight: 700,
            color: "var(--sc-bronze)",
          }}
        >
          {wagerAmount} SUI
        </div>
      ) : null}
    </div>
  );
}

/**
 * Middle-row fighter panel — bronze section label above the read-only
 * `MiniEquipmentFrame`. The frame handles the 10-slot doll, rarity
 * borders, and portrait area; we just wrap it in the card chrome
 * common to the top + log cards.
 *
 * Pass `hideHpBar` so HP only renders once (in the top row). When the
 * panel is for the local player, `portraitImageUrl` resolves from
 * localStorage via `readPortrait`; opponent panels render the empty
 * portrait state (their cosmetic portrait isn't on chain).
 */
function FighterPanel({
  name,
  equipment,
  currentHp,
  maxHp,
  portraitImageUrl,
  portraitName,
}: {
  name: string;
  equipment: EquipmentSlots;
  currentHp: number;
  maxHp: number;
  portraitImageUrl?: string;
  portraitName?: string;
}) {
  return (
    <div
      style={{
        ...CARD,
        padding: 14,
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
      }}
    >
      <div
        style={{
          ...SECTION_LABEL,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {name}
      </div>
      <MiniEquipmentFrame
        equipment={equipment}
        currentHp={currentHp}
        maxHp={maxHp}
        portraitImageUrl={portraitImageUrl}
        portraitName={portraitName}
        hideHpBar
      />
    </div>
  );
}

export function FightArena() {
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
  const { fight, lootResult, committedEquipment } = state;
  const myAddress = account?.address;

  const [attackZones, setAttackZones] = useState<Zone[]>([]);
  const [blockZones, setBlockZones] = useState<Zone[]>([]);
  const [submitted, setSubmitted] = useState(false);

  // Combat display uses committed (what's actually on chain). Per D4 in
  // LOADOUT_DESIGN.md, fights run against the last saved loadout — the
  // server re-reads DOFs at fight start (fight-room.ts::createFight) — so
  // we must NOT show pending here or the UI would promise stats the combat
  // math isn't using.
  const meEquip: EquipmentSlots = committedEquipment;

  const hasShield = meEquip.offhand?.itemType === ITEM_TYPES.SHIELD;
  const hasDualWield = meEquip.offhand?.itemType === ITEM_TYPES.WEAPON;
  const maxAttacks = hasDualWield ? 2 : 1;
  const maxBlocks = hasShield ? 3 : hasDualWield ? 1 : 2;

  // Local-only NFT portrait (cosmetic, no chain). Read once per render
  // from localStorage; readPortrait is pure + null-safe so SSR + missing
  // wallet both no-op.
  const myPortrait = useMemo(() => {
    if (typeof window === "undefined" || !myAddress) return null;
    return readPortrait(window.localStorage, myAddress);
  }, [myAddress]);

  useEffect(() => {
    setAttackZones([]);
    setBlockZones([]);
    setSubmitted(false);
  }, [fight?.turn]);

  const handleAttackToggle = useCallback(
    (zone: Zone) => {
      setAttackZones((prev) => {
        if (prev.includes(zone)) return prev.filter((z) => z !== zone);
        if (prev.length >= maxAttacks) return [...prev.slice(1), zone];
        return [...prev, zone];
      });
    },
    [maxAttacks],
  );

  const handleBlockPairSelect = useCallback((zones: Zone[]) => {
    setBlockZones(zones);
  }, []);

  const submitAction = useCallback(() => {
    if (attackZones.length !== maxAttacks || blockZones.length !== maxBlocks) return;
    // Diagnostic log — if the damage log shows different zones than what
    // was sent, we compare this console output (client truth) against the
    // server-side `[Fight] action` log (server truth). If both match but
    // the damage log differs, the bug is in the display; if they differ,
    // the bug is in the WS transport or client state.
    console.log("[fight_action send]", { attackZones, blockZones });
    state.socket.send({ type: "fight_action", attackZones, blockZones });
    setSubmitted(true);
  }, [attackZones, blockZones, maxAttacks, maxBlocks, state.socket]);

  if (!fight || !myAddress) return null;

  const isPlayerA = fight.playerA.walletAddress === myAddress;
  const me = isPlayerA ? fight.playerA : fight.playerB;
  const opponent = isPlayerA ? fight.playerB : fight.playerA;
  const opponentEquip = (opponent.equipment || {}) as EquipmentSlots;
  const isFinished = fight.status === "finished";
  const canSubmit = !submitted && attackZones.length === maxAttacks && blockZones.length === maxBlocks;

  return (
    <div
      data-testid="fight-arena-v3"
      style={{
        maxWidth: 1280,
        margin: "0 auto",
        width: "100%",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        flex: 1,
      }}
    >
      {/* Block C1.a (hotfix) — persistent banner while a player is in
       *   the reconnect-grace window. Renders only when
       *   state.opponentDisconnect is non-null; cannot be dismissed
       *   manually; ticks down to expiresAt. */}
      {!isFinished && <OpponentDisconnectedBanner />}

      {/* TOP ROW — HP card · timer card · HP card */}
      <div
        data-testid="fight-top-row"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        <HpCard name={me.name} level={me.level} current={me.currentHp} max={me.maxHp} isLeft />
        <TurnCard
          deadline={!isFinished && fight.turnDeadline ? fight.turnDeadline : null}
          paused={fight.turnPaused === true}
          pausedRemainingMs={fight.turnPausedRemainingMs ?? null}
          turn={fight.turn}
          wagerAmount={fight.wagerAmount ?? null}
        />
        <HpCard
          name={opponent.name}
          level={opponent.level}
          current={opponent.currentHp}
          max={opponent.maxHp}
          isLeft={false}
        />
      </div>

      {/* MIDDLE ROW — fighter doll · YOUR MOVE column · fighter doll */}
      <div
        data-testid="fight-middle-row"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 240px 1fr",
          gap: 12,
          alignItems: "stretch",
        }}
      >
        <FighterPanel
          name={me.name}
          equipment={meEquip}
          currentHp={me.currentHp}
          maxHp={me.maxHp}
          portraitImageUrl={myPortrait?.imageUrl || undefined}
          portraitName={myPortrait?.name}
        />

        {/* YOUR MOVE column */}
        <div
          style={{
            ...CARD,
            padding: 12,
            display: "flex",
            flexDirection: "column",
            minWidth: 0,
          }}
        >
          <div style={SECTION_LABEL}>Your Move</div>

          {!isFinished && (
            <ZoneSelector
              variant="list"
              selectedAttack={attackZones}
              selectedBlock={blockZones}
              maxAttacks={maxAttacks}
              maxBlocks={maxBlocks}
              onAttackToggle={handleAttackToggle}
              onBlockPairSelect={handleBlockPairSelect}
              shieldMode={hasShield}
              dualWieldMode={hasDualWield}
              disabled={submitted || isFinished}
            />
          )}

          {!isFinished && (
            <div style={{ marginTop: "auto", paddingTop: 12 }}>
              {submitted ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "12px 8px",
                    borderRadius: "var(--r-sharp)",
                    background: "rgba(94, 127, 56, 0.18)",
                    border: "2px solid var(--rarity-uncommon)",
                    color: "var(--rarity-uncommon)",
                    fontFamily: "var(--font-ui)",
                    fontWeight: 800,
                    fontSize: 12,
                    letterSpacing: "var(--ls-button)",
                    textTransform: "uppercase",
                    lineHeight: 1.2,
                    boxShadow: "var(--sh-plate-sm)",
                  }}
                >
                  Locked
                  <div
                    style={{
                      fontSize: 10,
                      opacity: 0.85,
                      marginTop: 3,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                    }}
                  >
                    Waiting…
                  </div>
                </div>
              ) : (
                <button
                  onClick={submitAction}
                  disabled={!canSubmit}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "var(--r-sharp)",
                    fontFamily: "var(--font-ui)",
                    fontWeight: 800,
                    fontSize: 12,
                    letterSpacing: "var(--ls-button)",
                    textTransform: "uppercase",
                    cursor: canSubmit ? "pointer" : "not-allowed",
                    border: `2px solid ${canSubmit ? "var(--sc-bronze)" : "var(--sc-bronze-deep)"}`,
                    background: canSubmit ? "var(--sc-bronze)" : "var(--sc-panel-2)",
                    color: canSubmit ? "var(--sc-page)" : "var(--fg-3)",
                    boxShadow: "var(--sh-plate-sm)",
                    transition:
                      "transform var(--d-fast), box-shadow var(--d-fast), background var(--d-fast)",
                  }}
                  onMouseEnter={(e) => {
                    if (!canSubmit) return;
                    e.currentTarget.style.transform = "translate(-1px, -1px)";
                    e.currentTarget.style.boxShadow = "var(--sh-plate-lg)";
                    e.currentTarget.style.background = "var(--sc-bronze-hot)";
                  }}
                  onMouseLeave={(e) => {
                    if (!canSubmit) return;
                    e.currentTarget.style.transform = "";
                    e.currentTarget.style.boxShadow = "var(--sh-plate-sm)";
                    e.currentTarget.style.background = "var(--sc-bronze)";
                  }}
                  onMouseDown={(e) => {
                    if (!canSubmit) return;
                    e.currentTarget.style.transform = "translate(1px, 1px)";
                  }}
                  onMouseUp={(e) => {
                    if (!canSubmit) return;
                    e.currentTarget.style.transform = "translate(-1px, -1px)";
                  }}
                >
                  {canSubmit ? "Lock in" : "Pick zones"}
                </button>
              )}
            </div>
          )}
        </div>

        <FighterPanel
          name={opponent.name}
          equipment={opponentEquip}
          currentHp={opponent.currentHp}
          maxHp={opponent.maxHp}
        />
      </div>

      {/* BOTTOM ROW — battle log, full width */}
      <div
        data-testid="fight-bottom-row"
        style={{ ...CARD, padding: 14, display: "flex", flexDirection: "column", minWidth: 0 }}
      >
        <div
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: "var(--ls-button)",
            color: "var(--sc-bronze)",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Battle Log
        </div>
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          <DamageLog log={fight.log || []} fight={fight} myAddress={myAddress} />
        </div>
      </div>

      {/* Fight result modal */}
      {isFinished && (
        <FightResultModal
          fight={fight}
          loot={lootResult ?? { xpGained: 0, ratingChange: 0 }}
          myAddress={myAddress}
          onClose={() => {
            // Bug 3 (2026-05-03) — record this fight as acknowledged
            // so a server-side `recent_fight_settled` replay on the
            // next session won't re-pop the modal the player just
            // dismissed.
            if (myAddress && fight.id) {
              setAcknowledgedFightId(myAddress, fight.id);
            }
            dispatch({ type: "SET_FIGHT", fight: null });
            dispatch({ type: "SET_LOOT_RESULT", loot: null });
          }}
        />
      )}
    </div>
  );
}
