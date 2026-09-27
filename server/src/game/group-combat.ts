/**
 * v5.3 — Group (guild-war) combat engine. Pure logic, no network / chain.
 *
 * combats.ru-style pairing: every living fighter has at most one current
 * opponent. A pair fights one exchange (both pick strike + guard zones,
 * 20 s timer, auto-action on timeout or when the fighter is offline). After
 * an exchange resolves both fighters are free and get re-paired with the
 * least-engaged free living enemy. Battle ends when one side is dead (both
 * sides dead at once = draw) or at the hard time cap, where the side with the
 * higher total HP% wins (equal = draw).
 *
 * Damage math reuses combat.ts (deriveCombatStats / resolveTurn) unchanged,
 * with stats derived per pair so anti-crit / anti-evasion see the real foe.
 */
import { GAME_CONSTANTS } from '../config';
import type { Character, TurnAction, Zone } from '../types';
import {
  deriveCombatStats,
  generateRandomAction,
  getOffhandType,
  resolveTurn,
  validateTurnAction,
} from './combat';

export type Side = 'A' | 'B';

export interface WarFighter {
  wallet: string;
  name: string;
  level: number;
  side: Side;
  character: Character;
  hp: number;
  maxHp: number;
  exchanges: number;
  /** Wallet of the current opponent while in an exchange. */
  opponent: string | null;
}

export interface WarExchange {
  id: number;
  a: string; // wallet
  b: string; // wallet
  deadline: number;
  actions: Map<string, TurnAction>;
}

export interface WarLogEntry {
  at: number;
  text: string;
}

export interface WarBattle {
  warId: string;
  fighters: Map<string, WarFighter>;
  exchanges: Map<number, WarExchange>;
  nextExchangeId: number;
  startedAt: number;
  endsBy: number;
  log: WarLogEntry[];
  /** null while running; 'A' | 'B' | 'draw' when over. */
  result: Side | 'draw' | null;
}

export const WAR_EXCHANGE_MS = GAME_CONSTANTS.TURN_TIMER_MS;
export const WAR_MAX_DURATION_MS = 25 * 60 * 1000;
const LOG_KEEP = 60;

export function createWarBattle(
  warId: string,
  sideA: Character[],
  sideB: Character[],
  now: number,
): WarBattle {
  const fighters = new Map<string, WarFighter>();
  const add = (c: Character, side: Side) => {
    const maxHp = deriveCombatStats(c).maxHp;
    fighters.set(c.walletAddress, {
      wallet: c.walletAddress, name: c.name, level: c.level, side, character: c,
      hp: maxHp, maxHp, exchanges: 0, opponent: null,
    });
  };
  sideA.forEach((c) => add(c, 'A'));
  sideB.forEach((c) => add(c, 'B'));
  return {
    warId, fighters, exchanges: new Map(), nextExchangeId: 1,
    startedAt: now, endsBy: now + WAR_MAX_DURATION_MS,
    log: [{ at: now, text: `The war horns sound — ${sideA.length} against ${sideB.length}.` }],
    result: null,
  };
}

const alive = (f: WarFighter) => f.hp > 0;
const free = (f: WarFighter) => alive(f) && f.opponent === null;

function pushLog(b: WarBattle, now: number, text: string) {
  b.log.push({ at: now, text });
  if (b.log.length > LOG_KEEP) b.log.splice(0, b.log.length - LOG_KEEP);
}

/**
 * Pair every free living fighter with the least-engaged free living enemy.
 * Returns the new exchanges (caller arms their timers). `rng` is injectable
 * for deterministic tests.
 */
export function pairFighters(b: WarBattle, now: number, rng: () => number = Math.random): WarExchange[] {
  if (b.result) return [];
  const created: WarExchange[] = [];
  const byEngagement = (x: WarFighter, y: WarFighter) => x.exchanges - y.exchanges || rng() - 0.5;
  const freeA = [...b.fighters.values()].filter((f) => f.side === 'A' && free(f)).sort(byEngagement);
  for (const fa of freeA) {
    const enemies = [...b.fighters.values()].filter((f) => f.side === 'B' && free(f)).sort(byEngagement);
    const fb = enemies[0];
    if (!fb) break;
    const ex: WarExchange = { id: b.nextExchangeId++, a: fa.wallet, b: fb.wallet, deadline: now + WAR_EXCHANGE_MS, actions: new Map() };
    fa.opponent = fb.wallet;
    fb.opponent = fa.wallet;
    b.exchanges.set(ex.id, ex);
    created.push(ex);
  }
  return created;
}

export function exchangeOf(b: WarBattle, wallet: string): WarExchange | undefined {
  for (const ex of b.exchanges.values()) if (ex.a === wallet || ex.b === wallet) return ex;
  return undefined;
}

/** Record a fighter's action. Returns the exchange when both actions are in. */
export function submitWarAction(
  b: WarBattle,
  wallet: string,
  action: TurnAction,
): { ok: true; ready: WarExchange | null } | { ok: false; error: string } {
  if (b.result) return { ok: false, error: 'The war is over' };
  const f = b.fighters.get(wallet);
  if (!f || !alive(f)) return { ok: false, error: 'You are not fighting' };
  const ex = exchangeOf(b, wallet);
  if (!ex) return { ok: false, error: 'Waiting for a free enemy' };
  if (ex.actions.has(wallet)) return { ok: false, error: 'Already chose this exchange' };
  const v = validateTurnAction(action, getOffhandType(f.character.equipment));
  if (!v.valid) return { ok: false, error: v.error ?? 'Invalid action' };
  ex.actions.set(wallet, { attackZones: [...action.attackZones] as Zone[], blockZones: [...action.blockZones] as Zone[] });
  return { ok: true, ready: ex.actions.size === 2 ? ex : null };
}

/** Fill a missing action with a random legal one (timeout / offline). */
export function autoAct(b: WarBattle, ex: WarExchange, wallet: string): void {
  if (ex.actions.has(wallet)) return;
  const f = b.fighters.get(wallet);
  if (!f) return;
  ex.actions.set(wallet, generateRandomAction(getOffhandType(f.character.equipment)));
}

/** Resolve one exchange, update HP, free both fighters, check for the end. */
export function resolveExchange(b: WarBattle, ex: WarExchange, now: number): void {
  if (!b.exchanges.has(ex.id)) return;
  autoAct(b, ex, ex.a);
  autoAct(b, ex, ex.b);
  const fa = b.fighters.get(ex.a)!;
  const fb = b.fighters.get(ex.b)!;
  const sa = { characterId: fa.character.id, walletAddress: fa.wallet, currentHp: fa.hp, maxHp: fa.maxHp,
    derivedStats: deriveCombatStats(fa.character, fb.character.stats, fb.character.equipment), character: fa.character };
  const sb = { characterId: fb.character.id, walletAddress: fb.wallet, currentHp: fb.hp, maxHp: fb.maxHp,
    derivedStats: deriveCombatStats(fb.character, fa.character.stats, fa.character.equipment), character: fb.character };
  const r = resolveTurn(fa.exchanges + fb.exchanges + 1, sa, sb, ex.actions.get(ex.a)!, ex.actions.get(ex.b)!);
  fa.hp = sa.currentHp;
  fb.hp = sb.currentHp;
  fa.exchanges++; fb.exchanges++;
  fa.opponent = null; fb.opponent = null;
  b.exchanges.delete(ex.id);

  const dmgTo = (hits: { damage: number }[]) => Math.round(hits.reduce((s, h) => s + h.damage, 0));
  pushLog(b, now, `${fa.name} ⚔ ${fb.name}: ${fb.name} −${dmgTo(r.playerB.hits)} [${Math.round(fb.hp)}/${fb.maxHp}], ${fa.name} −${dmgTo(r.playerA.hits)} [${Math.round(fa.hp)}/${fa.maxHp}]`);
  if (!alive(fa)) pushLog(b, now, `${fa.name} has fallen.`);
  if (!alive(fb)) pushLog(b, now, `${fb.name} has fallen.`);
  checkEnd(b, now);
}

function sideAlive(b: WarBattle, side: Side): boolean {
  for (const f of b.fighters.values()) if (f.side === side && alive(f)) return true;
  return false;
}

export function checkEnd(b: WarBattle, now: number): void {
  if (b.result) return;
  const a = sideAlive(b, 'A');
  const bb = sideAlive(b, 'B');
  if (!a && !bb) b.result = 'draw';
  else if (!a) b.result = 'B';
  else if (!bb) b.result = 'A';
  else if (now >= b.endsBy) {
    const pct = (side: Side) => {
      let hp = 0, max = 0;
      for (const f of b.fighters.values()) if (f.side === side) { hp += Math.max(0, f.hp); max += f.maxHp; }
      return max ? hp / max : 0;
    };
    const pa = pct('A'), pb = pct('B');
    b.result = Math.abs(pa - pb) < 1e-9 ? 'draw' : pa > pb ? 'A' : 'B';
    pushLog(b, now, `Time is up — the judges count the blood (${Math.round(pa * 100)}% vs ${Math.round(pb * 100)}%).`);
  }
  if (b.result) {
    b.exchanges.clear();
    for (const f of b.fighters.values()) f.opponent = null;
    pushLog(b, now, b.result === 'draw' ? 'The war ends in a draw.' : `Side ${b.result} is victorious.`);
  }
}

/** What one participant (or a spectator) sees. */
export function viewFor(b: WarBattle, wallet: string | null, now: number) {
  const ex = wallet ? exchangeOf(b, wallet) : undefined;
  const me = wallet ? b.fighters.get(wallet) : undefined;
  return {
    warId: b.warId,
    result: b.result,
    startedAt: b.startedAt,
    endsBy: b.endsBy,
    now,
    mySide: me?.side ?? null,
    fighters: [...b.fighters.values()].map((f) => ({
      wallet: f.wallet, name: f.name, level: f.level, side: f.side, hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp,
      exchanges: f.exchanges, fighting: f.opponent,
    })),
    exchange: ex && me ? {
      id: ex.id,
      opponent: ex.a === wallet ? ex.b : ex.a,
      deadline: ex.deadline,
      chosen: ex.actions.has(wallet!),
    } : null,
    log: b.log.slice(-25),
  };
}
