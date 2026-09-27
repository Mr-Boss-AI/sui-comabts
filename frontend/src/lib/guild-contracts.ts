/* eslint-disable @typescript-eslint/no-explicit-any -- Move object JSON from RPC is untyped */
/**
 * v5.3 — Guilds + guild wars: transaction builders and chain readers.
 *
 * Everything here talks to the chain directly (wallet-signed PTBs + JSON-RPC
 * reads) — the server is only needed to run the war battle itself.
 */
import { Transaction } from "@mysten/sui/transactions";
import { PACKAGE_ID, SUI_CLOCK, getJsonRpcClient } from "@/lib/sui-contracts";

// Literal env access so Next.js inlines them.
export const GUILD_REGISTRY_ID = process.env.NEXT_PUBLIC_GUILD_REGISTRY_ID ?? "";
export const WAR_REGISTRY_ID = process.env.NEXT_PUBLIC_WAR_REGISTRY_ID ?? "";

export const GUILD_CREATION_FEE_MIST = BigInt(1_000_000_000);
export const MAX_MEMBERS = 30;
export const ROLE_MEMBER = 0;
export const ROLE_OFFICER = 1;
export const ROLE_LEADER = 2;
export const ROLE_NAMES = ["Member", "Officer", "Leader"] as const;

export const WAR_STATUS = ["Declared", "Accepted", "Active", "Settled", "Cancelled"] as const;
export const LEVEL_RULES = [
  { id: 0, label: "Any level" },
  { id: 1, label: "Same level" },
  { id: 2, label: "±1 level" },
] as const;
export const START_DELAYS_MIN = [5, 10, 15, 30] as const;

const t = (m: string, f: string) => `${PACKAGE_ID}::${m}::${f}`;

// ─────────────────────────── types ───────────────────────────

export interface GuildSummary {
  id: string;
  name: string;
  leader: string;
  memberCount: number;
  open: boolean;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface GuildMember {
  address: string;
  role: number;
}

export interface GuildDetail extends GuildSummary {
  description: string;
  emblemUrl: string;
  members: GuildMember[];
  invites: string[];
  treasuryMist: bigint;
  warLockedUntil: number;
  openWarId: string | null;
}

export interface GuildWarInfo {
  id: string;
  guildA: string;
  guildB: string;
  teamSize: number;
  stakeMist: bigint;
  levelMin: number;
  levelMax: number;
  status: number;
  startAt: number;
  startedAt: number;
  sideA: string[];
  sideB: string[];
  winner: number;
}

// ─────────────────────────── readers ───────────────────────────

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  if (v && typeof v === "object" && "value" in (v as any)) return Number((v as any).value);
  return 0;
}
function big(v: unknown): bigint {
  if (typeof v === "string" || typeof v === "number") return BigInt(v);
  if (v && typeof v === "object" && "value" in (v as any)) return BigInt((v as any).value);
  return BigInt(0);
}
function optId(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && (v as any).vec) return (v as any).vec[0] ?? null;
  return null;
}

async function fieldsOf(id: string): Promise<any | null> {
  const o = await getJsonRpcClient().getObject({ id, options: { showContent: true } });
  return (o.data?.content as any)?.fields ?? null;
}

function summaryFrom(id: string, f: any): GuildSummary {
  return {
    id,
    name: f.name,
    leader: f.leader,
    memberCount: num(f.member_count),
    open: !!f.open,
    rating: num(f.rating),
    wins: num(f.wins),
    losses: num(f.losses),
    draws: num(f.draws),
  };
}

/** All live guilds (created minus disbanded), strongest first. */
export async function listGuilds(): Promise<GuildSummary[]> {
  const client = getJsonRpcClient();
  const ids = new Set<string>();
  let cursor: any = null;
  for (let page = 0; page < 10; page++) {
    const r = await client.queryEvents({ query: { MoveEventType: t("guild", "GuildCreated") }, cursor, limit: 50 });
    r.data.forEach((e: any) => ids.add(e.parsedJson.guild_id));
    if (!r.hasNextPage) break;
    cursor = r.nextCursor;
  }
  if (ids.size === 0) return [];
  const objs = await client.multiGetObjects({ ids: [...ids], options: { showContent: true } });
  return objs
    .filter((o: any) => o.data?.content)
    .map((o: any) => summaryFrom(o.data.objectId, (o.data.content as any).fields))
    .sort((a, b) => b.rating - a.rating || b.memberCount - a.memberCount);
}

/** Full guild state incl. members + roles. */
export async function getGuild(id: string): Promise<GuildDetail | null> {
  const f = await fieldsOf(id);
  if (!f) return null;
  const client = getJsonRpcClient();
  const tableId = f.members?.fields?.id?.id;
  const members: GuildMember[] = [];
  if (tableId) {
    const dfs = await client.getDynamicFields({ parentId: tableId, limit: 50 });
    const objs = await client.multiGetObjects({ ids: dfs.data.map((d: any) => d.objectId), options: { showContent: true } });
    for (const o of objs as any[]) {
      const df = o.data?.content?.fields;
      if (df) members.push({ address: df.name, role: num(df.value) });
    }
  }
  members.sort((a, b) => b.role - a.role || a.address.localeCompare(b.address));
  return {
    ...summaryFrom(id, f),
    description: f.description ?? "",
    emblemUrl: f.emblem_url ?? "",
    members,
    invites: f.invites?.fields?.contents ?? [],
    treasuryMist: big(f.treasury),
    warLockedUntil: num(f.war_locked_until),
    openWarId: optId(f.open_war),
  };
}

/** The guild id `address` belongs to, or null. */
export async function myGuildId(address: string): Promise<string | null> {
  if (!GUILD_REGISTRY_ID) return null;
  const reg = await fieldsOf(GUILD_REGISTRY_ID);
  const tableId = reg?.members?.fields?.id?.id;
  if (!tableId) return null;
  try {
    const df = await getJsonRpcClient().getDynamicFieldObject({ parentId: tableId, name: { type: "address", value: address } });
    return ((df.data?.content as any)?.fields?.value as string) ?? null;
  } catch {
    return null;
  }
}

export async function getWar(id: string): Promise<GuildWarInfo | null> {
  const f = await fieldsOf(id);
  if (!f) return null;
  return {
    id,
    guildA: f.guild_a,
    guildB: f.guild_b,
    teamSize: num(f.team_size),
    stakeMist: big(f.stake),
    levelMin: num(f.level_min),
    levelMax: num(f.level_max),
    status: num(f.status),
    startAt: num(f.start_at),
    startedAt: num(f.started_at),
    sideA: f.side_a ?? [],
    sideB: f.side_b ?? [],
    winner: num(f.winner),
  };
}

/** Wars that involve `guildId` (newest first, up to 20). */
export async function listWarsFor(guildId: string): Promise<GuildWarInfo[]> {
  const r = await getJsonRpcClient().queryEvents({ query: { MoveEventType: t("guild_war", "WarDeclared") }, order: "descending", limit: 50 });
  const ids = r.data
    .map((e: any) => e.parsedJson)
    .filter((j: any) => j.guild_a === guildId || j.guild_b === guildId)
    .slice(0, 20)
    .map((j: any) => j.war_id as string);
  const wars = await Promise.all(ids.map(getWar));
  return wars.filter((w): w is GuildWarInfo => !!w);
}

// ─────────────────────────── guild txs ───────────────────────────

export function buildCreateGuildTx(characterId: string, name: string, open: boolean): Transaction {
  const tx = new Transaction();
  const [fee] = tx.splitCoins(tx.gas, [tx.pure.u64(GUILD_CREATION_FEE_MIST)]);
  tx.moveCall({ target: t("guild", "create_guild"), arguments: [
    tx.object(GUILD_REGISTRY_ID), tx.object(characterId), tx.pure.string(name), tx.pure.bool(open), fee, tx.object(SUI_CLOCK),
  ] });
  return tx;
}

export function buildJoinGuildTx(guildId: string, characterId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild", "join_guild"), arguments: [tx.object(guildId), tx.object(GUILD_REGISTRY_ID), tx.object(characterId), tx.object(SUI_CLOCK)] });
  return tx;
}

export function buildLeaveGuildTx(guildId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild", "leave_guild"), arguments: [tx.object(guildId), tx.object(GUILD_REGISTRY_ID), tx.object(SUI_CLOCK)] });
  return tx;
}

export function buildKickTx(guildId: string, member: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild", "kick_member"), arguments: [tx.object(guildId), tx.object(GUILD_REGISTRY_ID), tx.pure.address(member), tx.object(SUI_CLOCK)] });
  return tx;
}

function simpleGuildCall(fn: string, guildId: string, extra: (tx: Transaction) => any[] = () => []): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild", fn), arguments: [tx.object(guildId), ...extra(tx)] });
  return tx;
}

export const buildInviteTx = (guildId: string, who: string) => simpleGuildCall("invite_member", guildId, (tx) => [tx.pure.address(who)]);
export const buildRevokeInviteTx = (guildId: string, who: string) => simpleGuildCall("revoke_invite", guildId, (tx) => [tx.pure.address(who)]);
export const buildDeclineInviteTx = (guildId: string) => simpleGuildCall("decline_invite", guildId);
export const buildPromoteTx = (guildId: string, who: string) => simpleGuildCall("promote_to_officer", guildId, (tx) => [tx.pure.address(who)]);
export const buildDemoteTx = (guildId: string, who: string) => simpleGuildCall("demote_to_member", guildId, (tx) => [tx.pure.address(who)]);
export const buildTransferLeadershipTx = (guildId: string, who: string) => simpleGuildCall("transfer_leadership", guildId, (tx) => [tx.pure.address(who)]);
export const buildSetOpenTx = (guildId: string, open: boolean) => simpleGuildCall("set_open", guildId, (tx) => [tx.pure.bool(open)]);
export const buildSetProfileTx = (guildId: string, description: string, emblemUrl: string) =>
  simpleGuildCall("set_profile", guildId, (tx) => [tx.pure.string(description), tx.pure.string(emblemUrl)]);

export function buildDonateTx(guildId: string, amountMist: bigint): Transaction {
  const tx = new Transaction();
  const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(amountMist)]);
  tx.moveCall({ target: t("guild", "donate"), arguments: [tx.object(guildId), c] });
  return tx;
}

export function buildWithdrawTx(guildId: string, amountMist: bigint): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild", "withdraw"), arguments: [tx.object(guildId), tx.pure.u64(amountMist), tx.object(SUI_CLOCK)] });
  return tx;
}

export function buildDisbandTx(guildId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild", "disband_guild"), arguments: [tx.object(guildId), tx.object(GUILD_REGISTRY_ID), tx.object(SUI_CLOCK)] });
  return tx;
}

// ─────────────────────────── war txs ───────────────────────────

export function buildDeclareWarTx(args: {
  myGuildId: string; enemyGuildId: string; characterId: string; teamSize: number; stakeMist: bigint; levelRule: number; delayMin: number;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild_war", "declare_war"), arguments: [
    tx.object(args.myGuildId), tx.object(args.enemyGuildId), tx.object(args.characterId),
    tx.pure.u64(args.teamSize), tx.pure.u64(args.stakeMist), tx.pure.u8(args.levelRule), tx.pure.u64(args.delayMin * 60_000), tx.object(SUI_CLOCK),
  ] });
  return tx;
}

export function buildAcceptWarTx(warId: string, myGuildId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild_war", "accept_war"), arguments: [tx.object(warId), tx.object(myGuildId), tx.object(SUI_CLOCK)] });
  return tx;
}

export function buildJoinWarTx(warId: string, myGuildId: string, characterId: string, stakeMist: bigint): Transaction {
  const tx = new Transaction();
  const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(stakeMist)]);
  tx.moveCall({ target: t("guild_war", "join_war"), arguments: [
    tx.object(warId), tx.object(WAR_REGISTRY_ID), tx.object(myGuildId), tx.object(characterId), c, tx.object(SUI_CLOCK),
  ] });
  return tx;
}

export function buildLeaveWarTx(warId: string): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild_war", "leave_war"), arguments: [tx.object(warId), tx.object(WAR_REGISTRY_ID), tx.object(SUI_CLOCK)] });
  return tx;
}

export function buildExpireWarTx(war: GuildWarInfo): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild_war", "expire_war"), arguments: [
    tx.object(war.id), tx.object(WAR_REGISTRY_ID), tx.object(war.guildA), tx.object(war.guildB), tx.object(SUI_CLOCK),
  ] });
  return tx;
}

export function buildReclaimWarTx(war: GuildWarInfo): Transaction {
  const tx = new Transaction();
  tx.moveCall({ target: t("guild_war", "reclaim_stalled_war"), arguments: [
    tx.object(war.id), tx.object(WAR_REGISTRY_ID), tx.object(war.guildA), tx.object(war.guildB), tx.object(SUI_CLOCK),
  ] });
  return tx;
}

/** Friendly text for guild / guild_war abort codes. */
export const GUILD_ABORTS: Record<number, string> = {
  1: "That character isn't yours.", 2: "You're already in a guild.", 3: "Founding a guild costs exactly 1 SUI.",
  4: "Names: 3–24 letters, digits, spaces, _ or - (no double spaces).", 5: "That guild name is taken.",
  6: "Not a member of this guild.", 7: "Only the leader can do that.", 8: "Only the leader or an officer can do that.",
  9: "The guild is full (30).", 10: "You need an invite for this guild.", 11: "The leader can't leave — hand over leadership or disband.",
  13: "You can't act on someone of equal or higher rank.", 15: "Not enough SUI in the guild treasury.",
  16: "Everyone else must leave before the guild can be disbanded.", 17: "Locked while a guild war is running.",
  19: "Already invited.", 20: "Text too long.", 24: "The guild already has an open war.",
};
export const WAR_ABORTS: Record<number, string> = {
  0: "Only the leader or an officer can declare or accept a war.", 1: "A guild can't fight itself.", 2: "Team size must be 2–10.",
  3: "Start delay must be 5–30 minutes.", 6: "The war isn't in the right stage for that.", 7: "Wrong guild for this war.",
  8: "Sign-ups are closed — the war has started.", 9: "Only members of the two guilds can sign up.",
  10: "Your level is outside this war's level rule.", 11: "You're in another fight right now.", 12: "You're already signed up for a war.",
  13: "Your side is full.", 14: "Wrong stake amount.", 15: "You're not signed up.", 17: "Too early.", 19: "The war hasn't expired yet.",
  20: "Only fighters in this war can do that.",
};
