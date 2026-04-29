/**
 * Live marketplace listing index — chain is the source of truth.
 *
 * Architecture:
 *
 *   1. Cold sync — at startup, paginate JSON-RPC `queryEvents` (ascending) to
 *      replay every `marketplace::*` event the package has ever emitted. This
 *      rebuilds `kioskOwners` + `listings` from scratch.
 *
 *   2. Live subscription — open a gRPC server-streaming `SubscribeCheckpoints`
 *      against the public Sui fullnode. We get every executed checkpoint as
 *      it lands (~250ms cadence on testnet) with its full transaction list +
 *      events. We filter in-process for `package_id == SUI_PACKAGE_ID` AND
 *      `module == 'marketplace'`, then BCS-decode the event payload.
 *
 *   3. Reconnect / gap-fill — Mysten's gRPC stream gives in-order, no-gap
 *      delivery WITHIN a single subscription, but a reconnect after a drop
 *      can land on a higher checkpoint than the last we processed. We track
 *      the highest seq we've processed; on reconnect we `queryEvents` from
 *      `(lastSeq, now]` to fill the gap, then resume the gRPC stream.
 *
 *   4. Backoff — disconnect → exponential 1s/2s/5s/10s/30s, reset on success.
 *
 * Why gRPC instead of `suix_subscribeEvent` over WSS:
 *   Mysten's public testnet/mainnet fullnodes returned HTTP 405 on WS upgrade
 *   in our smoke test (May 2026). They've migrated event subscription to the
 *   gRPC LiveData / Subscription service. `subscribeCheckpoints` is the
 *   officially-supported, in-order, no-gap stream and works against the same
 *   `https://fullnode.<net>.sui.io:443` endpoint we already use over JSON-RPC.
 *
 * The gRPC event payload only ships BCS-encoded bytes (`event.contents.value`)
 * — the optional `event.json` field is not populated on the public fullnode.
 * We decode the four `marketplace::*` event structs by hand below; they're
 * fixed-layout (32-byte ID, 32-byte address, 8-byte u64) so manual decode is
 * trivial and avoids a per-event JSON-RPC roundtrip.
 */
import { setGlobalDispatcher, Agent } from 'undici';
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { CONFIG } from '../config';
import { getCharacterByWallet } from './characters';
import type { Item, ItemType, Rarity } from '../types';

// Node's default undici Agent has aggressive keepalive timeouts (~5s) and a
// non-zero bodyTimeout. Both kill HTTP/2 server-streaming responses after a
// brief idle window, which is exactly what `subscribeCheckpoints` is. Setting
// a global Agent with `bodyTimeout: 0` + extended keepalive lets the gRPC
// stream stay open as long as the chain pushes checkpoints.
//
// This is set as a *side-effect* of importing this module — every other
// fetch call in the server inherits the Agent, which is desirable: every
// outbound RPC benefits from connection reuse.
setGlobalDispatcher(new Agent({
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  bodyTimeout: 0,
  headersTimeout: 0,
  connect: { timeout: 30_000 },
}));

// ===== Types =====

export interface ServerMarketplaceListing {
  /** Unique key — the Item NFT object ID (each NFT is in at most one listing). */
  id: string;
  itemId: string;
  kioskId: string;
  /** Price in SUI (rounded). For exact arithmetic use priceMist. */
  price: number;
  /** Raw price in MIST as a decimal string — JSON-safe alternative to bigint. */
  priceMist: string;
  seller: string;
  sellerName: string;
  item: Item;
  /** Event timestamp from chain (ms since epoch). */
  listedAt: number;
}

export type MarketplaceEvent =
  | { type: 'item_listed'; listing: ServerMarketplaceListing }
  | {
      type: 'item_delisted';
      listingId: string;
      /** Wallet that owned the kiosk where the listing lived. Lets the
       *  seller's UI react without scanning chain. */
      seller: string;
      kioskId: string;
    }
  | {
      type: 'item_bought';
      listingId: string;
      buyer: string;
      /** Seller (kiosk owner) — required client-side so the seller's tab
       *  can auto-refresh their kiosk profits + listings count without
       *  having signed the buy tx themselves. */
      seller: string;
      kioskId: string;
    };

type Subscriber = (event: MarketplaceEvent) => void;

// ===== State =====

const listings = new Map<string, ServerMarketplaceListing>();
const kioskOwners = new Map<string, string>();
const subscribers = new Set<Subscriber>();

// Highest checkpoint sequence we've fully processed. Used for gap-fill on
// reconnect via JSON-RPC queryEvents (the gRPC stream resets to "now" on
// each subscribe — no `start_from` parameter on the public endpoint).
let lastProcessedCheckpointSeq: bigint | null = null;

// Last JSON-RPC event cursor. Independent from checkpoint seq — used for
// resumable cold-sync pagination.
let lastEventCursor: { txDigest: string; eventSeq: string } | null = null;

let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let shuttingDown = false;
let activeStream: { abort: () => void } | null = null;

// Single shared HTTP client for queryEvents + getObject. Same instance pattern
// as the existing utilities use elsewhere in the server.
const network = (CONFIG.SUI_NETWORK === 'mainnet' ? 'mainnet' : 'testnet') as 'mainnet' | 'testnet';
const httpClient = new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl(network), network });

// gRPC client for the live checkpoint subscription. Uses the same HTTPS
// endpoint as the JSON-RPC client (Mysten's gRPC-Web is hosted on the same
// fullnode endpoint).
const grpcClient = new SuiGrpcClient({
  network,
  baseUrl: getJsonRpcFullnodeUrl(network),
});

// ===== Public API =====

export function getMarketplaceListings(): ServerMarketplaceListing[] {
  return Array.from(listings.values()).sort((a, b) => b.listedAt - a.listedAt);
}

export function findListingByItemId(itemId: string): ServerMarketplaceListing | undefined {
  return listings.get(itemId);
}

export function findKioskByOwner(owner: string): string | null {
  for (const [kioskId, ownerAddr] of kioskOwners) {
    if (ownerAddr.toLowerCase() === owner.toLowerCase()) return kioskId;
  }
  return null;
}

export function subscribeMarketplace(handler: Subscriber): () => void {
  subscribers.add(handler);
  return () => {
    subscribers.delete(handler);
  };
}

/**
 * Boot the marketplace index: cold-sync from chain, then open the gRPC
 * checkpoint subscription. Idempotent — re-calling will tear down any
 * existing stream first.
 */
export async function startMarketplaceIndex(): Promise<void> {
  shuttingDown = false;
  if (activeStream) {
    activeStream.abort();
    activeStream = null;
  }
  console.log('[Marketplace] Cold sync starting…');
  await coldSync();
  console.log(`[Marketplace] Cold sync complete: ${listings.size} active listings, ${kioskOwners.size} kiosks indexed`);
  void runSubscription();
}

export function shutdownMarketplaceIndex(): void {
  shuttingDown = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeStream) {
    activeStream.abort();
    activeStream = null;
  }
}

// ===== Cold sync (JSON-RPC) =====

async function coldSync(): Promise<void> {
  let cursor: { txDigest: string; eventSeq: string } | null = null;
  while (true) {
    const page = await httpClient.queryEvents({
      query: { MoveEventModule: { package: CONFIG.SUI_PACKAGE_ID, module: 'marketplace' } },
      cursor: cursor ?? undefined,
      limit: 50,
      order: 'ascending',
    });
    for (const event of page.data) {
      await handleParsedEvent({
        type: event.type,
        parsedJson: event.parsedJson,
        timestampMs: event.timestampMs ? Number(event.timestampMs) : Date.now(),
        txDigest: event.id?.txDigest ?? null,
      });
    }
    if (page.data.length > 0) {
      const last = page.data[page.data.length - 1];
      lastEventCursor = { txDigest: last.id.txDigest, eventSeq: last.id.eventSeq };
    }
    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
}

// ===== Gap-fill on reconnect (JSON-RPC) =====

async function catchUpFromCursor(): Promise<void> {
  if (!lastEventCursor) return;
  let cursor: { txDigest: string; eventSeq: string } = lastEventCursor;
  while (true) {
    const page = await httpClient.queryEvents({
      query: { MoveEventModule: { package: CONFIG.SUI_PACKAGE_ID, module: 'marketplace' } },
      cursor,
      limit: 50,
      order: 'ascending',
    });
    for (const event of page.data) {
      await handleParsedEvent({
        type: event.type,
        parsedJson: event.parsedJson,
        timestampMs: event.timestampMs ? Number(event.timestampMs) : Date.now(),
        txDigest: event.id?.txDigest ?? null,
      });
    }
    if (page.data.length > 0) {
      const last = page.data[page.data.length - 1];
      lastEventCursor = { txDigest: last.id.txDigest, eventSeq: last.id.eventSeq };
    }
    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
}

// ===== gRPC subscription =====

async function runSubscription(): Promise<void> {
  if (shuttingDown) return;

  // Catch up gap before re-subscribing — guarantees no event drop
  if (lastEventCursor) {
    try {
      await catchUpFromCursor();
    } catch (err: any) {
      console.error('[Marketplace] Gap-fill failed:', err?.message || err);
    }
  }

  let aborted = false;
  activeStream = {
    abort: () => {
      aborted = true;
    },
  };

  console.log('[Marketplace] Opening gRPC subscribeCheckpoints…');

  // Note: protobuf-ts grpcweb-transport's `abort` option triggered the public
  // testnet endpoint to immediately terminate streams (May 2026). Without it
  // the stream stays open. We rely on `aborted` flag + iterator break for
  // teardown, and on `for await` exhausting on transport-level disconnect.
  const stream = grpcClient.subscriptionService.subscribeCheckpoints(
    { readMask: { paths: ['*'] } },
  );

  let firstCheckpoint = true;
  try {
    for await (const msg of stream.responses) {
      if (aborted) break;
      if (firstCheckpoint) {
        firstCheckpoint = false;
        reconnectAttempt = 0;
        console.log(`[Marketplace] Live stream active (first checkpoint seq=${msg.checkpoint?.sequenceNumber})`);
      }
      const seq = msg.checkpoint?.sequenceNumber;
      const txs = msg.checkpoint?.transactions ?? [];
      const ts = msg.checkpoint?.summary?.timestamp;
      const tsMs = ts ? Number(ts.seconds ?? 0n) * 1000 + Math.floor(Number(ts.nanos ?? 0) / 1_000_000) : Date.now();

      for (const tx of txs) {
        const events = tx.events?.events ?? [];
        for (const ev of events) {
          if (ev.packageId !== CONFIG.SUI_PACKAGE_ID) continue;
          if (ev.module !== 'marketplace') continue;
          if (!ev.eventType || !ev.contents?.value) continue;

          const bcsBytes = bcsBytesToUint8(ev.contents.value);
          await handleBcsEvent(ev.eventType, bcsBytes, tsMs);
        }
      }

      if (seq != null) {
        lastProcessedCheckpointSeq = seq;
      }
    }
  } catch (err: any) {
    if (!aborted) {
      console.warn('[Marketplace] gRPC stream errored:', err?.message || err);
    }
  } finally {
    if (activeStream && !aborted) {
      // Stream ended without us aborting — schedule reconnect
      activeStream = null;
      scheduleReconnect();
    } else if (aborted) {
      activeStream = null;
    }
  }
}

function scheduleReconnect(): void {
  if (shuttingDown) return;
  const backoffSequence = [1000, 2000, 5000, 10_000, 30_000];
  const delay = backoffSequence[Math.min(reconnectAttempt, backoffSequence.length - 1)];
  reconnectAttempt++;
  console.log(`[Marketplace] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    void runSubscription();
  }, delay);
}

// ===== Event dispatch =====

interface ParsedEvent {
  type: string;
  parsedJson: unknown;
  timestampMs: number;
  txDigest: string | null;
}

async function handleParsedEvent(ev: ParsedEvent): Promise<void> {
  const json = (ev.parsedJson ?? {}) as Record<string, unknown>;
  const t = ev.type;

  if (t.endsWith('::marketplace::KioskCreated')) {
    handleKioskCreated(String(json.kiosk_id ?? ''), String(json.owner ?? ''));
    return;
  }

  if (t.endsWith('::marketplace::ItemListed')) {
    await handleItemListed({
      kiosk_id: String(json.kiosk_id ?? ''),
      item_id: String(json.item_id ?? ''),
      price: BigInt(String(json.price ?? '0')),
      seller: String(json.seller ?? ''),
    }, ev.timestampMs);
    return;
  }

  if (t.endsWith('::marketplace::ItemDelisted')) {
    handleItemDelisted(String(json.item_id ?? ''));
    return;
  }

  if (t.endsWith('::marketplace::ItemPurchased')) {
    handleItemPurchased(String(json.item_id ?? ''), String(json.buyer ?? ''));
    return;
  }
}

async function handleBcsEvent(eventType: string, bytes: Uint8Array, timestampMs: number): Promise<void> {
  if (!eventType.startsWith(CONFIG.SUI_PACKAGE_ID)) return;

  if (eventType.endsWith('::marketplace::KioskCreated')) {
    const decoded = decodeKioskCreated(bytes);
    handleKioskCreated(decoded.kiosk_id, decoded.owner);
    return;
  }

  if (eventType.endsWith('::marketplace::ItemListed')) {
    const decoded = decodeItemListed(bytes);
    await handleItemListed(decoded, timestampMs);
    return;
  }

  if (eventType.endsWith('::marketplace::ItemDelisted')) {
    const decoded = decodeItemDelisted(bytes);
    handleItemDelisted(decoded.item_id);
    return;
  }

  if (eventType.endsWith('::marketplace::ItemPurchased')) {
    const decoded = decodeItemPurchased(bytes);
    handleItemPurchased(decoded.item_id, decoded.buyer);
    return;
  }
}

function handleKioskCreated(kioskId: string, owner: string): void {
  if (!kioskId || !owner) return;
  kioskOwners.set(kioskId, owner);
}

async function handleItemListed(
  payload: { kiosk_id: string; item_id: string; price: bigint; seller: string },
  listedAt: number,
): Promise<void> {
  if (!payload.item_id || !payload.kiosk_id || !payload.seller) return;

  // Dedupe — gRPC + cold sync can deliver the same event under reconnect.
  if (listings.has(payload.item_id)) return;

  let item: Item;
  try {
    item = await fetchItemNft(payload.item_id);
  } catch (err: any) {
    console.warn(`[Marketplace] Skipping listing ${payload.item_id.slice(0, 10)}… — Item fetch failed: ${err?.message || err}`);
    return;
  }

  const priceMist = payload.price.toString();
  const price = mistToSui(payload.price);
  const sellerCharacter = getCharacterByWallet(payload.seller);
  const sellerName = sellerCharacter?.name ?? `${payload.seller.slice(0, 8)}…`;

  const listing: ServerMarketplaceListing = {
    id: payload.item_id,
    itemId: payload.item_id,
    kioskId: payload.kiosk_id,
    price,
    priceMist,
    seller: payload.seller,
    sellerName,
    item,
    listedAt,
  };

  listings.set(payload.item_id, listing);
  kioskOwners.set(payload.kiosk_id, payload.seller);
  broadcast({ type: 'item_listed', listing });
}

function handleItemDelisted(itemId: string): void {
  if (!itemId) return;
  // Capture seller + kiosk BEFORE deleting — clients need both to refresh
  // their local state. The seller info comes from the live index; if we
  // missed the original ItemListed (cold-sync race), fall back to the
  // kioskOwners map.
  const listing = listings.get(itemId);
  if (!listing) return;
  listings.delete(itemId);
  broadcast({
    type: 'item_delisted',
    listingId: itemId,
    seller: listing.seller,
    kioskId: listing.kioskId,
  });
}

function handleItemPurchased(itemId: string, buyer: string): void {
  if (!itemId) return;
  const listing = listings.get(itemId);
  if (!listing) return;
  listings.delete(itemId);
  broadcast({
    type: 'item_bought',
    listingId: itemId,
    buyer,
    seller: listing.seller,
    kioskId: listing.kioskId,
  });
}

function broadcast(event: MarketplaceEvent): void {
  for (const handler of subscribers) {
    try {
      handler(event);
    } catch (err: any) {
      console.error('[Marketplace] subscriber threw:', err?.message || err);
    }
  }
}

// ===== Item NFT fetch =====

async function fetchItemNft(itemId: string): Promise<Item> {
  const obj = await httpClient.getObject({ id: itemId, options: { showContent: true, showType: true } });
  const fields = (obj.data?.content as { fields?: Record<string, unknown> } | undefined)?.fields;
  if (!fields) {
    throw new Error(`Item ${itemId} has no content`);
  }
  return {
    id: itemId,
    name: String(fields.name ?? ''),
    itemType: Number(fields.item_type ?? 1) as ItemType,
    rarity: Number(fields.rarity ?? 1) as Rarity,
    levelReq: Number(fields.level_req ?? 1),
    statBonuses: {
      strength: Number(fields.strength_bonus ?? 0),
      dexterity: Number(fields.dexterity_bonus ?? 0),
      intuition: Number(fields.intuition_bonus ?? 0),
      endurance: Number(fields.endurance_bonus ?? 0),
      hp: Number(fields.hp_bonus ?? 0),
      armor: Number(fields.armor_bonus ?? 0),
      defense: Number(fields.defense_bonus ?? 0),
      damage: Number(fields.attack_bonus ?? 0),
      critBonus: Number(fields.crit_chance_bonus ?? 0),
    },
    minDamage: Number(fields.min_damage ?? 0),
    maxDamage: Number(fields.max_damage ?? 0),
    description: typeof fields.image_url === 'string' ? `image:${fields.image_url}` : undefined,
  };
}

// ===== BCS decoders for marketplace events =====
//
// These are exported (not just internal) so tests can pin the wire format
// and detect drift from the Move structs. ID and address are 32-byte values;
// u64 is 8 bytes little-endian. No length prefix on fixed-size types.

const ID_SIZE = 32;
const ADDR_SIZE = 32;
const U64_SIZE = 8;

function readAddress(bytes: Uint8Array, offset: number): string {
  if (offset + ADDR_SIZE > bytes.length) {
    throw new Error(`BCS underrun reading address at offset ${offset}`);
  }
  let hex = '';
  for (let i = 0; i < ADDR_SIZE; i++) {
    hex += bytes[offset + i].toString(16).padStart(2, '0');
  }
  return '0x' + hex;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  if (offset + U64_SIZE > bytes.length) {
    throw new Error(`BCS underrun reading u64 at offset ${offset}`);
  }
  let v = 0n;
  for (let i = 0; i < U64_SIZE; i++) {
    v |= BigInt(bytes[offset + i]) << BigInt(8 * i);
  }
  return v;
}

export function decodeKioskCreated(bytes: Uint8Array): { kiosk_id: string; owner: string } {
  return {
    kiosk_id: readAddress(bytes, 0),
    owner: readAddress(bytes, ID_SIZE),
  };
}

export function decodeItemListed(bytes: Uint8Array): { kiosk_id: string; item_id: string; price: bigint; seller: string } {
  return {
    kiosk_id: readAddress(bytes, 0),
    item_id: readAddress(bytes, ID_SIZE),
    price: readU64LE(bytes, ID_SIZE * 2),
    seller: readAddress(bytes, ID_SIZE * 2 + U64_SIZE),
  };
}

export function decodeItemDelisted(bytes: Uint8Array): { kiosk_id: string; item_id: string; seller: string } {
  return {
    kiosk_id: readAddress(bytes, 0),
    item_id: readAddress(bytes, ID_SIZE),
    seller: readAddress(bytes, ID_SIZE * 2),
  };
}

export function decodeItemPurchased(bytes: Uint8Array): { kiosk_id: string; item_id: string; buyer: string; price: bigint; royalty_paid: bigint } {
  return {
    kiosk_id: readAddress(bytes, 0),
    item_id: readAddress(bytes, ID_SIZE),
    buyer: readAddress(bytes, ID_SIZE * 2),
    price: readU64LE(bytes, ID_SIZE * 3),
    royalty_paid: readU64LE(bytes, ID_SIZE * 3 + U64_SIZE),
  };
}

// ===== Helpers =====

const SUI_PER_MIST = 1_000_000_000;

function mistToSui(mist: bigint | string | number): number {
  const n = typeof mist === 'bigint' ? Number(mist) : Number(mist);
  if (!Number.isFinite(n)) return 0;
  return n / SUI_PER_MIST;
}

function msToNumber(ts: bigint | number | string): number {
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'bigint') return Number(ts);
  const n = Number(ts);
  return Number.isFinite(n) ? n : Date.now();
}

/**
 * The gRPC SDK encodes `Bcs.value` (raw bytes) as either a real Uint8Array,
 * a node Buffer, or a JSON object whose keys are array indices (when the
 * SDK is consumed via certain transports). Coerce to a plain Uint8Array
 * regardless of source.
 */
function bcsBytesToUint8(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value);
  if (value && typeof value === 'object') {
    // numeric-key object → array
    const keys = Object.keys(value as Record<string, unknown>);
    const arr = new Uint8Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      arr[i] = Number((value as Record<string, unknown>)[String(i)] ?? 0);
    }
    return arr;
  }
  throw new Error(`Unrecognized BCS bytes encoding: ${typeof value}`);
}

// ===== Wire-format helpers =====

/**
 * Project a ServerMarketplaceListing into the shape the frontend's
 * `MarketplaceListing` expects. The server's Item shape uses chain field
 * names (`armor`, `damage`, `critBonus`); the wire shape uses the
 * frontend-friendly `*Bonus` keys.
 */
export function listingToWire(l: ServerMarketplaceListing): Record<string, unknown> {
  const s = l.item.statBonuses as Record<string, number | undefined>;
  let imageUrl: string | undefined;
  if (typeof l.item.description === 'string' && l.item.description.startsWith('image:')) {
    imageUrl = l.item.description.slice('image:'.length);
  }
  return {
    id: l.id,
    item: {
      id: l.item.id,
      name: l.item.name,
      imageUrl: imageUrl ?? undefined,
      itemType: l.item.itemType,
      rarity: l.item.rarity,
      classReq: 0,
      levelReq: l.item.levelReq,
      minDamage: l.item.minDamage ?? 0,
      maxDamage: l.item.maxDamage ?? 0,
      statBonuses: {
        strengthBonus: s.strength ?? 0,
        dexterityBonus: s.dexterity ?? 0,
        intuitionBonus: s.intuition ?? 0,
        enduranceBonus: s.endurance ?? 0,
        hpBonus: s.hp ?? 0,
        armorBonus: s.armor ?? 0,
        defenseBonus: s.defense ?? 0,
        attackBonus: s.damage ?? 0,
        critChanceBonus: s.critBonus ?? 0,
        critMultiplierBonus: 0,
        evasionBonus: 0,
        antiCritBonus: 0,
        antiEvasionBonus: 0,
      },
      inKiosk: true,
    },
    kioskId: l.kioskId,
    seller: l.seller,
    sellerName: l.sellerName,
    price: l.price,
    priceMist: l.priceMist,
    listedAt: l.listedAt,
  };
}

// ===== Test hooks (only used by scripts/qa-marketplace.ts) =====

/** Reset all in-memory state — for unit tests. */
export function _resetForTest(): void {
  listings.clear();
  kioskOwners.clear();
  subscribers.clear();
  lastProcessedCheckpointSeq = null;
  lastEventCursor = null;
}

/** Apply a parsed event without touching the network — for unit tests. */
export async function _applyParsedEventForTest(ev: ParsedEvent): Promise<void> {
  await handleParsedEvent(ev);
}

/** Inject a pre-fetched item into a listing for tests that don't want chain RPC. */
export function _injectListingForTest(listing: ServerMarketplaceListing): void {
  listings.set(listing.id, listing);
  kioskOwners.set(listing.kioskId, listing.seller);
}
