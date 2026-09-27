"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- Move object JSON from RPC is untyped */

/**
 * v5.3 — Guild Hall. Found / join / run a guild and wage guild wars.
 * All actions are wallet-signed PTBs against guild.move / guild_war.move;
 * state is read straight from chain (lib/guild-contracts.ts).
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { CurrentAccountSigner } from "@mysten/dapp-kit-core";
import type { Transaction } from "@mysten/sui/transactions";
import { useGame } from "@/hooks/useGameStore";
import { WarBattle } from "./war-battle";
import { ScreenLayout, TopBanner, SectionHeader } from "@/components/v2/layout";
import { BronzeButton, DangerButton, SecondaryButton, V2Input } from "@/components/v2";
import {
  GUILD_REGISTRY_ID, MAX_MEMBERS, ROLE_LEADER, ROLE_NAMES, ROLE_OFFICER, WAR_STATUS, LEVEL_RULES, START_DELAYS_MIN,
  GUILD_ABORTS, WAR_ABORTS,
  listGuilds, getGuild, myGuildId, listWarsFor,
  buildCreateGuildTx, buildJoinGuildTx, buildLeaveGuildTx, buildKickTx, buildInviteTx, buildRevokeInviteTx,
  buildPromoteTx, buildDemoteTx, buildTransferLeadershipTx, buildSetOpenTx, buildSetProfileTx, buildDonateTx,
  buildWithdrawTx, buildDisbandTx, buildDeclareWarTx, buildAcceptWarTx, buildJoinWarTx, buildLeaveWarTx,
  buildExpireWarTx, buildReclaimWarTx,
  type GuildDetail, type GuildSummary, type GuildWarInfo,
} from "@/lib/guild-contracts";

const MIST = 1_000_000_000;
const sui = (mist: bigint | number) => (Number(mist) / MIST).toFixed(Number(mist) % MIST === 0 ? 0 : 2);
const toMist = (v: string) => BigInt(Math.round((Number(v) || 0) * MIST));
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function humanize(err: string): string {
  const m = err.match(/abort code:\s*(\d+),\s*in '0x[0-9a-f]+::(\w+)::/) ?? err.match(/Identifier\("(\w+)"\)[\s\S]*?\},\s*(\d+)\)/);
  if (m) {
    const [code, mod] = m[1].match(/^\d+$/) ? [Number(m[1]), m[2]] : [Number(m[2]), m[1]];
    const text = mod === "guild" ? GUILD_ABORTS[code] : mod === "guild_war" ? WAR_ABORTS[code] : mod === "version" ? "Please refresh — the game was updated." : undefined;
    if (text) return text;
  }
  if (/rejected|denied|cancel/i.test(err)) return "Transaction cancelled.";
  return err.length > 160 ? err.slice(0, 160) + "…" : err;
}

const panel: CSSProperties = {
  background: "var(--sc-panel)", border: "1px solid var(--sc-rim)", borderRadius: "var(--r-card)",
  boxShadow: "var(--sh-plate-lg), var(--rim-top), var(--rim-bottom)", padding: 20,
};
const muted: CSSProperties = { color: "var(--fg-3)", fontSize: 13 };
const row: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };

function Panel({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return <div style={panel}><SectionHeader title={title} right={right} size="sm" />{children}</div>;
}

export function GuildHall() {
  const { state, dispatch } = useGame();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const me = account?.address ?? "";
  const characterId = state.character?.onChainObjectId ?? state.onChainCharacter?.objectId ?? "";
  const myLevel = state.character?.level ?? 1;

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [guilds, setGuilds] = useState<GuildSummary[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [guild, setGuild] = useState<GuildDetail | null>(null);
  const [wars, setWars] = useState<GuildWarInfo[]>([]);
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!GUILD_REGISTRY_ID || !me) { setLoading(false); return; }
    try {
      const [list, mine] = await Promise.all([listGuilds(), myGuildId(me)]);
      setGuilds(list);
      setMyId(mine);
      if (mine) {
        const [g, w] = await Promise.all([getGuild(mine), listWarsFor(mine)]);
        setGuild(g);
        setWars(w);
      } else { setGuild(null); setWars([]); }
    } catch (e: any) {
      setToast({ ok: false, text: `Could not read guilds: ${e?.message ?? e}` });
    } finally { setLoading(false); }
  }, [me]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  useEffect(() => { const i = setInterval(refresh, 15000); return () => clearInterval(i); }, [refresh]);

  const sign = useCallback(async (label: string, tx: Transaction) => {
    setBusy(true); setToast(null);
    try {
      const signer = new CurrentAccountSigner(dAppKit as any);
      const r: any = await signer.signAndExecuteTransaction({ transaction: tx });
      const st = r?.effects?.status;
      if (st && st.status !== "success") throw new Error(st.error || "aborted");
      setToast({ ok: true, text: `${label} ✔` });
      await new Promise((res) => setTimeout(res, 1200));
      await refresh();
    } catch (e: any) {
      setToast({ ok: false, text: humanize(e?.message ?? String(e)) });
    } finally { setBusy(false); }
  }, [dAppKit, refresh]);

  const myRole = useMemo(() => guild?.members.find((m) => m.address === me)?.role ?? -1, [guild, me]);

  // v5.3 — live guild-war battle (server pushes war_state).
  const war = state.warState;
  const [hiddenWarId, setHiddenWarId] = useState<string | null>(null);
  const watchWar = useCallback((warId: string) => {
    setHiddenWarId(null);
    state.socket.send({ type: "war_watch", warId });
  }, [state.socket]);
  const leaveWar = useCallback(() => {
    if (!war) return;
    if (war.result || !war.mySide) {
      state.socket.send({ type: "war_unwatch", warId: war.warId });
      dispatch({ type: "SET_WAR_STATE", war: null });
      refresh();
    } else setHiddenWarId(war.warId);
  }, [war, state.socket, dispatch, refresh]);
  const warInfo = war ? wars.find((w) => w.id === war.warId) : undefined;
  const guildName = (id?: string) => (id ? guilds.find((g) => g.id === id)?.name : undefined);

  if (!GUILD_REGISTRY_ID) {
    return (
      <ScreenLayout>
        <TopBanner title="Guild Hall" subtitle="Guilds arrive with the v5.3 contracts." pill="testnet" tone="bronze" />
        <div style={panel}><p style={muted}>Set NEXT_PUBLIC_GUILD_REGISTRY_ID and NEXT_PUBLIC_WAR_REGISTRY_ID after running scripts/deploy-v5.3.ts.</p></div>
      </ScreenLayout>
    );
  }

  if (war && war.warId !== hiddenWarId) {
    const mineIsA = warInfo ? warInfo.guildA === guild?.id : true;
    return (
      <ScreenLayout>
        <WarBattle
          guildName={guildName(warInfo ? (mineIsA ? warInfo.guildA : warInfo.guildB) : undefined)}
          enemyName={guildName(warInfo ? (mineIsA ? warInfo.guildB : warInfo.guildA) : undefined)}
          onLeave={leaveWar}
        />
      </ScreenLayout>
    );
  }

  return (
    <ScreenLayout>
      <TopBanner title="Guild Hall" subtitle={guild ? `${guild.name} · ${guild.memberCount}/${MAX_MEMBERS} members · rating ${guild.rating}` : "Found a guild or swear yourself to one."} pill="testnet" tone="bronze" />
      {toast && (
        <div style={{ ...panel, padding: 12, borderColor: toast.ok ? "var(--sc-bronze)" : "var(--sc-blood)", color: toast.ok ? "var(--sc-parchment)" : "var(--sc-blood)" }}>{toast.text}</div>
      )}
      {war && war.mySide && !war.result && (
        <div style={{ ...panel, padding: 12, borderColor: "var(--sc-blood)", ...row, justifyContent: "space-between" }}>
          <strong>⚔ Your guild war is raging!</strong>
          <BronzeButton size="sm" onClick={() => setHiddenWarId(null)}>Return to battle</BronzeButton>
        </div>
      )}
      {loading ? <div style={panel}><p style={muted}>Reading the guild rolls…</p></div>
        : !characterId ? <div style={panel}><p style={muted}>Create your character first.</p></div>
        : guild ? (
          <MyGuild guild={guild} me={me} myRole={myRole} myLevel={myLevel} characterId={characterId} guilds={guilds} wars={wars} now={now} busy={busy} sign={sign} onWatch={watchWar} />
        ) : (
          <NoGuild guilds={guilds} characterId={characterId} busy={busy} sign={sign} />
        )}
      {myId && !guild && !loading && <p style={muted}>Guild {short(myId)} could not be loaded.</p>}
    </ScreenLayout>
  );
}

type Sign = (label: string, tx: Transaction) => Promise<void>;

// ───────────────────────────── not in a guild ─────────────────────────────

function NoGuild({ guilds, characterId, busy, sign }: { guilds: GuildSummary[]; characterId: string; busy: boolean; sign: Sign }) {
  const [name, setName] = useState("");
  const [open, setOpen] = useState(true);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 20 }}>
      <Panel title="Found a guild">
        <p style={muted}>Costs 1 SUI. Names are unique (3–24 letters, digits, spaces, _ or -).</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          <V2Input placeholder="Guild name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} aria-label="Guild name" />
          <label style={{ ...row, ...muted }}><input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} /> Anyone may join (otherwise invite only)</label>
          <BronzeButton disabled={busy || name.trim().length < 3} onClick={() => sign("Guild founded", buildCreateGuildTx(characterId, name.trim(), open))}>Found for 1 SUI</BronzeButton>
        </div>
      </Panel>
      <Panel title="Guilds of the realm" right={<span style={muted}>{guilds.length}</span>}>
        {guilds.length === 0 ? <p style={muted}>No guilds yet — be the first.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {guilds.map((g) => (
              <div key={g.id} style={{ ...row, justifyContent: "space-between", borderBottom: "1px solid var(--sc-rim)", paddingBottom: 8 }}>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>{g.name}</div>
                  <div style={muted}>{g.memberCount}/{MAX_MEMBERS} · rating {g.rating} · {g.wins}W {g.losses}L {g.draws}D · {g.open ? "open" : "invite only"}</div>
                </div>
                <SecondaryButton size="sm" disabled={busy || g.memberCount >= MAX_MEMBERS} onClick={() => sign(`Joined ${g.name}`, buildJoinGuildTx(g.id, characterId))}>
                  {g.open ? "Join" : "Join (invite)"}
                </SecondaryButton>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ───────────────────────────── in a guild ─────────────────────────────

function MyGuild(props: {
  guild: GuildDetail; me: string; myRole: number; myLevel: number; characterId: string; guilds: GuildSummary[];
  wars: GuildWarInfo[]; now: number; busy: boolean; sign: Sign; onWatch: (warId: string) => void;
}) {
  const { guild, me, myRole, busy, sign } = props;
  const isLeader = myRole === ROLE_LEADER;
  const isOfficer = myRole >= ROLE_OFFICER;
  const [invitee, setInvitee] = useState("");
  const [donate, setDonate] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [desc, setDesc] = useState(guild.description);
  const [emblem, setEmblem] = useState(guild.emblemUrl);
  const warLocked = guild.warLockedUntil > props.now;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 20, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Panel title={guild.name} right={<span style={muted}>{guild.wins}W {guild.losses}L {guild.draws}D · rating {guild.rating}</span>}>
          <div style={{ ...row, alignItems: "flex-start", gap: 16 }}>
            {guild.emblemUrl && <img src={guild.emblemUrl} alt="" style={{ width: 72, height: 72, objectFit: "contain" }} />}
            <div style={{ flex: 1 }}>
              <p style={{ margin: 0 }}>{guild.description || <span style={muted}>No description yet.</span>}</p>
              <p style={muted}>{guild.open ? "Open to all" : "Invite only"} · {warLocked ? "⚔ at war — membership locked" : "at peace"}</p>
            </div>
          </div>
        </Panel>

        <Panel title="Members" right={<span style={muted}>{guild.memberCount}/{MAX_MEMBERS}</span>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {guild.members.map((m) => (
              <div key={m.address} style={{ ...row, justifyContent: "space-between", borderBottom: "1px solid var(--sc-rim)", paddingBottom: 6 }}>
                <span>{m.address === me ? "You" : short(m.address)} <span style={muted}>· {ROLE_NAMES[m.role]}</span></span>
                <span style={row}>
                  {isLeader && m.role === 0 && <SecondaryButton size="sm" disabled={busy} onClick={() => sign("Promoted", buildPromoteTx(guild.id, m.address))}>Promote</SecondaryButton>}
                  {isLeader && m.role === ROLE_OFFICER && <SecondaryButton size="sm" disabled={busy} onClick={() => sign("Demoted", buildDemoteTx(guild.id, m.address))}>Demote</SecondaryButton>}
                  {isLeader && m.address !== me && <SecondaryButton size="sm" disabled={busy} onClick={() => sign("Leadership passed", buildTransferLeadershipTx(guild.id, m.address))}>Make leader</SecondaryButton>}
                  {myRole > m.role && m.address !== me && <DangerButton size="sm" disabled={busy || warLocked} onClick={() => sign("Kicked", buildKickTx(guild.id, m.address))}>Kick</DangerButton>}
                </span>
              </div>
            ))}
          </div>
          {isOfficer && (
            <div style={{ ...row, marginTop: 12 }}>
              <V2Input placeholder="Wallet address to invite (0x…)" value={invitee} onChange={(e) => setInvitee(e.target.value.trim())} style={{ flex: 1 }} aria-label="Invite address" />
              <BronzeButton size="sm" disabled={busy || !/^0x[0-9a-fA-F]{64}$/.test(invitee)} onClick={() => sign("Invite sent", buildInviteTx(guild.id, invitee))}>Invite</BronzeButton>
            </div>
          )}
          {isOfficer && guild.invites.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={muted}>Pending invites</div>
              {guild.invites.map((a) => (
                <div key={a} style={{ ...row, justifyContent: "space-between" }}>
                  <span>{short(a)}</span>
                  <SecondaryButton size="sm" disabled={busy} onClick={() => sign("Invite revoked", buildRevokeInviteTx(guild.id, a))}>Revoke</SecondaryButton>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <WarsPanel {...props} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Panel title="Treasury" right={<span style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>{sui(guild.treasuryMist)} SUI</span>}>
          <div style={{ ...row, marginTop: 6 }}>
            <V2Input placeholder="SUI" inputMode="decimal" value={donate} onChange={(e) => setDonate(e.target.value)} style={{ width: 100 }} aria-label="Donate amount" />
            <BronzeButton size="sm" disabled={busy || !(Number(donate) > 0)} onClick={() => sign("Donated", buildDonateTx(guild.id, toMist(donate)))}>Donate</BronzeButton>
          </div>
          {isLeader && (
            <div style={{ ...row, marginTop: 8 }}>
              <V2Input placeholder="SUI" inputMode="decimal" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} style={{ width: 100 }} aria-label="Withdraw amount" />
              <SecondaryButton size="sm" disabled={busy || warLocked || !(Number(withdraw) > 0)} onClick={() => sign("Withdrawn", buildWithdrawTx(guild.id, toMist(withdraw)))}>Withdraw</SecondaryButton>
            </div>
          )}
        </Panel>

        {isLeader && (
          <Panel title="Settings">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <SecondaryButton size="sm" disabled={busy} onClick={() => sign(guild.open ? "Now invite only" : "Now open", buildSetOpenTx(guild.id, !guild.open))}>
                {guild.open ? "Make invite only" : "Open to everyone"}
              </SecondaryButton>
              <V2Input placeholder="Description (280 max)" maxLength={280} value={desc} onChange={(e) => setDesc(e.target.value)} aria-label="Description" />
              <V2Input placeholder="Emblem image URL" maxLength={256} value={emblem} onChange={(e) => setEmblem(e.target.value)} aria-label="Emblem URL" />
              <BronzeButton size="sm" disabled={busy} onClick={() => sign("Profile saved", buildSetProfileTx(guild.id, desc, emblem))}>Save profile</BronzeButton>
            </div>
          </Panel>
        )}

        <Panel title="Leave">
          {isLeader ? (
            <>
              <p style={muted}>The leader can only disband once everyone else has left. Treasury is paid to you.</p>
              <DangerButton size="sm" disabled={busy || guild.memberCount > 1 || !!guild.openWarId} onClick={() => sign("Guild disbanded", buildDisbandTx(guild.id))}>Disband guild</DangerButton>
            </>
          ) : (
            <DangerButton size="sm" disabled={busy || warLocked} onClick={() => sign("You left the guild", buildLeaveGuildTx(guild.id))}>Leave guild</DangerButton>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ───────────────────────────── wars ─────────────────────────────

function WarsPanel({ guild, me, myRole, myLevel, characterId, guilds, wars, now, busy, sign, onWatch }: {
  guild: GuildDetail; me: string; myRole: number; myLevel: number; characterId: string; guilds: GuildSummary[];
  wars: GuildWarInfo[]; now: number; busy: boolean; sign: Sign; onWatch: (warId: string) => void;
}) {
  const isOfficer = myRole >= ROLE_OFFICER;
  const enemies = guilds.filter((g) => g.id !== guild.id);
  const [enemy, setEnemy] = useState("");
  const [team, setTeam] = useState(3);
  const [stake, setStake] = useState("0.5");
  const [rule, setRule] = useState(0);
  const [delay, setDelay] = useState(10);
  const nameOf = (id: string) => guilds.find((g) => g.id === id)?.name ?? short(id);

  return (
    <Panel title="Guild wars">
      {isOfficer && !guild.openWarId && enemies.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 14 }}>
          <select value={enemy} onChange={(e) => setEnemy(e.target.value)} aria-label="Enemy guild" style={selectStyle}>
            <option value="">Choose enemy guild…</option>
            {enemies.map((g) => <option key={g.id} value={g.id}>{g.name} (rating {g.rating})</option>)}
          </select>
          <select value={team} onChange={(e) => setTeam(Number(e.target.value))} aria-label="Team size" style={selectStyle}>
            {Array.from({ length: 9 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n} vs {n}</option>)}
          </select>
          <V2Input placeholder="Stake SUI per fighter (0 = honour)" inputMode="decimal" value={stake} onChange={(e) => setStake(e.target.value)} aria-label="Stake" />
          <select value={rule} onChange={(e) => setRule(Number(e.target.value))} aria-label="Level rule" style={selectStyle}>
            {LEVEL_RULES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select value={delay} onChange={(e) => setDelay(Number(e.target.value))} aria-label="Start delay" style={selectStyle}>
            {START_DELAYS_MIN.map((d) => <option key={d} value={d}>Starts in {d} min</option>)}
          </select>
          <BronzeButton disabled={busy || !enemy} onClick={() => sign("War declared", buildDeclareWarTx({
            myGuildId: guild.id, enemyGuildId: enemy, characterId, teamSize: team, stakeMist: toMist(stake), levelRule: rule, delayMin: delay,
          }))}>Declare war</BronzeButton>
        </div>
      )}
      {wars.length === 0 ? <p style={muted}>No wars yet.</p> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {wars.map((w) => {
            const mySideA = w.guildA === guild.id;
            const enemyId = mySideA ? w.guildB : w.guildA;
            const mine = mySideA ? w.sideA : w.sideB;
            const theirs = mySideA ? w.sideB : w.sideA;
            const signedUp = w.sideA.includes(me) || w.sideB.includes(me);
            const secs = Math.max(0, Math.round((w.startAt - now) / 1000));
            const open = (w.status === 0 || w.status === 1) && secs > 0;
            const inRange = myLevel >= w.levelMin && myLevel <= w.levelMax;
            const canExpire = (w.status === 0 && now >= w.startAt) || (w.status === 1 && now >= w.startAt + 600_000);
            const canReclaim = w.status === 2 && signedUp && now >= w.startedAt + 3_600_000;
            const result = w.status === 3 ? (w.winner === 3 ? "Draw" : (w.winner === 1) === mySideA ? "Victory" : "Defeat") : WAR_STATUS[w.status];
            return (
              <div key={w.id} style={{ borderBottom: "1px solid var(--sc-rim)", paddingBottom: 10 }}>
                <div style={{ ...row, justifyContent: "space-between" }}>
                  <strong>vs {nameOf(enemyId)}</strong>
                  <span style={muted}>{result}{open ? ` · starts in ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : ""}</span>
                </div>
                <div style={muted}>
                  {w.teamSize} vs {w.teamSize} · stake {sui(w.stakeMist)} SUI · levels {w.levelMin}–{w.levelMax} · signed up {mine.length} vs {theirs.length}
                </div>
                <div style={{ ...row, marginTop: 6 }}>
                  {w.status === 0 && !mySideA && isOfficer && <BronzeButton size="sm" disabled={busy} onClick={() => sign("War accepted", buildAcceptWarTx(w.id, guild.id))}>Accept war</BronzeButton>}
                  {open && !signedUp && <BronzeButton size="sm" disabled={busy || !inRange || mine.length >= w.teamSize} onClick={() => sign("Signed up", buildJoinWarTx(w.id, guild.id, characterId, w.stakeMist))}>Sign up ({sui(w.stakeMist)} SUI)</BronzeButton>}
                  {open && signedUp && <SecondaryButton size="sm" disabled={busy} onClick={() => sign("Left the war", buildLeaveWarTx(w.id))}>Leave (refund)</SecondaryButton>}
                  {canExpire && <SecondaryButton size="sm" disabled={busy} onClick={() => sign("War expired — refunded", buildExpireWarTx(w))}>Expire &amp; refund</SecondaryButton>}
                  {canReclaim && <DangerButton size="sm" disabled={busy} onClick={() => sign("Stakes reclaimed", buildReclaimWarTx(w))}>Reclaim stakes</DangerButton>}
                  {w.status === 1 && secs === 0 && <span style={muted}>Waiting for the arena master to open the battle…</span>}
                  {w.status === 2 && <BronzeButton size="sm" onClick={() => onWatch(w.id)}>{signedUp ? "⚔ Enter battle" : "⚔ Watch battle"}</BronzeButton>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

const selectStyle: CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: 13, padding: "9px 10px", border: "1px solid var(--sc-rim-2)",
  borderRadius: "var(--r-sm)", background: "var(--sc-page)", color: "var(--sc-parchment)",
};
