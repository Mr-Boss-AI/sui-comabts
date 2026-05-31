/**
 * Boot-time lobby rehydration from the on-chain OpenWagerRegistry.
 *
 * Incident this addresses (2026-05-31): server restart wipes the in-memory
 * `wagerLobby` map. Any wager that's still WAITING (or PENDING_APPROVAL)
 * on chain becomes invisible in the UI even though the chain registry
 * still pins it. The creator then can't open a new wager
 * (EAlreadyHasOpenWager, 11) and has no card to Cancel from — pure
 * server-vs-chain state drift.
 *
 * Fix shape: at boot, read the OpenWagerRegistry table, enumerate every
 * (creator → wager) entry, read each WagerMatch, and re-populate the
 * in-memory lobby for WAITING + PENDING_APPROVAL states. ACTIVE goes to
 * the existing `wager_in_flight` orphan path (already handled by
 * `sweepOrphanActiveWagers`). SETTLED is impossible in the registry by
 * construction, but if it ever appears we log + skip rather than
 * resurrect it as a lobby card.
 *
 * Character info is best-effort: we try `restoreCharacterFromDb` first
 * (Supabase has the canonical name/stats/rating), and fall back to a
 * minimal placeholder built from chain truth (wallet-prefix name, level
 * from `player_a_level` snapshot, default stats). The placeholder is
 * good enough for the creator to see their own card and cancel it; the
 * next WS auth from that wallet refreshes the entry with real data.
 *
 * Dependency-injected for testability (mirrors orphan-wager-recovery):
 * the production deps wire the real SDK + Supabase + adoptWagerIntoLobby,
 * the gauntlet injects mocks to drive every status branch.
 */

import { CONFIG } from '../config';
import { readObjectWithRetry } from '../utils/sui-settle';
import { restoreCharacterFromDb } from './characters';
import { adoptWagerIntoLobby } from '../ws/handler';
import type { WagerLobbyEntry, PendingChallenger } from '../types';

/**
 * Status constants — mirrored from contracts/sources/arena.move:99-104.
 * Kept inline so this module doesn't need a Move-bridge dep just to know
 * what `0` / `1` / `2` / `3` mean. The qa-arena-aborts gauntlet pins
 * the chain side; this comment + the literal numbers below are the
 * server-side anchor.
 */
const STATUS_WAITING = 0;
const STATUS_ACTIVE = 1;
const STATUS_SETTLED = 2;
const STATUS_PENDING_APPROVAL = 3;

/** Output shape for the boot log + the gauntlet's assertions. */
export interface RehydrateResult {
  /** Entries discovered in the on-chain registry table. */
  registryEntries: number;
  /** Lobby entries actually inserted (WAITING + PENDING_APPROVAL). */
  adopted: number;
  /** ACTIVE entries — skipped (handled by orphan-wager-recovery). */
  skippedActive: number;
  /** SETTLED entries — defensive; should never appear in the registry. */
  skippedSettled: number;
  /** Errors: chain read failures, unknown statuses, adoption rejections. */
  errors: number;
}

/**
 * Minimal shape returned by the registry-entries reader. Decouples this
 * module from the SDK so the gauntlet can produce these tuples directly.
 */
export interface RegistryEntry {
  creatorWallet: string;
  wagerMatchId: string;
}

/** Per-wager chain truth needed to build a lobby entry. */
export interface ChainWagerFields {
  status: number;
  player_a: string;
  player_a_level: number;
  stake_amount: number;
  created_at: number;
  pending_challenger: string | null;
  pending_at: number;
  challenger_escrow: number;
}

/** Character-side facts the lobby entry wants. Subset of `Character`. */
export interface CharacterFacts {
  id: string;
  name: string;
  level: number;
  rating: number;
  stats: {
    strength: number;
    dexterity: number;
    intuition: number;
    endurance: number;
  };
}

export interface RehydrateDeps {
  /** Enumerate every (creator → wagerMatchId) row in the registry. */
  readRegistryEntries: () => Promise<RegistryEntry[]>;
  /** Read the per-wager chain fields. Returns null on RPC failure. */
  readWagerFields: (wagerMatchId: string) => Promise<ChainWagerFields | null>;
  /** Pull character facts (DB-first, chain-snapshot fallback handled in caller). */
  loadCharacter: (walletAddress: string) => Promise<CharacterFacts | null>;
  /** Insert into the in-memory lobby + broadcast. False if id already present. */
  adoptIntoLobby: (entry: WagerLobbyEntry) => boolean;
}

/**
 * Wallet-prefix placeholder name used when no character row is in
 * Supabase yet — the creator can still see their card and cancel it.
 * Format mirrors the frontend's offline-peer fallback in
 * `useGameStore::PUSH_DM_TOAST` so the UX feels consistent across
 * server-amnesia recovery surfaces.
 */
export function placeholderName(walletAddress: string): string {
  return `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}`;
}

/**
 * Build the lobby entry from chain truth + (best-effort) character facts.
 * Pure — no IO. Exported so the gauntlet can assert the mapping for each
 * status branch independently of the rehydration orchestration.
 */
export function buildLobbyEntry(
  wagerMatchId: string,
  chain: ChainWagerFields,
  character: CharacterFacts | null,
): WagerLobbyEntry | null {
  if (chain.status !== STATUS_WAITING && chain.status !== STATUS_PENDING_APPROVAL) {
    return null;
  }

  const wagerAmount = chain.stake_amount / 1_000_000_000;
  const creatorName = character?.name ?? placeholderName(chain.player_a);
  // Prefer the live character row when present; otherwise fall back to
  // chain truth (the player_a_level snapshot is exactly what
  // request_accept_wager validates against, so it's the right "level"
  // for any future bracket check anyway).
  const creatorLevel = character?.level ?? chain.player_a_level;
  const creatorRating = character?.rating ?? 1000;
  const creatorStats = character?.stats ?? {
    strength: 0,
    dexterity: 0,
    intuition: 0,
    endurance: 0,
  };
  // characterId is required by WagerLobbyEntry but only used by the
  // frontend for cosmetic linking — when we have no DB row we use a
  // synthetic id keyed off the wager so the entry is still unique.
  const creatorCharacterId = character?.id ?? `rehydrated:${wagerMatchId}`;

  const entry: WagerLobbyEntry = {
    wagerMatchId,
    creatorWallet: chain.player_a,
    creatorCharacterId,
    creatorName,
    creatorLevel,
    creatorRating,
    creatorStats,
    wagerAmount,
    // Use Date.now() (not chain.created_at) for the lobby clock — matches
    // the existing `/api/wager/adopt` behaviour in index.ts:443-451.
    // Resurrecting with the original timestamp would put the entry past
    // the 10-min lobby sweeper window and immediately trigger a wipe.
    createdAt: Date.now(),
    status: chain.status,
    playerALevelSnapshot: chain.player_a_level,
  };

  if (chain.status === STATUS_PENDING_APPROVAL && chain.pending_challenger) {
    // We don't have a character row for the challenger at this point.
    // The next WS frame from the challenger (or from any client
    // fetching the lobby and resolving names) will fill the gap. Stats
    // are zeroed — the lobby card's challenger-row only uses name +
    // level (gated by ±1 bracket against playerALevelSnapshot above).
    const challenger: PendingChallenger = {
      wallet: chain.pending_challenger,
      name: placeholderName(chain.pending_challenger),
      level: 0,
      rating: 1000,
      stats: { strength: 0, dexterity: 0, intuition: 0, endurance: 0 },
      pendingAt: chain.pending_at,
    };
    entry.pendingChallenger = challenger;
  }

  return entry;
}

/**
 * Orchestrator. Pure-DI: every chain / DB / lobby call goes through
 * `deps` so the gauntlet can drive every status branch without touching
 * the SDK or Supabase.
 */
export async function rehydrateLobbyFromChain(
  deps: RehydrateDeps,
): Promise<RehydrateResult> {
  const result: RehydrateResult = {
    registryEntries: 0,
    adopted: 0,
    skippedActive: 0,
    skippedSettled: 0,
    errors: 0,
  };

  let entries: RegistryEntry[];
  try {
    entries = await deps.readRegistryEntries();
  } catch (err: any) {
    console.error(
      '[LobbyRehydrate] Failed to read OpenWagerRegistry:',
      err?.message || err,
    );
    result.errors++;
    return result;
  }

  result.registryEntries = entries.length;
  if (entries.length === 0) {
    console.log('[LobbyRehydrate] No on-chain open wagers — nothing to rehydrate');
    return result;
  }

  console.log(
    `[LobbyRehydrate] OpenWagerRegistry has ${entries.length} entry/entries — checking chain state`,
  );

  for (const { wagerMatchId, creatorWallet } of entries) {
    let chain: ChainWagerFields | null;
    try {
      chain = await deps.readWagerFields(wagerMatchId);
    } catch (err: any) {
      result.errors++;
      console.error(
        `[LobbyRehydrate] readWagerFields(${wagerMatchId.slice(0, 10)}…) threw:`,
        err?.message || err,
      );
      continue;
    }
    if (!chain) {
      result.errors++;
      console.warn(
        `[LobbyRehydrate] ${wagerMatchId.slice(0, 10)}… returned no fields — skipping`,
      );
      continue;
    }

    if (chain.status === STATUS_SETTLED) {
      // Defensive — the v5.2 contract removes the registry entry on settle,
      // so a SETTLED row in the registry would indicate a contract bug.
      // Don't resurrect; just log.
      result.skippedSettled++;
      console.warn(
        `[LobbyRehydrate] ${wagerMatchId.slice(0, 10)}… is SETTLED but still in registry — unexpected`,
      );
      continue;
    }

    if (chain.status === STATUS_ACTIVE) {
      // ACTIVE wagers are handled by sweepOrphanActiveWagers via the
      // wager_in_flight Supabase table — admin-cancel-and-refund if the
      // fight never came back. Don't add to lobby.
      result.skippedActive++;
      console.log(
        `[LobbyRehydrate] ${wagerMatchId.slice(0, 10)}… is ACTIVE — orphan-recovery owns this row`,
      );
      continue;
    }

    if (chain.status !== STATUS_WAITING && chain.status !== STATUS_PENDING_APPROVAL) {
      result.errors++;
      console.warn(
        `[LobbyRehydrate] ${wagerMatchId.slice(0, 10)}… has unknown status=${chain.status} — skipping`,
      );
      continue;
    }

    let character: CharacterFacts | null = null;
    try {
      character = await deps.loadCharacter(creatorWallet);
    } catch (err: any) {
      // Non-fatal — we'll fall back to chain-snapshot placeholders.
      console.warn(
        `[LobbyRehydrate] loadCharacter(${creatorWallet.slice(0, 10)}…) threw — using placeholder:`,
        err?.message || err,
      );
    }

    const entry = buildLobbyEntry(wagerMatchId, chain, character);
    if (!entry) {
      // buildLobbyEntry only returns null for non-WAITING/PENDING states,
      // which we already filtered. Defence-in-depth.
      result.errors++;
      continue;
    }

    const adopted = deps.adoptIntoLobby(entry);
    if (adopted) {
      result.adopted++;
      const statusLabel = chain.status === STATUS_WAITING ? 'WAITING' : 'PENDING_APPROVAL';
      console.log(
        `[LobbyRehydrate] Adopted ${wagerMatchId.slice(0, 10)}… ` +
          `(${entry.creatorName}, ${entry.wagerAmount} SUI, ${statusLabel})`,
      );
    } else {
      // Already in lobby — defensive; rehydration runs once at boot
      // before any client could have added it, so this shouldn't fire.
      console.log(
        `[LobbyRehydrate] ${wagerMatchId.slice(0, 10)}… already in lobby — skipped`,
      );
    }
  }

  console.log(
    `[LobbyRehydrate] Done: ${result.adopted} adopted, ${result.skippedActive} active (orphan-recovery), ` +
      `${result.skippedSettled} settled, ${result.errors} errors`,
  );
  return result;
}

// ─── Production deps ────────────────────────────────────────────────
//
// Wire the real SDK / Supabase / lobby helpers. Lives in the same file
// so the gauntlet can import `rehydrateLobbyFromChain` directly without
// dragging in the chain client.

/**
 * Enumerate the OpenWagerRegistry's table via lazy dynamic-field reads.
 * Uses `readObjectWithRetry` so we inherit the same backoff envelope the
 * settle path uses (avoids flaky boot on a marginal RPC endpoint).
 *
 * The registry struct is `{ id, table: Table<address, ID> }`. The Table
 * has its own UID; that UID is the parent for all the dynamic-field
 * entries. We read the registry first to discover the table UID, then
 * enumerate via the gRPC client's `getDynamicFields`. For each field we
 * read the inner Field object to extract `name` (= creator wallet) and
 * `value` (= wager match id).
 */
async function readRegistryEntriesProd(): Promise<RegistryEntry[]> {
  const registryId = CONFIG.OPEN_WAGER_REGISTRY_ID;
  if (!registryId) {
    console.warn(
      '[LobbyRehydrate] OPEN_WAGER_REGISTRY_ID not set — skipping rehydration',
    );
    return [];
  }

  const reg = await readObjectWithRetry(registryId, { showContent: true });
  if (!reg.fields) {
    throw new Error(`registry ${registryId} returned no fields`);
  }
  const table = reg.fields.table as
    | { fields?: { id?: { id?: string }; size?: string | number }; id?: { id?: string }; size?: string | number }
    | undefined;
  // The SDK can return the Table struct either as a flat `{ id, size }`
  // wrapper or nested under `.fields` depending on options — accept both.
  const tableId =
    (table?.fields?.id?.id as string | undefined) ??
    (table?.id?.id as string | undefined);
  if (!tableId) {
    throw new Error(`registry ${registryId} has no table.id — fields: ${JSON.stringify(reg.fields).slice(0, 200)}`);
  }

  // Lazy require so this file stays test-importable without the SDK chain
  // setup. The chain reader is only constructed once we actually need it.
  const { SuiJsonRpcClient, getJsonRpcFullnodeUrl } = await import('@mysten/sui/jsonRpc');
  const network = (CONFIG.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
  const sdkClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

  const entries: RegistryEntry[] = [];
  let cursor: string | null | undefined = null;
  do {
    const page = await sdkClient.getDynamicFields({ parentId: tableId, cursor });
    for (const f of page.data) {
      // `name.value` is the address (key). `objectId` is the Field
      // wrapper — its content carries `value` which is the wager ID.
      const creator = typeof f.name?.value === 'string' ? f.name.value : null;
      if (!creator) continue;
      // Read the Field wrapper to pull the value out. multiGet would be
      // more efficient at scale but boot rehydration runs at most a
      // handful of entries — keep it simple.
      const fieldObj = await sdkClient.getObject({
        id: f.objectId,
        options: { showContent: true },
      });
      const value = (fieldObj.data?.content as { fields?: { value?: string } } | undefined)
        ?.fields?.value;
      if (typeof value !== 'string') continue;
      entries.push({ creatorWallet: creator, wagerMatchId: value });
    }
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);

  return entries;
}

async function readWagerFieldsProd(wagerMatchId: string): Promise<ChainWagerFields | null> {
  const { fields, type } = await readObjectWithRetry(wagerMatchId, {
    showContent: true,
    showType: true,
  });
  if (!fields || !type?.includes('::arena::WagerMatch')) return null;
  // Option<address> arrives as `{ vec: [string] }` (Some) or `{ vec: [] }`
  // (None). The chain shape is consistent across the SDK versions we use.
  const pendingRaw = fields.pending_challenger as { vec?: string[] } | string | null | undefined;
  const pending: string | null =
    typeof pendingRaw === 'string'
      ? pendingRaw
      : Array.isArray(pendingRaw?.vec) && pendingRaw.vec.length > 0
        ? pendingRaw.vec[0]
        : null;
  // `escrow` / `challenger_escrow` are Balance<SUI> — the JSON value is the
  // u64 amount as a string. Defensive coerce.
  const challengerEscrowRaw = fields.challenger_escrow as string | number | null | undefined;
  return {
    status: Number(fields.status),
    player_a: String(fields.player_a),
    player_a_level: Number(fields.player_a_level ?? 0),
    stake_amount: Number(fields.stake_amount),
    created_at: Number(fields.created_at),
    pending_challenger: pending,
    pending_at: Number(fields.pending_at ?? 0),
    challenger_escrow: Number(challengerEscrowRaw ?? 0),
  };
}

async function loadCharacterProd(walletAddress: string): Promise<CharacterFacts | null> {
  const char = await restoreCharacterFromDb(walletAddress);
  if (!char) return null;
  return {
    id: char.id,
    name: char.name,
    level: char.level,
    rating: char.rating,
    stats: { ...char.stats },
  };
}

const productionDeps: RehydrateDeps = {
  readRegistryEntries: readRegistryEntriesProd,
  readWagerFields: readWagerFieldsProd,
  loadCharacter: loadCharacterProd,
  adoptIntoLobby: adoptWagerIntoLobby,
};

/** Production entry-point called from server boot. */
export async function bootRehydrateLobby(): Promise<RehydrateResult> {
  return rehydrateLobbyFromChain(productionDeps);
}
