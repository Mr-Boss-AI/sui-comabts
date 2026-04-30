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
 */
export async function settleWagerOnChain(
  wagerMatchId: string,
  winnerAddress: string,
): Promise<{ digest: string }> {
  console.log(`[Wager] Settling ${wagerMatchId} → winner: ${winnerAddress}`);
  const { digest } = await execAsTreasury('Wager.settle', (tx) => {
    tx.moveCall({
      target: `${PKG()}::arena::settle_wager`,
      arguments: [
        tx.object(wagerMatchId),
        tx.pure.address(winnerAddress),
        tx.object(CLOCK),
      ],
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
    tx.moveCall({
      target: `${PKG()}::arena::admin_cancel_wager`,
      arguments: [tx.object(wagerMatchId), tx.object(CLOCK)],
    });
  });
  console.log(`[Wager] Admin-cancelled. Tx: ${digest}`);
  return { digest };
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
 * Read a WagerMatch's status field. 0=waiting, 1=active, 2=settled. null on failure.
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
