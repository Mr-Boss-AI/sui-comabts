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

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const backoffMs = [1000, 3000, 9000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < backoffMs.length; attempt++) {
    try {
      const result = await fn();
      if (attempt > 0) console.log(`[${label}] retry attempt ${attempt + 1} succeeded`);
      return result;
    } catch (err) {
      lastErr = err;
      const msg = (err as Error)?.message || String(err);
      console.warn(`[${label}] attempt ${attempt + 1} failed: ${msg}`);
      if (attempt < backoffMs.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs[attempt]));
      }
    }
  }
  console.error(`[${label}] retry exhausted after ${backoffMs.length} attempts`);
  throw lastErr;
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
  return withRetry(label, async () => {
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
  });
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
