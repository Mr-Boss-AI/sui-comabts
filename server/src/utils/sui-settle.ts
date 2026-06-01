import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { CONFIG } from '../config';

// =============================================================================
// SDK SETUP
// =============================================================================

const network = (CONFIG.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const client = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

let cachedKeypair: Ed25519Keypair | null = null;
function treasury(): Ed25519Keypair {
  if (cachedKeypair) return cachedKeypair;
  const raw = CONFIG.SUI_TREASURY_PRIVATE_KEY;
  if (!raw) throw new Error('SUI_TREASURY_PRIVATE_KEY env var is not set');
  const { scheme, secretKey } = decodeSuiPrivateKey(raw);
  if (scheme !== 'ED25519') {
    throw new Error(`Expected ED25519 keypair, got ${scheme}`);
  }
  cachedKeypair = Ed25519Keypair.fromSecretKey(secretKey);
  const expected = CONFIG.PLATFORM_TREASURY.toLowerCase();
  const actual = cachedKeypair.toSuiAddress().toLowerCase();
  if (expected && actual !== expected) {
    throw new Error(
      `SUI_TREASURY_PRIVATE_KEY derives ${actual}, expected ${expected}. ` +
      `Either fix the key or remove PLATFORM_TREASURY from .env to skip the check.`,
    );
  }
  return cachedKeypair;
}

const PKG = () => CONFIG.SUI_PACKAGE_ID;
const ADMIN_CAP = () => CONFIG.ADMIN_CAP_ID;
const CLOCK = '0x6';

// =============================================================================
// RETRY HELPER
// =============================================================================

/**
 * Exponential-backoff retry. `backoffMs` is the array of delays BETWEEN
 * attempts, so total attempts = `backoffMs.length + 1`. Default
 * `[1000, 3000]` = 3 attempts with sleeps of 1s + 3s (preserving the
 * production retry budget used since v5 redeploy).
 *
 * Used for transient RPC blips and on-chain retryable aborts (gas-coin
 * lock, mempool pressure). Re-exported as `withChainRetry` so other
 * modules inherit the same contract without re-implementing it.
 *
 * Specific call sites widen the retry budget via the parameter — e.g. the
 * marketplace gap-fill loop (Block C2) uses `[1000, 3000, 9000, 27000]`
 * for 5 total attempts.
 */
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  backoffMs: readonly number[] = [1000, 3000],
): Promise<T> {
  const totalAttempts = backoffMs.length + 1;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) console.log(`[${label}] retry attempt ${attempt + 1} succeeded`);
      return result;
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message || String(err);
      console.warn(`[${label}] attempt ${attempt + 1}/${totalAttempts} failed: ${msg}`);
      if (attempt < backoffMs.length) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
      }
    }
  }
  console.error(`[${label}] retry exhausted after ${totalAttempts} attempts`);
  throw lastErr;
}

export const withChainRetry = withRetry;

// =============================================================================
// TREASURY TRANSACTION QUEUE
// =============================================================================
//
// All admin operations (settle_wager, admin_cancel_wager, update_after_fight,
// set_fight_lock) sign with the same TREASURY keypair and therefore compete
// for the same gas coin. With no serialization, two concurrent calls pick the
// same gas coin off the wallet, the second tx hits EX_OBJECT_LOCKED on chain,
// and `withRetry` may not save it because the coin stays locked until the
// first tx finalises. Under tournament load (multiple fights ending within
// seconds) this corrupts settlement.
//
// The fix is a FIFO queue with bounded concurrency. Default = 1 (true serial,
// guaranteed lock-free). Set TREASURY_QUEUE_CONCURRENCY env to scale to N when
// we eventually pre-split the treasury into a sponsor coin pool — but until
// then, sequential is the safe default.
//
// Implementation: hand-rolled, no dependency. ~30 LOC. The queue holds tasks
// (label + thunk + deferred resolve/reject). A drain loop pops + runs them
// up to `concurrency` at a time. Observability: depth + last drain latency
// exposed via `getTreasuryQueueStats()` for /health.

interface TreasuryTask<T = unknown> {
  label: string;
  thunk: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
  enqueuedAt: number;
}

const TREASURY_QUEUE_CONCURRENCY = (() => {
  const raw = Number(process.env.TREASURY_QUEUE_CONCURRENCY ?? '1');
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.floor(raw);
})();

const taskQueue: TreasuryTask[] = [];
let inFlight = 0;
let totalCompleted = 0;
let lastDrainMs = 0;
let maxObservedDepth = 0;

function pumpTreasuryQueue(): void {
  while (inFlight < TREASURY_QUEUE_CONCURRENCY && taskQueue.length > 0) {
    const task = taskQueue.shift()!;
    inFlight++;
    const startedAt = Date.now();
    void task.thunk()
      .then((value) => task.resolve(value))
      .catch((err) => task.reject(err))
      .finally(() => {
        lastDrainMs = Date.now() - startedAt;
        totalCompleted++;
        inFlight--;
        pumpTreasuryQueue();
      });
  }
}

function enqueueTreasury<T>(label: string, thunk: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const task: TreasuryTask<T> = {
      label,
      thunk,
      resolve,
      reject,
      enqueuedAt: Date.now(),
    };
    taskQueue.push(task as TreasuryTask);
    if (taskQueue.length + inFlight > maxObservedDepth) {
      maxObservedDepth = taskQueue.length + inFlight;
    }
    pumpTreasuryQueue();
  });
}

export function getTreasuryQueueStats(): {
  concurrency: number;
  inFlight: number;
  queued: number;
  totalCompleted: number;
  lastDrainMs: number;
  maxObservedDepth: number;
} {
  return {
    concurrency: TREASURY_QUEUE_CONCURRENCY,
    inFlight,
    queued: taskQueue.length,
    totalCompleted,
    lastDrainMs,
    maxObservedDepth,
  };
}

// =============================================================================
// EVENT PARSING — extract fresh on-chain state from tx effects so server cache
// can mirror chain truth instead of recomputing levels locally.
// =============================================================================

export interface FightResultEffects {
  digest: string;
  newLevel: number;          // from LevelUp event (or 0 if no level-up)
  newXp: number;             // from FightResultUpdated event
  newUnallocatedPoints: number; // from LevelUp event (or unchanged if none)
  newRating: number;
  newWins: number;
  newLosses: number;
  leveledUp: boolean;
  levelsGained: number;
}

interface SuiEvent {
  type: string;
  parsedJson?: Record<string, unknown>;
}

function findEventByType(events: SuiEvent[], typeSuffix: string): SuiEvent | null {
  for (const ev of events) {
    if (ev.type.endsWith(typeSuffix)) return ev;
  }
  return null;
}

function findAllEventsByType(events: SuiEvent[], typeSuffix: string): SuiEvent[] {
  return events.filter((ev) => ev.type.endsWith(typeSuffix));
}

function parseFightResultEffects(digest: string, events: SuiEvent[]): FightResultEffects {
  const fightResult = findEventByType(events, '::character::FightResultUpdated');
  const levelUps = findAllEventsByType(events, '::character::LevelUp');
  const lastLevelUp = levelUps.length > 0 ? levelUps[levelUps.length - 1] : null;

  if (!fightResult?.parsedJson) {
    throw new Error('FightResultUpdated event missing in update_after_fight tx');
  }
  const fr = fightResult.parsedJson as Record<string, string | number | boolean>;

  const lu = lastLevelUp?.parsedJson as Record<string, string | number> | undefined;

  return {
    digest,
    newLevel: lu ? Number(lu.new_level) : 0,
    newXp: Number(fr.new_xp),
    newUnallocatedPoints: lu ? Number(lu.unallocated_points) : 0,
    newRating: Number(fr.new_rating),
    newWins: Number(fr.new_wins),
    newLosses: Number(fr.new_losses),
    leveledUp: levelUps.length > 0,
    levelsGained: levelUps.length,
  };
}

// =============================================================================
// SHARED OBJECT REFERENCE LOOKUP — needed because Sui requires the initialSharedVersion
// of every shared object referenced by a tx. The SDK accepts `tx.object(id)` which
// auto-resolves the right form, but for clarity we use it explicitly.
// =============================================================================

async function execAsTreasury(
  label: string,
  buildTx: (tx: Transaction) => void,
  gasBudget: number = 50_000_000,
): Promise<{ digest: string; events: SuiEvent[] }> {
  // Route every admin tx through the FIFO queue so two callers never race
  // for the same gas coin. `withRetry` runs INSIDE the queued slot — a
  // failing attempt holds its slot until exhaustion, which is what we want
  // (drain failures before the next tx, no overlapping retries).
  return enqueueTreasury(label, () =>
    withRetry(label, async () => {
      const tx = new Transaction();
      buildTx(tx);
      tx.setGasBudget(gasBudget);

      const result = await client.signAndExecuteTransaction({
        signer: treasury(),
        transaction: tx,
        options: { showEffects: true, showEvents: true },
      });

      if (result.effects?.status?.status !== 'success') {
        const err = result.effects?.status?.error || 'unknown failure';
        throw new Error(`Tx ${result.digest} failed: ${err}`);
      }

      // v5.2.1 (2026-06-01 hotfix) — finality-wait inside the queue slot.
      // Without this, the next queued task can read a stale view of the
      // treasury gas coin from the load-balanced fullnode and fail with
      // "object 0x75914b66… version 0x… is unavailable for consumption,
      // current version: 0x…". Live draw-settlement incident triggered
      // this on settle_tie / updateAfterFightDraw / setFightLock back-to-back.
      // Atomic PTBs (see settleDrawBundleOnChain) close the intra-bundle
      // race; this closes the inter-bundle race for the rest of the
      // treasury queue (fight-start lock acquisition, win/loss settlement,
      // any other admin op).
      try {
        await client.waitForTransaction({
          digest: result.digest,
          timeout: 5_000,
          pollInterval: 200,
        });
      } catch (waitErr) {
        // Timeout / RPC blip: tx already succeeded (we checked status above),
        // so just log and move on. The next queued task MAY hit the version
        // race in this rare path, in which case its own withRetry budget
        // covers it. Don't throw — would surface a benign post-success
        // delay as a hard failure.
        console.warn(
          `[${label}] post-tx finality wait timed out for ${result.digest}: ${(waitErr as Error)?.message || waitErr}`,
        );
      }

      return {
        digest: result.digest,
        events: (result.events ?? []) as SuiEvent[],
      };
    }),
  );
}

// =============================================================================
// PUBLIC API — server-callable on-chain operations
// =============================================================================

/**
 * settle_wager (TREASURY-only). 95% to winner, 5% to TREASURY.
 * v5 takes an extra `clock` arg used for `settled_at`.
 * v5.1 — threads OpenWagerRegistry as &mut between winner and clock so the
 * creator's registry entry clears on completion. Backward-compat fallback for
 * v5.0 env (no registry) preserved during the cutover window.
 */
export async function settleWagerOnChain(
  wagerMatchId: string,
  winnerAddress: string,
): Promise<{ digest: string }> {
  console.log(`[Wager] Settling ${wagerMatchId} → winner: ${winnerAddress}`);
  const { digest } = await execAsTreasury('Wager.settle', (tx) => {
    const args: any[] = [
      tx.object(wagerMatchId),
      tx.pure.address(winnerAddress),
    ];
    if (CONFIG.OPEN_WAGER_REGISTRY_ID) {
      args.push(tx.object(CONFIG.OPEN_WAGER_REGISTRY_ID));
    }
    args.push(tx.object(CLOCK));
    tx.moveCall({
      target: `${PKG()}::arena::settle_wager`,
      arguments: args,
    });
  });
  console.log(`[Wager] Settled. Tx: ${digest}`);
  return { digest };
}

/**
 * admin_cancel_wager (TREASURY-only). WAITING refunds player_a; ACTIVE 50/50.
 */
export async function adminCancelWagerOnChain(
  wagerMatchId: string,
): Promise<{ digest: string }> {
  console.log(`[Wager] Admin-cancelling ${wagerMatchId}`);
  const { digest } = await execAsTreasury('Wager.adminCancel', (tx) => {
    const args: any[] = [tx.object(wagerMatchId)];
    // v5.1 — registry arg comes BEFORE clock in admin_cancel_wager.
    // On v5.0 (no registry env), call with the v5.0 signature.
    if (CONFIG.OPEN_WAGER_REGISTRY_ID) {
      args.push(tx.object(CONFIG.OPEN_WAGER_REGISTRY_ID));
    }
    args.push(tx.object(CLOCK));
    tx.moveCall({
      target: `${PKG()}::arena::admin_cancel_wager`,
      arguments: args,
    });
  });
  console.log(`[Wager] Admin-cancelled. Tx: ${digest}`);
  return { digest };
}

/**
 * v5.1 — TREASURY-only mutual-KO settlement. 100% refund to each player, no
 * platform fee. Emits `WagerTied` (vs `WagerRefunded` for admin-cancel-ACTIVE).
 *
 * Routes:
 *   - If `OPEN_WAGER_REGISTRY_ID` is set (v5.1 env) → calls `settle_tie`.
 *   - Else (v5.0 env) → falls back to `admin_cancel_wager`. Behaviour is
 *     functionally identical for ACTIVE wagers (admin_cancel splits 50/50 of
 *     a 2× stake escrow = stake each, same as settle_tie). Only the event
 *     type and the absence of platform_fee differ, neither of which affects
 *     player balances. The v5.0 fallback keeps the testnet safety net alive
 *     during the cutover window.
 */
export async function settleTieOnChain(
  wagerMatchId: string,
): Promise<{ digest: string }> {
  if (!CONFIG.OPEN_WAGER_REGISTRY_ID) {
    console.log(
      `[Wager] settle_tie — registry env unset, falling back to admin_cancel_wager for ${wagerMatchId}`,
    );
    return adminCancelWagerOnChain(wagerMatchId);
  }
  console.log(`[Wager] Settle-tie ${wagerMatchId}`);
  const { digest } = await execAsTreasury('Wager.settleTie', (tx) => {
    tx.moveCall({
      target: `${PKG()}::arena::settle_tie`,
      arguments: [
        tx.object(wagerMatchId),
        tx.object(CONFIG.OPEN_WAGER_REGISTRY_ID),
        tx.object(CLOCK),
      ],
    });
  });
  console.log(`[Wager] Settle-tie complete. Tx: ${digest}`);
  return { digest };
}

/**
 * v5.1 — Persist draw outcome to the Character NFT. Increments `draws`,
 * applies XP, no rating change. Falls back to legacy `update_after_fight`
 * with `won=false` when running against a v5.0 package (where the field
 * doesn't exist). On v5.0 this means draws are recorded as losses on chain,
 * which is the existing behaviour — acceptable until v5.1 cutover.
 */
export async function updateCharacterDrawOnChain(
  characterObjectId: string,
  xpGained: number,
): Promise<{ digest: string }> {
  const isV51 = !!CONFIG.CHARACTER_REGISTRY_ID; // proxy signal for v5.1 env
  if (!isV51) {
    console.log(
      `[Character] update_after_fight_draw — v5.1 env unset, falling back to update_after_fight(won=false) for ${characterObjectId}`,
    );
    // Cap xpGained to MAX_XP_PER_FIGHT (1000) — chain enforces it too.
    const cappedXp = Math.min(xpGained, 1000);
    await updateCharacterOnChain(characterObjectId, false, cappedXp, 0);
    return { digest: '(v5.0-fallback)' };
  }
  console.log(`[Character] Update-draw on-chain: ${characterObjectId} (xp=${xpGained})`);
  const { digest } = await execAsTreasury('Character.updateAfterFightDraw', (tx) => {
    tx.moveCall({
      target: `${PKG()}::character::update_after_fight_draw`,
      arguments: [
        tx.object(CONFIG.ADMIN_CAP_ID),
        tx.object(characterObjectId),
        tx.pure.u64(xpGained),
        tx.object(CLOCK),
      ],
    });
  });
  console.log(`[Character] Update-draw complete. Tx: ${digest}`);
  return { digest };
}

/**
 * v5.2.1 (2026-06-01) — Atomic draw settlement.
 *
 * Bundles into a single PTB:
 *   (if wager)  arena::settle_tie         — 100% refund both sides
 *   character::update_after_fight_draw(A) — ticks draws, applies XP
 *   character::set_fight_lock(A, 0)       — releases the fight-lock
 *   character::update_after_fight_draw(B) — same for B
 *   character::set_fight_lock(B, 0)       — same for B
 *
 * Why a PTB instead of 5 sequential queued txs (the v5.1 pattern):
 *  - Sui executes every command inside a PTB against a single, locked
 *    set of input object versions. The intra-bundle gas-coin /
 *    Character / WagerMatch version race that hit live testnet on
 *    2026-06-01 (logs: "object 0x75914b66… version 0x… is unavailable
 *    for consumption") is structurally impossible — there is no
 *    between-tx window.
 *  - All-or-nothing semantics: if any sub-call aborts (e.g.
 *    EMatchNotActive because an admin_cancel ran first), the entire
 *    bundle rolls back. Retries then re-attempt from a clean slate
 *    instead of a half-applied state where draws ticked but lock
 *    never cleared.
 *  - One Tx digest, one set of effects, one wager_settled message to
 *    the frontend — simpler client + log triage.
 *
 * Returns the parsed per-character effects so the server cache can
 * mirror chain truth (xp, draws, level, unallocated_points) exactly
 * like the win/loss path does via update_after_fight's
 * FightResultUpdated event. Without this, Hall of Fame keeps showing
 * D=0 until the next character restore.
 *
 * Caller responsibilities:
 *  - Pre-validate xp values are <= MAX_XP_PER_FIGHT (1000) — the
 *    Move side asserts this, so an over-cap value aborts the bundle.
 *  - Pass `wagerMatchId = undefined` for ranked/casual draws so
 *    settle_tie is skipped entirely.
 *  - Pass `charA`/`charB` as undefined when the wallet hasn't minted
 *    on-chain (server-only test sessions) — those sub-calls are
 *    skipped. If BOTH are undefined and there's no wager, the call
 *    throws ENoBundleWork because the caller is asking for an
 *    empty PTB.
 */
export interface DrawCharacterEffects {
  newXp: number;
  newDraws: number;
  leveledUp: boolean;
  newLevel: number;             // 0 when no level-up fired
  newUnallocatedPoints: number; // 0 when no level-up fired
}

export interface DrawBundleEffects {
  digest: string;
  /** Effects for charA — undefined when charA was skipped (no onChainObjectId). */
  charA?: DrawCharacterEffects;
  charB?: DrawCharacterEffects;
}

function parseDrawEffectsForCharacter(
  events: SuiEvent[],
  characterId: string,
): DrawCharacterEffects | null {
  const drawRecorded = events.find(
    (ev) =>
      ev.type.endsWith('::character::DrawRecorded') &&
      (ev.parsedJson as Record<string, unknown> | undefined)?.character_id === characterId,
  );
  if (!drawRecorded?.parsedJson) return null;
  const dr = drawRecorded.parsedJson as Record<string, string | number>;

  // LevelUps are emitted in order; the LAST LevelUp for this character is
  // authoritative for the post-bundle level / unallocated points. A draw
  // can cross at most one level threshold (10% XP), but the parser is
  // defensive and picks the last.
  const levelUps = events.filter(
    (ev) =>
      ev.type.endsWith('::character::LevelUp') &&
      (ev.parsedJson as Record<string, unknown> | undefined)?.character_id === characterId,
  );
  const lastLevelUp =
    levelUps.length > 0 ? (levelUps[levelUps.length - 1].parsedJson as Record<string, string | number> | undefined) : undefined;

  return {
    newXp: Number(dr.new_xp),
    newDraws: Number(dr.new_draws),
    leveledUp: levelUps.length > 0,
    newLevel: lastLevelUp ? Number(lastLevelUp.new_level) : 0,
    newUnallocatedPoints: lastLevelUp ? Number(lastLevelUp.unallocated_points) : 0,
  };
}

export async function settleDrawBundleOnChain(opts: {
  charA?: { id: string; xp: number };
  charB?: { id: string; xp: number };
  wagerMatchId?: string;
}): Promise<DrawBundleEffects> {
  const { charA, charB, wagerMatchId } = opts;

  if (!charA && !charB && !wagerMatchId) {
    throw new Error(
      '[Draw.bundle] ENoBundleWork — at least one of charA, charB, wagerMatchId is required',
    );
  }

  // v5.0 fallback — if running against an env without OPEN_WAGER_REGISTRY_ID
  // we can't call settle_tie (it requires the v5.1+ registry). Fall back to
  // the legacy split: admin_cancel_wager for the escrow + per-character
  // update_after_fight(won=false) calls. This branch shouldn't fire in v5.2
  // testnet (registry is set in deployment.testnet-v5.2.json) but keeps
  // the function safe to call from any env.
  const haveRegistry = !!CONFIG.OPEN_WAGER_REGISTRY_ID;
  if (wagerMatchId && !haveRegistry) {
    console.log(
      '[Draw.bundle] OPEN_WAGER_REGISTRY_ID unset — falling back to split admin_cancel + legacy character updates',
    );
    await adminCancelWagerOnChain(wagerMatchId);
    // No DrawRecorded events on the v5.0 path; report empty effects so
    // the caller's cache-mirror branch becomes a no-op (server keeps its
    // optimistic local applyXp/draws values, which is the v5.0 behaviour).
    return { digest: '(v5.0-fallback)' };
  }

  const label = wagerMatchId ? 'Draw.bundle.wager' : 'Draw.bundle.ranked';
  // Five sub-calls + storage costs. 0.2 SUI is comfortably above the
  // observed budget for a 4-call admin PTB on testnet (~0.04 SUI), with
  // headroom for a level-up across both characters.
  const gasBudget = 200_000_000;

  const { digest, events } = await execAsTreasury(
    label,
    (tx) => {
      if (wagerMatchId) {
        tx.moveCall({
          target: `${PKG()}::arena::settle_tie`,
          arguments: [
            tx.object(wagerMatchId),
            tx.object(CONFIG.OPEN_WAGER_REGISTRY_ID),
            tx.object(CLOCK),
          ],
        });
      }
      if (charA) {
        tx.moveCall({
          target: `${PKG()}::character::update_after_fight_draw`,
          arguments: [
            tx.object(ADMIN_CAP()),
            tx.object(charA.id),
            tx.pure.u64(charA.xp),
            tx.object(CLOCK),
          ],
        });
        tx.moveCall({
          target: `${PKG()}::character::set_fight_lock`,
          arguments: [
            tx.object(ADMIN_CAP()),
            tx.object(charA.id),
            tx.pure.u64(0),
            tx.object(CLOCK),
          ],
        });
      }
      if (charB) {
        tx.moveCall({
          target: `${PKG()}::character::update_after_fight_draw`,
          arguments: [
            tx.object(ADMIN_CAP()),
            tx.object(charB.id),
            tx.pure.u64(charB.xp),
            tx.object(CLOCK),
          ],
        });
        tx.moveCall({
          target: `${PKG()}::character::set_fight_lock`,
          arguments: [
            tx.object(ADMIN_CAP()),
            tx.object(charB.id),
            tx.pure.u64(0),
            tx.object(CLOCK),
          ],
        });
      }
    },
    gasBudget,
  );

  const result: DrawBundleEffects = { digest };
  if (charA) {
    const e = parseDrawEffectsForCharacter(events, charA.id);
    if (e) result.charA = e;
  }
  if (charB) {
    const e = parseDrawEffectsForCharacter(events, charB.id);
    if (e) result.charB = e;
  }
  console.log(
    `[Draw.bundle] Settled. Tx: ${digest}` +
      (result.charA ? `, A: draws=${result.charA.newDraws} xp=${result.charA.newXp}` : '') +
      (result.charB ? `, B: draws=${result.charB.newDraws} xp=${result.charB.newXp}` : ''),
  );
  return result;
}

/**
 * update_after_fight (AdminCap-gated). Persists fight result to the Character NFT.
 * Returns the fresh on-chain state parsed from emitted events so the server cache
 * can mirror chain truth instead of recomputing locally.
 */
export async function updateCharacterOnChain(
  characterObjectId: string,
  won: boolean,
  xpGained: number,
  newRating: number,
): Promise<FightResultEffects> {
  console.log(
    `[Character] Updating on-chain: ${characterObjectId} (won=${won}, xp=${xpGained}, rating=${newRating})`,
  );
  const { digest, events } = await execAsTreasury('Character.updateAfterFight', (tx) => {
    tx.moveCall({
      target: `${PKG()}::character::update_after_fight`,
      arguments: [
        tx.object(ADMIN_CAP()),
        tx.object(characterObjectId),
        tx.pure.bool(won),
        tx.pure.u64(xpGained),
        tx.pure.u16(newRating),
        tx.object(CLOCK),
      ],
    });
  });
  const effects = parseFightResultEffects(digest, events);
  console.log(
    `[Character] Updated. Tx: ${digest}, ` +
    `xp=${effects.newXp}, level=${effects.newLevel}, ` +
    `unalloc=${effects.newUnallocatedPoints}, leveledUp=${effects.leveledUp}`,
  );
  return effects;
}

/**
 * set_fight_lock (AdminCap-gated). Bounded by chain MAX_LOCK_MS = 1 hour.
 * Pass `expiresAtMs = 0` to clear the lock immediately.
 */
export async function setFightLockOnChain(
  characterObjectId: string,
  expiresAtMs: number,
): Promise<{ digest: string }> {
  console.log(
    `[FightLock] ${expiresAtMs === 0 ? 'Clearing' : 'Setting'} lock on ${characterObjectId} (expires=${expiresAtMs})`,
  );
  const { digest } = await execAsTreasury('Character.setFightLock', (tx) => {
    tx.moveCall({
      target: `${PKG()}::character::set_fight_lock`,
      arguments: [
        tx.object(ADMIN_CAP()),
        tx.object(characterObjectId),
        tx.pure.u64(expiresAtMs),
        tx.object(CLOCK),
      ],
    });
  }, 30_000_000);
  console.log(`[FightLock] Tx: ${digest}`);
  return { digest };
}

// =============================================================================
// READ-ONLY QUERIES (no signing)
// =============================================================================

/**
 * Decide whether a `create_character` WS message should be rejected because
 * the wallet already has one or more Characters on chain. Threshold: > 1.
 * Length === 1 is the just-minted Character for this attempt — the WS
 * message arrives AFTER `signAndExecuteTransaction` resolves on the
 * frontend, so the new event is on chain by the time we read it. Length > 1
 * means a pre-existing Character was already on chain when the user clicked
 * Create — exactly the auth-flicker scenario (STATUS_v5.md 2026-04-30).
 *
 * Pure function so `qa-character-mint.ts` can pin the contract.
 */
export function shouldRejectDuplicateMint(
  onChainIds: readonly string[],
): { reject: boolean; original?: string; count: number } {
  if (onChainIds.length > 1) {
    return { reject: true, original: onChainIds[0], count: onChainIds.length };
  }
  return { reject: false, count: onChainIds.length };
}

/**
 * Return EVERY Character object id this wallet has minted on chain, ordered
 * oldest-first. Used by `handleCreateCharacter` (layer 2 of the duplicate-mint
 * fix from STATUS_v5.md 2026-04-30): if the wallet already has one or more
 * pre-existing Characters AND a fresh `create_character` WS message arrives,
 * that's a UI bypass — the frontend's auth-phase state machine should have
 * routed the user through `restore_character` instead. Reject the WS message
 * before the server records a duplicate.
 *
 * Returns `[]` on RPC failure so the caller can choose a fail-open or
 * fail-closed policy (we fail open in handleCreateCharacter to avoid blocking
 * legitimate first-time mints during a transient RPC blip — layer 1 closes
 * the bug regardless).
 */
export async function findAllCharacterIdsForWallet(walletAddress: string): Promise<string[]> {
  try {
    // Ascending order so the oldest event lands first — handleCreateCharacter
    // surfaces that id in its rejection message so the user can recover by
    // refreshing instead of re-minting.
    const events = await client.queryEvents({
      query: { MoveEventType: `${PKG()}::character::CharacterCreated` },
      limit: 100,
      order: 'ascending',
    });
    const ids: string[] = [];
    for (const event of events.data) {
      const parsed = event.parsedJson as Record<string, unknown> | undefined;
      if (parsed?.owner === walletAddress && typeof parsed.character_id === 'string') {
        ids.push(String(parsed.character_id));
      }
    }
    return ids;
  } catch (err) {
    console.error('[findAllCharacterIdsForWallet] RPC error:', (err as Error)?.message || err);
    return [];
  }
}

/**
 * Find a Character object ID owned by `walletAddress` via CharacterCreated events.
 */
export async function findCharacterObjectId(walletAddress: string): Promise<string | null> {
  try {
    const events = await client.queryEvents({
      query: { MoveEventType: `${PKG()}::character::CharacterCreated` },
      limit: 50,
      order: 'descending',
    });
    for (const event of events.data) {
      const parsed = event.parsedJson as Record<string, unknown> | undefined;
      if (parsed?.owner === walletAddress) {
        return String(parsed.character_id);
      }
    }
    return null;
  } catch (err) {
    console.error('[findCharacterObjectId] RPC error:', (err as Error)?.message || err);
    return null;
  }
}

/**
 * Read a WagerMatch's status field. 0=waiting, 1=active, 2=settled,
 * 3=pending_approval (v5.2). null on failure.
 */
export async function getWagerStatus(wagerMatchId: string): Promise<number | null> {
  try {
    const obj = await client.getObject({
      id: wagerMatchId,
      options: { showContent: true },
    });
    const fields = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
    if (!fields) return null;
    return Number(fields.status);
  } catch (err) {
    console.error('[getWagerStatus] RPC error:', (err as Error)?.message || err);
    return null;
  }
}

/**
 * v5.2 — Read `WagerMatch.accepted_at` (ms unix timestamp). Returns null
 * on RPC failure or if the field is missing/zero. Used at fight-start
 * time to anchor the 30-min reclaim_stalled_wager timer to the actual
 * chain accept moment — not the server's "fight started" moment, which
 * could be seconds later (probe + WS routing latency).
 *
 * accept-at-zero is treated as null because the chain initialises this
 * field to 0 in STATUS_WAITING; only the approve_challenger transition
 * stamps a real timestamp.
 */
export async function getWagerAcceptedAt(wagerMatchId: string): Promise<number | null> {
  try {
    const obj = await client.getObject({
      id: wagerMatchId,
      options: { showContent: true },
    });
    const fields = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
    if (!fields) return null;
    const raw = Number(fields.accepted_at);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return raw;
  } catch (err) {
    console.error('[getWagerAcceptedAt] RPC error:', (err as Error)?.message || err);
    return null;
  }
}

/**
 * Tx-digest-driven finality wait (2026-05-28, option c2). Before
 * `handleWagerAccepted` probes `WagerMatch.status` on chain, wait for the
 * caller's accept_wager tx to finalize via the same fullnode the probe uses.
 * Closes the 2026-05-27/28 finality race where the probe ran ahead of the
 * fullnode's propagation and read pre-finality WAITING.
 *
 * `waitForTransaction` polls `getTransactionBlock` with a short interval
 * until the tx returns OR the timeout fires. On timeout we fall through
 * to the caller — graceful degradation matches today's reject behaviour.
 *
 * Three outcomes:
 *   - `success` → tx landed with `effects.status === "success"`; wager is
 *                 guaranteed to reflect ACTIVE on this fullnode.
 *   - `failure` → tx landed but the Move call aborted; abort error string
 *                 is propagated to the caller.
 *   - `timeout` → fullnode didn't see the tx within the budget; caller
 *                 falls through to the legacy `getWagerStatus` probe.
 */
export type TxFinalityOutcome =
  | { kind: 'success'; digest: string }
  | { kind: 'failure'; digest: string; error: string }
  | { kind: 'timeout'; digest: string };

export async function waitForWagerTxFinality(
  digest: string,
  timeoutMs: number = 3000,
): Promise<TxFinalityOutcome> {
  try {
    const tx = await client.waitForTransaction({
      digest,
      options: { showEffects: true },
      timeout: timeoutMs,
      pollInterval: 200,
    });
    const status = tx.effects?.status;
    if (status?.status === 'success') return { kind: 'success', digest };
    return {
      kind: 'failure',
      digest,
      error: status?.error ?? 'unknown chain failure',
    };
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    if (
      msg.toLowerCase().includes('timeout') ||
      msg.toLowerCase().includes('aborted')
    ) {
      return { kind: 'timeout', digest };
    }
    // Unexpected RPC error — treat as timeout so the caller falls through
    // to the legacy probe rather than failing outright.
    console.warn('[waitForWagerTxFinality] non-timeout error:', msg);
    return { kind: 'timeout', digest };
  }
}

/**
 * Generic SDK-backed object reader. Callers (e.g. /api/admin/adopt-wager)
 * use this instead of raw fetch so they inherit retry-with-backoff and the
 * SDK's connection pooling. Returns the full object response so the caller
 * can read both fields and type.
 */
export async function readObjectWithRetry(
  objectId: string,
  options: { showContent?: boolean; showType?: boolean } = { showContent: true, showType: true },
): Promise<{
  fields: Record<string, unknown> | null;
  type: string | null;
}> {
  return withRetry(`Object.read[${objectId.slice(0, 10)}…]`, async () => {
    const obj = await client.getObject({ id: objectId, options });
    const fields = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields ?? null;
    const type = (obj.data?.type as string | undefined) ?? null;
    return { fields, type };
  });
}
