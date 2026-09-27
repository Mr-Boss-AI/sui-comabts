/**
 * v5.3 — Guild-war orchestration.
 *
 * Every POLL_MS the server:
 *   1. discovers wars from `WarDeclared` events,
 *   2. expires DECLARED wars nobody accepted by start time,
 *   3. calls `start_war` (TREASURY) once an ACCEPTED war reaches start time,
 *   4. loads every fighter from chain (stats + equipped DOFs, snapshotted for
 *      the whole battle) and runs the group-combat engine in memory,
 *   5. calls `settle_war` when the battle ends (retried each poll until it
 *      lands; the chain's 60-min `reclaim_stalled_war` is the backstop).
 *
 * Wire:
 *   client → `war_watch { warId? }`   (no warId = "the war I'm fighting in")
 *   client → `war_action { warId, attackZones, blockZones }`
 *   server → `war_state { ...viewFor(), settled, digest }`
 */
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { CONFIG } from '../config';
import type { Character, ClientMessage, ConnectedClient, TurnAction } from '../types';
import {
  createWarBattle,
  pairFighters,
  submitWarAction,
  autoAct,
  resolveExchange,
  checkEnd,
  viewFor,
  WAR_EXCHANGE_MS,
  WAR_MAX_DURATION_MS,
  type WarBattle,
} from '../game/group-combat';
import { fetchEquippedFromDOFs } from '../utils/sui-read';
import { startWarOnChain, settleWarOnChain, expireWarOnChain, type WarRefs } from '../utils/sui-settle';

const network = (CONFIG.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const client = new SuiJsonRpcClient({ url: CONFIG.SUI_RPC_URL || getJsonRpcFullnodeUrl(network), network });

const POLL_MS = Number(process.env.WAR_POLL_MS ?? 15_000);
const TICK_MS = 1_000;
/** Minimum time an exchange stays open once both actions are in (animation pace). */
const MIN_EXCHANGE_MS = 2_000;
/** The chain lets participants reclaim after 60 min; finish well before. */
const CHAIN_SAFE_WINDOW_MS = 50 * 60 * 1000;
/** Keep a finished battle viewable this long. */
const KEEP_FINISHED_MS = 15 * 60 * 1000;

const STATUS = { DECLARED: 0, ACCEPTED: 1, ACTIVE: 2, SETTLED: 3, CANCELLED: 4 } as const;

interface ChainWar extends WarRefs {
  status: number;
  startAt: number;
  startedAt: number;
  sideA: string[];
  sideB: string[];
  stake: bigint;
}

interface LiveWar {
  refs: WarRefs;
  battle: WarBattle;
  settling: boolean;
  settled: boolean;
  digest: string | null;
  finishedAt: number | null;
  watchers: Set<string>; // wallets watching (fighters are always sent)
  dirty: boolean;
}

const watchIds = new Set<string>();
const finalIds = new Set<string>();
const live = new Map<string, LiveWar>();
const inFlight = new Set<string>();

let clientsRef: Map<string, ConnectedClient> = new Map();
let pollTimer: NodeJS.Timeout | null = null;
let tickTimer: NodeJS.Timeout | null = null;

export function setWarClientsRef(clients: Map<string, ConnectedClient>): void {
  clientsRef = clients;
}

// ---------------------------------------------------------------------------
// Presence helpers
// ---------------------------------------------------------------------------

function clientsFor(wallet: string): ConnectedClient[] {
  const lower = wallet.toLowerCase();
  const out: ConnectedClient[] = [];
  for (const c of clientsRef.values()) {
    if (c.authenticated && c.walletAddress?.toLowerCase() === lower) out.push(c);
  }
  return out;
}

const isOnline = (wallet: string) => clientsFor(wallet).length > 0;

function sendTo(wallet: string, msg: Record<string, unknown>): void {
  const raw = JSON.stringify(msg);
  for (const c of clientsFor(wallet)) {
    if (c.socket.readyState === c.socket.OPEN) c.socket.send(raw);
  }
}

function broadcast(w: LiveWar, now = Date.now()): void {
  const targets = new Set<string>([...w.battle.fighters.keys(), ...w.watchers]);
  for (const wallet of targets) {
    sendTo(wallet, {
      type: 'war_state',
      ...viewFor(w.battle, w.battle.fighters.has(wallet) ? wallet : null, now),
      settled: w.settled,
      digest: w.digest,
    });
  }
  w.dirty = false;
}

/** True while `wallet` is fighting in an unfinished guild-war battle. */
export function isInActiveWar(wallet: string | undefined): boolean {
  if (!wallet) return false;
  for (const w of live.values()) {
    if (!w.battle.result && w.battle.fighters.has(wallet)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Chain reads
// ---------------------------------------------------------------------------

function parseWar(obj: any): ChainWar | null {
  const f = obj?.data?.content?.fields;
  if (!f) return null;
  return {
    warId: obj.data.objectId,
    guildA: String(f.guild_a),
    guildB: String(f.guild_b),
    status: Number(f.status),
    startAt: Number(f.start_at),
    startedAt: Number(f.started_at),
    sideA: (f.side_a ?? []).map(String),
    sideB: (f.side_b ?? []).map(String),
    stake: BigInt(f.stake ?? 0),
  };
}

async function discover(): Promise<void> {
  const res = await client.queryEvents({
    query: { MoveEventType: `${CONFIG.SUI_PACKAGE_ID}::guild_war::WarDeclared` },
    limit: 50,
    order: 'descending',
  });
  for (const e of res.data) {
    const id = String((e.parsedJson as any)?.war_id ?? '');
    if (id && !finalIds.has(id)) watchIds.add(id);
  }
}

let characterTableId: string | null = null;
async function characterIdOf(wallet: string): Promise<string | null> {
  if (!characterTableId) {
    const reg = await client.getObject({ id: CONFIG.CHARACTER_REGISTRY_ID, options: { showContent: true } });
    characterTableId = (reg.data?.content as any)?.fields?.table?.fields?.id?.id ?? null;
    if (!characterTableId) return null;
  }
  const df = await client.getDynamicFieldObject({ parentId: characterTableId, name: { type: 'address', value: wallet } });
  const v = (df.data?.content as any)?.fields?.value;
  return v ? String(v) : null;
}

/** Snapshot a fighter straight from chain: stats + equipped DOFs. */
async function loadFighter(wallet: string): Promise<Character | null> {
  const charId = await characterIdOf(wallet);
  if (!charId) return null;
  const obj = await client.getObject({ id: charId, options: { showContent: true } });
  const f = (obj.data?.content as any)?.fields;
  if (!f) return null;
  const equipment = await fetchEquippedFromDOFs(charId);
  if (!equipment) return null;
  return {
    id: charId,
    name: String(f.name),
    level: Number(f.level),
    xp: Number(f.xp),
    walletAddress: wallet,
    stats: {
      strength: Number(f.strength),
      dexterity: Number(f.dexterity),
      intuition: Number(f.intuition),
      endurance: Number(f.endurance),
    },
    equipment,
    inventory: [],
    gold: 0,
    wins: Number(f.wins),
    losses: Number(f.losses),
    draws: Number(f.draws ?? 0),
    rating: Number(f.rating),
    unallocatedPoints: Number(f.unallocated_points ?? 0),
    onChainObjectId: charId,
    fightHistory: [],
    createdAt: Number(f.created_at),
  } as Character;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function launchBattle(war: ChainWar): Promise<void> {
  const load = async (wallets: string[]) => {
    const out: Character[] = [];
    for (const w of wallets) {
      const c = await loadFighter(w);
      if (c) out.push(c);
      else console.warn(`[War] ${war.warId.slice(0, 10)}: could not load fighter ${w.slice(0, 10)} — sits out`);
    }
    return out;
  };
  const [a, b] = [await load(war.sideA), await load(war.sideB)];
  const now = Date.now();
  const battle = createWarBattle(war.warId, a, b, now);
  // After a server restart the chain clock keeps running: never run past
  // the point where participants could reclaim.
  const hardStop = (war.startedAt || now) + CHAIN_SAFE_WINDOW_MS;
  battle.endsBy = Math.max(now + 60_000, Math.min(now + WAR_MAX_DURATION_MS, hardStop));
  const w: LiveWar = {
    refs: { warId: war.warId, guildA: war.guildA, guildB: war.guildB },
    battle, settling: false, settled: false, digest: null, finishedAt: null,
    watchers: new Set(), dirty: true,
  };
  live.set(war.warId, w);
  checkEnd(battle, now); // an empty side = instant result
  if (!battle.result) pairAndPrime(w, now);
  console.log(`[War] battle ${war.warId.slice(0, 10)} live: ${a.length} v ${b.length}`);
  broadcast(w, now);
}

/** Pair free fighters; offline fighters act at once (random zones). */
function pairAndPrime(w: LiveWar, now: number): void {
  for (const ex of pairFighters(w.battle, now)) {
    if (!isOnline(ex.a)) autoAct(w.battle, ex, ex.a);
    if (!isOnline(ex.b)) autoAct(w.battle, ex, ex.b);
    w.dirty = true;
  }
}

async function settle(w: LiveWar): Promise<void> {
  if (w.settling || w.settled || !w.battle.result) return;
  w.settling = true;
  const winner = w.battle.result === 'A' ? 1 : w.battle.result === 'B' ? 2 : 3;
  try {
    const { digest } = await settleWarOnChain(w.refs, winner);
    w.settled = true;
    w.digest = digest;
    w.dirty = true;
  } catch (err) {
    console.error(`[War] settle ${w.refs.warId.slice(0, 10)} failed (will retry):`, (err as Error)?.message || err);
  } finally {
    w.settling = false;
  }
}

async function handleWar(war: ChainWar, now: number): Promise<void> {
  const w = live.get(war.warId);
  if (war.status === STATUS.SETTLED || war.status === STATUS.CANCELLED) {
    watchIds.delete(war.warId);
    finalIds.add(war.warId);
    if (w && !w.settled) { w.settled = true; w.dirty = true; }
    return;
  }
  if (war.status === STATUS.DECLARED && now >= war.startAt + 5_000) {
    await expireWarOnChain(war);
    return;
  }
  if (war.status === STATUS.ACCEPTED && now >= war.startAt + 2_000) {
    const r = await startWarOnChain(war);
    if (!r.cancelled) {
      await launchBattle({ ...war, status: STATUS.ACTIVE, startedAt: now, sideA: r.sideA, sideB: r.sideB });
    }
    return;
  }
  if (war.status === STATUS.ACTIVE) {
    if (!w) await launchBattle(war);
    else if (w.battle.result && !w.settled) await settle(w);
  }
}

async function poll(): Promise<void> {
  try {
    await discover();
  } catch (err) {
    console.warn('[War] discover failed:', (err as Error)?.message || err);
  }
  const ids = [...watchIds];
  for (let i = 0; i < ids.length; i += 50) {
    let objs: any[] = [];
    try {
      objs = await client.multiGetObjects({ ids: ids.slice(i, i + 50), options: { showContent: true } });
    } catch (err) {
      console.warn('[War] read failed:', (err as Error)?.message || err);
      continue;
    }
    for (const o of objs) {
      const war = parseWar(o);
      if (!war || inFlight.has(war.warId)) continue;
      inFlight.add(war.warId);
      handleWar(war, Date.now())
        .catch((err) => console.warn(`[War] ${war.warId.slice(0, 10)}:`, (err as Error)?.message || err))
        .finally(() => inFlight.delete(war.warId));
    }
  }
}

/** 1 s heartbeat: resolve due exchanges, re-pair, time cap, broadcast. */
function tick(): void {
  const now = Date.now();
  for (const [id, w] of live) {
    const b = w.battle;
    if (!b.result) {
      for (const ex of [...b.exchanges.values()]) {
        const openedAt = ex.deadline - WAR_EXCHANGE_MS;
        const bothIn = ex.actions.size === 2 && now >= openedAt + MIN_EXCHANGE_MS;
        if (bothIn || now >= ex.deadline) {
          resolveExchange(b, ex, now);
          w.dirty = true;
        }
      }
      checkEnd(b, now);
      if (!b.result) pairAndPrime(w, now);
      if (b.result) { w.dirty = true; void settle(w); }
    }
    if (b.result && w.finishedAt === null) w.finishedAt = now;
    if (w.dirty) broadcast(w, now);
    if (w.settled && w.finishedAt !== null && now - w.finishedAt > KEEP_FINISHED_MS) live.delete(id);
  }
}

// ---------------------------------------------------------------------------
// WS entry points
// ---------------------------------------------------------------------------

function findWarFor(wallet: string): LiveWar | undefined {
  let best: LiveWar | undefined;
  for (const w of live.values()) {
    if (!w.battle.fighters.has(wallet)) continue;
    if (!best || (!w.battle.result && best.battle.result)) best = w;
  }
  return best;
}

/** Returns true when the message was a war message. */
export function dispatchWarMessage(c: ConnectedClient, msg: ClientMessage): boolean {
  if (msg.type !== 'war_watch' && msg.type !== 'war_unwatch' && msg.type !== 'war_action') return false;
  const wallet = c.walletAddress?.toLowerCase();
  if (!wallet) return true;
  const w = typeof msg.warId === 'string' && msg.warId ? live.get(msg.warId) : findWarFor(wallet);

  if (msg.type === 'war_unwatch') {
    w?.watchers.delete(wallet);
    return true;
  }
  if (!w) {
    sendTo(wallet, { type: 'war_none', warId: msg.warId ?? null });
    return true;
  }
  if (msg.type === 'war_watch') {
    if (!w.battle.fighters.has(wallet)) w.watchers.add(wallet);
    sendTo(wallet, { type: 'war_state', ...viewFor(w.battle, w.battle.fighters.has(wallet) ? wallet : null, Date.now()), settled: w.settled, digest: w.digest });
    return true;
  }
  const action: TurnAction = {
    attackZones: Array.isArray(msg.attackZones) ? msg.attackZones : [],
    blockZones: Array.isArray(msg.blockZones) ? msg.blockZones : [],
  };
  const r = submitWarAction(w.battle, wallet, action);
  if (!r.ok) {
    sendTo(wallet, { type: 'war_error', warId: w.refs.warId, error: r.error });
    return true;
  }
  // Foe offline → it acts at random right away so nobody waits 20 s on a ghost.
  const ex = [...w.battle.exchanges.values()].find((e) => e.a === wallet || e.b === wallet);
  if (ex) {
    const foe = ex.a === wallet ? ex.b : ex.a;
    if (!isOnline(foe)) autoAct(w.battle, ex, foe);
  }
  w.dirty = true;
  return true;
}

export function startWarRoom(): void {
  if (!CONFIG.WAR_REGISTRY_ID || !CONFIG.CHARACTER_REGISTRY_ID) {
    console.log('[War] WAR_REGISTRY_ID / CHARACTER_REGISTRY_ID not set — guild wars disabled');
    return;
  }
  if (pollTimer) return;
  console.log(`[War] guild-war runner on (poll ${POLL_MS} ms)`);
  void poll();
  pollTimer = setInterval(() => void poll(), POLL_MS);
  tickTimer = setInterval(tick, TICK_MS);
}

export function stopWarRoom(): void {
  if (pollTimer) clearInterval(pollTimer);
  if (tickTimer) clearInterval(tickTimer);
  pollTimer = tickTimer = null;
}
