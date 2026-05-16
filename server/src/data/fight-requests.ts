/**
 * Fight requests — explicit player-to-player challenges.
 *
 * Distinct from the legacy `challenge_player` flow (kept around for
 * backwards compat) and from the wager lobby (anonymous open offers).
 * A fight request targets a SPECIFIC wallet, has a 90s TTL, and goes
 * through the explicit state machine:
 *
 *   pending → accepted   (target accepted; fight starts immediately for
 *                         friendly variant, or wager-create UI is opened
 *                         for wager variant)
 *   pending → declined   (target said no)
 *   pending → canceled   (sender withdrew before target acted)
 *   pending → expired    (90s TTL passed; sweeper marks it on next tick)
 *
 * Persisted to the `fight_requests` table (003_tavern.sql) so a target
 * who refreshes mid-incoming-request still sees it. The service exposes
 * pure decision helpers (`evaluateAcceptability`, `nextStateFor`) so
 * the QA gauntlet can pin behaviour without DB roundtrips.
 *
 * Wager variant: the request carries a stake amount in MIST. Accepting
 * doesn't auto-create the wager — the target sees a "Player X challenged
 * you to a 0.5 SUI wager" modal, clicks Accept, and is dropped into the
 * wager-create flow with the stake pre-filled. The actual on-chain
 * `create_wager` is signed by the CHALLENGER (so they fund the escrow);
 * the target's accept just opens the lobby slot for them. This mirrors
 * how the existing wager lobby works.
 */

import { v4 as uuidv4 } from 'uuid';
import { getSupabase } from './supabase';
import { getCharacterByWallet } from './characters';

export type FightRequestType = 'friendly' | 'wager';
export type FightRequestStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'canceled'
  | 'expired';

export interface FightRequest {
  id: string;
  requestType: FightRequestType;
  fromWallet: string;
  fromName: string;
  toWallet: string;
  toName: string;
  /** Stake in MIST as a BigInt-safe string. Wager variant only. */
  stakeMist?: string;
  /** Optional message — capped to MESSAGE_MAX chars at the API layer. */
  message?: string;
  status: FightRequestStatus;
  expiresAt: number;
  resolvedAt?: number;
  createdAt: number;
}

export const TTL_MS = 90_000;
export const MESSAGE_MAX = 280;
export const MIN_STAKE_MIST = 100_000_000n; // 0.1 SUI minimum (mirrors wager-input.ts)
export const MAX_PENDING_PER_SENDER = 5;

// ─── in-memory store ──────────────────────────────────────────────────

const requestsById = new Map<string, FightRequest>();
const pendingByTarget = new Map<string, Set<string>>(); // toWallet -> Set<id>
const pendingBySender = new Map<string, Set<string>>(); // fromWallet -> Set<id>

function indexInsert(req: FightRequest): void {
  if (req.status !== 'pending') return;
  let toSet = pendingByTarget.get(req.toWallet);
  if (!toSet) {
    toSet = new Set();
    pendingByTarget.set(req.toWallet, toSet);
  }
  toSet.add(req.id);

  let fromSet = pendingBySender.get(req.fromWallet);
  if (!fromSet) {
    fromSet = new Set();
    pendingBySender.set(req.fromWallet, fromSet);
  }
  fromSet.add(req.id);
}

function indexRemove(req: FightRequest): void {
  pendingByTarget.get(req.toWallet)?.delete(req.id);
  pendingBySender.get(req.fromWallet)?.delete(req.id);
}

// ─── pure decision helpers ────────────────────────────────────────────

export type CreateRejection =
  | { ok: false; reason: 'self_target' | 'invalid_target' | 'invalid_stake'
      | 'message_too_long' | 'over_limit' | 'duplicate_pending'
      | 'invalid_request_type' };

export type CreateOk = { ok: true };

export type CreateDecision = CreateOk | CreateRejection;

export interface CreateInput {
  requestType: FightRequestType;
  fromWallet: string;
  toWallet: string;
  stakeMist?: string;
  message?: string;
}

export interface CreateContext {
  pendingFromSenderCount: number;
  hasDuplicatePendingForPair: boolean;
}

/**
 * Predicate version: pure function over (input, context). The state
 * machine. The caller is expected to fetch `pendingFromSenderCount` and
 * `hasDuplicatePendingForPair` from the index before calling, so this
 * function stays test-friendly.
 */
export function evaluateCreate(
  input: CreateInput,
  ctx: CreateContext,
): CreateDecision {
  if (input.requestType !== 'friendly' && input.requestType !== 'wager') {
    return { ok: false, reason: 'invalid_request_type' };
  }
  const from = input.fromWallet?.toLowerCase();
  const to = input.toWallet?.toLowerCase();
  if (!from || !to || !from.startsWith('0x') || !to.startsWith('0x')) {
    return { ok: false, reason: 'invalid_target' };
  }
  if (from === to) {
    return { ok: false, reason: 'self_target' };
  }
  if (input.message && input.message.length > MESSAGE_MAX) {
    return { ok: false, reason: 'message_too_long' };
  }
  if (input.requestType === 'wager') {
    if (typeof input.stakeMist !== 'string' || input.stakeMist.length === 0) {
      return { ok: false, reason: 'invalid_stake' };
    }
    let parsed: bigint;
    try {
      parsed = BigInt(input.stakeMist);
    } catch {
      return { ok: false, reason: 'invalid_stake' };
    }
    if (parsed < MIN_STAKE_MIST) {
      return { ok: false, reason: 'invalid_stake' };
    }
  }
  if (ctx.pendingFromSenderCount >= MAX_PENDING_PER_SENDER) {
    return { ok: false, reason: 'over_limit' };
  }
  if (ctx.hasDuplicatePendingForPair) {
    return { ok: false, reason: 'duplicate_pending' };
  }
  return { ok: true };
}

export type TransitionAction = 'accept' | 'decline' | 'cancel' | 'expire';

export type TransitionRejection = {
  ok: false;
  reason: 'not_found' | 'not_pending' | 'not_authorized' | 'expired';
};
export type TransitionOk = { ok: true; nextStatus: FightRequestStatus };
export type TransitionDecision = TransitionOk | TransitionRejection;

/**
 * Pure version of the state-machine transition. `actor` is the wallet
 * attempting the transition; for `accept` / `decline` it must match the
 * `toWallet`, for `cancel` it must match the `fromWallet`.
 */
export function evaluateTransition(
  req: FightRequest | undefined | null,
  action: TransitionAction,
  actor: string | undefined,
  now: number = Date.now(),
): TransitionDecision {
  if (!req) return { ok: false, reason: 'not_found' };
  if (req.status !== 'pending') return { ok: false, reason: 'not_pending' };
  if (now > req.expiresAt && action !== 'expire') {
    return { ok: false, reason: 'expired' };
  }
  const a = actor?.toLowerCase();
  if (action === 'accept' || action === 'decline') {
    if (!a || a !== req.toWallet.toLowerCase()) {
      return { ok: false, reason: 'not_authorized' };
    }
  } else if (action === 'cancel') {
    if (!a || a !== req.fromWallet.toLowerCase()) {
      return { ok: false, reason: 'not_authorized' };
    }
  }
  // 'expire' is system-driven; no actor check.
  const nextStatus: FightRequestStatus =
    action === 'accept' ? 'accepted'
      : action === 'decline' ? 'declined'
        : action === 'cancel' ? 'canceled'
          : 'expired';
  return { ok: true, nextStatus };
}

// ─── store API ────────────────────────────────────────────────────────

export function getRequest(id: string): FightRequest | null {
  return requestsById.get(id) ?? null;
}

export function getPendingForTarget(toWallet: string): FightRequest[] {
  const ids = pendingByTarget.get(toWallet);
  if (!ids) return [];
  const out: FightRequest[] = [];
  for (const id of ids) {
    const req = requestsById.get(id);
    if (req && req.status === 'pending') out.push(req);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export function getPendingFromSender(fromWallet: string): FightRequest[] {
  const ids = pendingBySender.get(fromWallet);
  if (!ids) return [];
  const out: FightRequest[] = [];
  for (const id of ids) {
    const req = requestsById.get(id);
    if (req && req.status === 'pending') out.push(req);
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

function findDuplicatePendingForPair(from: string, to: string): boolean {
  const ids = pendingBySender.get(from);
  if (!ids) return false;
  for (const id of ids) {
    const req = requestsById.get(id);
    if (req && req.status === 'pending' &&
        req.toWallet.toLowerCase() === to.toLowerCase()) {
      return true;
    }
  }
  return false;
}

export interface CreateResult {
  request?: FightRequest;
  error?: CreateRejection['reason'];
}

export function createRequest(input: CreateInput): CreateResult {
  const fromWallet = input.fromWallet.toLowerCase();
  const toWallet = input.toWallet.toLowerCase();
  const ctx: CreateContext = {
    pendingFromSenderCount: getPendingFromSender(fromWallet).length,
    hasDuplicatePendingForPair: findDuplicatePendingForPair(fromWallet, toWallet),
  };
  const decision = evaluateCreate({ ...input, fromWallet, toWallet }, ctx);
  if (!decision.ok) return { error: decision.reason };

  const fromChar = getCharacterByWallet(fromWallet);
  const toChar = getCharacterByWallet(toWallet);
  const now = Date.now();
  const req: FightRequest = {
    id: uuidv4(),
    requestType: input.requestType,
    fromWallet,
    fromName: fromChar?.name ?? fromWallet.slice(0, 8) + '...',
    toWallet,
    toName: toChar?.name ?? toWallet.slice(0, 8) + '...',
    stakeMist: input.requestType === 'wager' ? input.stakeMist : undefined,
    message: input.message?.slice(0, MESSAGE_MAX),
    status: 'pending',
    expiresAt: now + TTL_MS,
    createdAt: now,
  };
  requestsById.set(req.id, req);
  indexInsert(req);
  void persistRequest(req);
  return { request: req };
}

export interface TransitionResult {
  request?: FightRequest;
  error?: TransitionRejection['reason'];
}

export function transitionRequest(
  id: string,
  action: TransitionAction,
  actor: string | undefined,
  now: number = Date.now(),
): TransitionResult {
  const req = requestsById.get(id);
  const decision = evaluateTransition(req, action, actor, now);
  if (!decision.ok) return { error: decision.reason };
  const next: FightRequest = {
    ...req!,
    status: decision.nextStatus,
    resolvedAt: now,
  };
  requestsById.set(id, next);
  indexRemove(req!);
  void persistRequest(next);
  return { request: next };
}

/**
 * Sweep tick. Called every 10s from a server interval. Marks pending
 * requests whose TTL has passed as `expired` and notifies via the
 * caller-supplied `onExpired` callback (used to fan out a WS message
 * to both sides).
 */
export function sweepExpired(
  onExpired: (req: FightRequest) => void,
  now: number = Date.now(),
): number {
  let count = 0;
  for (const req of requestsById.values()) {
    if (req.status === 'pending' && now > req.expiresAt) {
      const result = transitionRequest(req.id, 'expire', undefined, now);
      if (result.request) {
        onExpired(result.request);
        count++;
      }
    }
  }
  return count;
}

// ─── durability layer ─────────────────────────────────────────────────

async function persistRequest(req: FightRequest): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { error } = await sb
    .from('fight_requests')
    .upsert(
      {
        id: req.id,
        request_type: req.requestType,
        from_wallet: req.fromWallet,
        from_name: req.fromName,
        to_wallet: req.toWallet,
        to_name: req.toName,
        stake_mist: req.stakeMist ?? null,
        status: req.status,
        message: req.message ?? null,
        expires_at: new Date(req.expiresAt).toISOString(),
        resolved_at: req.resolvedAt ? new Date(req.resolvedAt).toISOString() : null,
        created_at: new Date(req.createdAt).toISOString(),
      },
      { onConflict: 'id' },
    );
  if (error) {
    console.error('[FightRequests] Supabase upsert failed:', error.message);
  }
}

/**
 * Boot-time rehydrate. Loads every pending request, drops anything past
 * its TTL, returns the live ones for the caller to reinstate into the
 * in-memory store.
 */
export async function rehydratePendingFromDb(now: number = Date.now()): Promise<FightRequest[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('fight_requests')
    .select('*')
    .eq('status', 'pending');
  if (error) {
    console.error('[FightRequests] Supabase rehydrate failed:', error.message);
    return [];
  }
  const live: FightRequest[] = [];
  for (const row of (data as Record<string, unknown>[]) ?? []) {
    const expiresAt = new Date(String(row.expires_at)).getTime();
    if (now > expiresAt) {
      // Mark expired in DB so we don't re-pick it next time.
      await sb
        .from('fight_requests')
        .update({ status: 'expired', resolved_at: new Date(now).toISOString() })
        .eq('id', row.id);
      continue;
    }
    const req: FightRequest = {
      id: String(row.id),
      requestType: (row.request_type === 'wager' ? 'wager' : 'friendly'),
      fromWallet: String(row.from_wallet),
      fromName: String(row.from_name),
      toWallet: String(row.to_wallet),
      toName: String(row.to_name),
      stakeMist: row.stake_mist ? String(row.stake_mist) : undefined,
      message: row.message ? String(row.message) : undefined,
      status: 'pending',
      expiresAt,
      resolvedAt: undefined,
      createdAt: new Date(String(row.created_at)).getTime(),
    };
    requestsById.set(req.id, req);
    indexInsert(req);
    live.push(req);
  }
  return live;
}

// ─── test surface ─────────────────────────────────────────────────────

export function _testReset(): void {
  requestsById.clear();
  pendingByTarget.clear();
  pendingBySender.clear();
}

export function _testSnapshot(): FightRequest[] {
  return Array.from(requestsById.values());
}
