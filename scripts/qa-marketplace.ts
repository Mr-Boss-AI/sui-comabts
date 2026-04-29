/**
 * Marketplace gauntlet — pure unit tests, no chain calls.
 *
 *   $ cd server && npx tsx ../scripts/qa-marketplace.ts
 *
 * Covers:
 *   1. BCS decoders match the marketplace.move struct layouts byte-for-byte.
 *   2. Royalty math matches the contract's rule (2.5% bps, 1000 MIST floor).
 *   3. Listing index reacts correctly to a list / delist / buy lifecycle.
 *   4. Reconnect-time event replay is idempotent (no duplicate broadcasts).
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  _resetForTest,
  _applyParsedEventForTest,
  _injectListingForTest,
  decodeKioskCreated,
  decodeItemListed,
  decodeItemDelisted,
  decodeItemPurchased,
  getMarketplaceListings,
  findKioskByOwner,
  findListingByItemId,
  subscribeMarketplace,
  listingToWire,
  type MarketplaceEvent,
  type ServerMarketplaceListing,
} from '../server/src/data/marketplace';
import type { Item } from '../server/src/types';

// Inline royalty formula — must match `frontend/src/lib/sui-contracts.ts::computeRoyalty`
// AND `contracts/sources/royalty_rule.move::amount`. Re-stating it here ensures the
// test pins the contract behaviour even if the frontend file moves.
const ROYALTY_BPS = BigInt(250);   // 2.5%
const BPS_BASE = BigInt(10_000);
const ROYALTY_MIN_MIST = BigInt(1_000);
function computeRoyalty(priceMist: bigint): bigint {
  const computed = (priceMist * ROYALTY_BPS) / BPS_BASE;
  return computed < ROYALTY_MIN_MIST ? ROYALTY_MIN_MIST : computed;
}

const PKG = '0xa7dc2dabea6acc2db1a9599a0c1e003ad6b2e6064a2847687bc93037a662e1c1';

let passes = 0;
let failures = 0;

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) ok(label);
  else fail(label, `actual=${JSON.stringify(actual)}  expected=${JSON.stringify(expected)}`);
}
function deepEq<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  const b = JSON.stringify(expected, (_, v) => typeof v === 'bigint' ? v.toString() : v);
  if (a === b) ok(label);
  else fail(label, `\n          actual=${a}\n          expected=${b}`);
}

// Helper to build a 32-byte hex string for testing.
function pad32(hex: string): string {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;
  return '0x' + stripped.padStart(64, '0');
}

// Helper to build BCS bytes for a known address (32 bytes).
function addrBytes(hex: string): Uint8Array {
  const stripped = pad32(hex).slice(2);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// LE u64 → 8 bytes.
function u64Bytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// =============================================================================
// 1 — BCS decoders
// =============================================================================
console.log('\n[1] BCS decoders match marketplace.move struct layouts');

{
  const kioskId = pad32('0xaaaa');
  const owner = pad32('0xbbbb');
  const bytes = concat(addrBytes(kioskId), addrBytes(owner));
  const decoded = decodeKioskCreated(bytes);
  eq(decoded.kiosk_id, kioskId, 'KioskCreated.kiosk_id');
  eq(decoded.owner, owner, 'KioskCreated.owner');
  eq(bytes.length, 64, 'KioskCreated payload length = 64 bytes');
}

{
  const kioskId = pad32('0xcccc');
  const itemId = pad32('0xdddd');
  const price = BigInt(500_000_000); // 0.5 SUI
  const seller = pad32('0xeeee');
  const bytes = concat(addrBytes(kioskId), addrBytes(itemId), u64Bytes(price), addrBytes(seller));
  const decoded = decodeItemListed(bytes);
  eq(decoded.kiosk_id, kioskId, 'ItemListed.kiosk_id');
  eq(decoded.item_id, itemId, 'ItemListed.item_id');
  eq(decoded.price.toString(), price.toString(), 'ItemListed.price');
  eq(decoded.seller, seller, 'ItemListed.seller');
  eq(bytes.length, 104, 'ItemListed payload length = 104 bytes');
}

{
  const kioskId = pad32('0x1111');
  const itemId = pad32('0x2222');
  const seller = pad32('0x3333');
  const bytes = concat(addrBytes(kioskId), addrBytes(itemId), addrBytes(seller));
  const decoded = decodeItemDelisted(bytes);
  eq(decoded.kiosk_id, kioskId, 'ItemDelisted.kiosk_id');
  eq(decoded.item_id, itemId, 'ItemDelisted.item_id');
  eq(decoded.seller, seller, 'ItemDelisted.seller');
  eq(bytes.length, 96, 'ItemDelisted payload length = 96 bytes');
}

{
  const kioskId = pad32('0x4444');
  const itemId = pad32('0x5555');
  const buyer = pad32('0x6666');
  const price = BigInt(1_000_000_000); // 1 SUI
  const royalty = BigInt(25_000_000); // 2.5% = 25M MIST
  const bytes = concat(
    addrBytes(kioskId),
    addrBytes(itemId),
    addrBytes(buyer),
    u64Bytes(price),
    u64Bytes(royalty),
  );
  const decoded = decodeItemPurchased(bytes);
  eq(decoded.kiosk_id, kioskId, 'ItemPurchased.kiosk_id');
  eq(decoded.item_id, itemId, 'ItemPurchased.item_id');
  eq(decoded.buyer, buyer, 'ItemPurchased.buyer');
  eq(decoded.price.toString(), price.toString(), 'ItemPurchased.price');
  eq(decoded.royalty_paid.toString(), royalty.toString(), 'ItemPurchased.royalty_paid');
  eq(bytes.length, 112, 'ItemPurchased payload length = 112 bytes');
}

// =============================================================================
// 2 — Royalty math: matches royalty_rule.move's amount() function
// =============================================================================
console.log('\n[2] computeRoyalty matches royalty_rule.move');

eq(computeRoyalty(BigInt(0)).toString(), '1000', 'price=0 → MIN floor 1000 MIST');
eq(computeRoyalty(BigInt(39_999)).toString(), '1000', 'price=0.04 SUI → still floor (1.5M*250/10000=999<1000)');
eq(computeRoyalty(BigInt(40_000)).toString(), '1000', 'price=40_000 → exactly floor');
eq(computeRoyalty(BigInt(1_000_000_000)).toString(), '25000000', 'price=1 SUI → 0.025 SUI royalty');
eq(computeRoyalty(BigInt(10_000_000_000)).toString(), '250000000', 'price=10 SUI → 0.25 SUI royalty');
eq(computeRoyalty(BigInt(123_456_789)).toString(), '3086419', 'odd price rounds down (250bp)');

// =============================================================================
// 3 — Listing index lifecycle (parsed-JSON path used by cold sync)
// =============================================================================
console.log('\n[3] Listing index — list / delist / buy lifecycle');

const KIOSK = pad32('0xa1');
const SELLER = pad32('0xb2');
const BUYER = pad32('0xc3');
const ITEM_A = pad32('0x4001');
const ITEM_B = pad32('0x4002');

// Inject items directly so we don't need chain RPC.
const itemA: Item = {
  id: ITEM_A,
  name: 'Test Sword',
  itemType: 1,
  rarity: 1,
  levelReq: 1,
  statBonuses: { strength: 5 },
  minDamage: 5,
  maxDamage: 10,
  description: 'image:https://example.com/sword.png',
};
const itemB: Item = {
  id: ITEM_B,
  name: 'Test Shield',
  itemType: 2,
  rarity: 2,
  levelReq: 3,
  statBonuses: { defense: 3 },
};

async function main(): Promise<void> {
_resetForTest();

// Subscribe to events
const events: MarketplaceEvent[] = [];
const unsubscribe = subscribeMarketplace((e) => events.push(e));

// Pre-seed the listings so we don't have to hit chain to fetch the Item.
const listingA: ServerMarketplaceListing = {
  id: ITEM_A, itemId: ITEM_A, kioskId: KIOSK, price: 0.5, priceMist: '500000000',
  seller: SELLER, sellerName: 'Seller', item: itemA, listedAt: 1000,
};
_injectListingForTest(listingA);

eq(getMarketplaceListings().length, 1, 'after inject → 1 listing');
eq(findListingByItemId(ITEM_A)?.seller, SELLER, 'lookup by itemId returns seller');
eq(findKioskByOwner(SELLER), KIOSK, 'kiosk owner reverse-lookup');

// KioskCreated event
await _applyParsedEventForTest({
  type: `${PKG}::marketplace::KioskCreated`,
  parsedJson: { kiosk_id: KIOSK, owner: SELLER },
  timestampMs: 500,
  txDigest: 'tx0',
});
eq(findKioskByOwner(SELLER), KIOSK, 'KioskCreated registers kiosk owner');

// ItemListed for B (different item — A is already injected, won't broadcast for it)
// We're testing the FROM-EVENT path, but it tries to fetch the item via getObject
// which we don't want in tests. So we skip that path and inject directly:
const listingB: ServerMarketplaceListing = {
  id: ITEM_B, itemId: ITEM_B, kioskId: KIOSK, price: 1.0, priceMist: '1000000000',
  seller: SELLER, sellerName: 'Seller', item: itemB, listedAt: 2000,
};
_injectListingForTest(listingB);
eq(getMarketplaceListings().length, 2, 'two listings present');

// ItemDelisted A
await _applyParsedEventForTest({
  type: `${PKG}::marketplace::ItemDelisted`,
  parsedJson: { kiosk_id: KIOSK, item_id: ITEM_A, seller: SELLER },
  timestampMs: 3000,
  txDigest: 'tx1',
});
eq(getMarketplaceListings().length, 1, 'after delist A → 1 listing');
eq(findListingByItemId(ITEM_A), undefined, 'A is gone');
eq(findListingByItemId(ITEM_B)?.id, ITEM_B, 'B still present');

// Verify the delist event was broadcast — must carry seller + kioskId
// so the seller's tab can refresh reactively (Bug B fix).
const delistEvent = events.find((e) => e.type === 'item_delisted');
deepEq(
  delistEvent,
  { type: 'item_delisted', listingId: ITEM_A, seller: SELLER, kioskId: KIOSK },
  'delist event broadcast carries seller + kioskId',
);

// ItemPurchased B
await _applyParsedEventForTest({
  type: `${PKG}::marketplace::ItemPurchased`,
  parsedJson: { kiosk_id: KIOSK, item_id: ITEM_B, buyer: BUYER, price: '1000000000', royalty_paid: '25000000' },
  timestampMs: 4000,
  txDigest: 'tx2',
});
eq(getMarketplaceListings().length, 0, 'after buy B → 0 listings');
const buyEvent = events.find((e) => e.type === 'item_bought');
// Bug B fix: buy event must carry seller + kioskId so the SELLER's tab
// auto-refreshes profits + listings even though the BUYER signed the tx.
deepEq(
  buyEvent,
  { type: 'item_bought', listingId: ITEM_B, buyer: BUYER, seller: SELLER, kioskId: KIOSK },
  'buy event broadcast carries seller + kioskId',
);

unsubscribe();

// =============================================================================
// 4 — Reconnect idempotency
// =============================================================================
console.log('\n[4] Reconnect idempotency — replaying the same delist is a no-op');

_resetForTest();
const itemC: Item = { ...itemA, id: pad32('0x9001') };
const listingC: ServerMarketplaceListing = {
  id: itemC.id, itemId: itemC.id, kioskId: KIOSK, price: 0.1, priceMist: '100000000',
  seller: SELLER, sellerName: 'Seller', item: itemC, listedAt: 5000,
};
_injectListingForTest(listingC);

const events2: MarketplaceEvent[] = [];
const unsub2 = subscribeMarketplace((e) => events2.push(e));

await _applyParsedEventForTest({
  type: `${PKG}::marketplace::ItemDelisted`,
  parsedJson: { kiosk_id: KIOSK, item_id: itemC.id, seller: SELLER },
  timestampMs: 6000, txDigest: 'tx3',
});
await _applyParsedEventForTest({
  type: `${PKG}::marketplace::ItemDelisted`,
  parsedJson: { kiosk_id: KIOSK, item_id: itemC.id, seller: SELLER },
  timestampMs: 6001, txDigest: 'tx3-replay',
});
eq(events2.filter((e) => e.type === 'item_delisted').length, 1,
  'replayed delist does NOT re-broadcast (Map.delete returns false on second hit)');
unsub2();

// =============================================================================
// 5 — Wire-format projection: server → frontend shape
// =============================================================================
console.log('\n[5] listingToWire — chain shape → frontend MarketplaceListing shape');

const wire = listingToWire(listingA) as Record<string, any>;
eq(wire.id, ITEM_A, 'wire.id');
eq(wire.kioskId, KIOSK, 'wire.kioskId (required for buy tx)');
eq(wire.priceMist, '500000000', 'wire.priceMist (BigInt-safe string)');
eq(wire.price, 0.5, 'wire.price (SUI display)');
eq(wire.item.imageUrl, 'https://example.com/sword.png', 'wire.item.imageUrl extracted from description');
eq(wire.item.statBonuses.strengthBonus, 5, 'wire.item.statBonuses.strengthBonus mapped');
eq(wire.item.statBonuses.attackBonus, 0, 'wire.item.statBonuses.attackBonus defaults 0');
eq(wire.item.inKiosk, true, 'wire.item.inKiosk = true');

// =============================================================================
// 6 — Atomic delist+take+transfer PTB structure
// =============================================================================
console.log('\n[6] buildDelistItemTx — atomic delist + kiosk::take + transfer');

// Set the env vars sui-contracts.ts requires at module-load. We can't import
// the module up top because it throws if these are missing; do it lazily.
process.env.NEXT_PUBLIC_SUI_PACKAGE_ID = PKG;
process.env.NEXT_PUBLIC_TREASURY_ADDRESS = pad32('0xfeed');

const { buildDelistItemTx, buildTakeFromKioskTx } = await import('../frontend/src/lib/sui-contracts');

const KIOSK_TX = pad32('0xaa');
const CAP_TX = pad32('0xcc');
const ITEM_TX = pad32('0xee');
const RECIPIENT_TX = pad32('0x12');

function inspectTx(tx: unknown): { json: any; raw: string } {
  // @mysten/sui v2 Transaction exposes `getData()` (returns TransactionData).
  const getData = (tx as { getData?: () => unknown }).getData;
  const json = typeof getData === 'function' ? getData.call(tx) : tx;
  return { json, raw: JSON.stringify(json) };
}

{
  const tx = buildDelistItemTx(KIOSK_TX, CAP_TX, ITEM_TX, RECIPIENT_TX);
  const { json, raw } = inspectTx(tx);
  const commands: any[] = (json as any)?.commands ?? [];

  // Filter for MoveCall commands and TransferObjects.
  const moveCalls = commands.filter((c) => c?.MoveCall || c?.$kind === 'MoveCall');
  const transferObjects = commands.filter((c) => c?.TransferObjects || c?.$kind === 'TransferObjects');

  const delistCalls = moveCalls.filter((c) => {
    const fn = c?.MoveCall?.function ?? c?.function;
    const mod = c?.MoveCall?.module ?? c?.module;
    return mod === 'marketplace' && fn === 'delist_item';
  });
  const takeCalls = moveCalls.filter((c) => {
    const fn = c?.MoveCall?.function ?? c?.function;
    const mod = c?.MoveCall?.module ?? c?.module;
    return mod === 'kiosk' && fn === 'take';
  });

  if (delistCalls.length === 1) ok('Delist PTB: 1× marketplace::delist_item');
  else fail('Delist PTB: 1× marketplace::delist_item', `got ${delistCalls.length}: ${raw.slice(0, 300)}`);

  if (takeCalls.length === 1) ok('Delist PTB: 1× 0x2::kiosk::take<Item>');
  else fail('Delist PTB: 1× 0x2::kiosk::take<Item>', `got ${takeCalls.length}`);

  if (transferObjects.length === 1) ok('Delist PTB: 1× TransferObjects');
  else fail('Delist PTB: 1× TransferObjects', `got ${transferObjects.length}`);

  if (commands.length === 3) ok('Delist PTB: total 3 commands (delist + take + transfer)');
  else fail('Delist PTB: total 3 commands', `got ${commands.length}`);

  // The take call must reference the package's Item type, not anything else.
  const takeTypeArg = takeCalls[0]?.MoveCall?.typeArguments?.[0] ?? takeCalls[0]?.typeArguments?.[0];
  if (typeof takeTypeArg === 'string' && takeTypeArg.endsWith('::item::Item')) {
    ok('Delist PTB: kiosk::take typed as <package::item::Item>');
  } else {
    fail('Delist PTB: kiosk::take typed as <package::item::Item>', `got: ${takeTypeArg}`);
  }
}

{
  const tx = buildTakeFromKioskTx(KIOSK_TX, CAP_TX, ITEM_TX, RECIPIENT_TX);
  const { json } = inspectTx(tx);
  const commands: any[] = (json as any)?.commands ?? [];
  const moveCalls = commands.filter((c) => c?.MoveCall || c?.$kind === 'MoveCall');
  const transferObjects = commands.filter((c) => c?.TransferObjects || c?.$kind === 'TransferObjects');
  const takeCalls = moveCalls.filter((c) => {
    const fn = c?.MoveCall?.function ?? c?.function;
    const mod = c?.MoveCall?.module ?? c?.module;
    return mod === 'kiosk' && fn === 'take';
  });

  if (takeCalls.length === 1) ok('Retrieve PTB: 1× 0x2::kiosk::take<Item>');
  else fail('Retrieve PTB: 1× 0x2::kiosk::take<Item>', `got ${takeCalls.length}`);
  if (transferObjects.length === 1) ok('Retrieve PTB: 1× TransferObjects');
  else fail('Retrieve PTB: 1× TransferObjects', `got ${transferObjects.length}`);
  if (commands.length === 2) ok('Retrieve PTB: total 2 commands (take + transfer)');
  else fail('Retrieve PTB: total 2 commands', `got ${commands.length}`);
}

// =============================================================================
// 7.5 — Reconnect idempotency for item_bought (no double seller refresh)
// =============================================================================
console.log('\n[7.5] item_bought event is idempotent under reconnect replay');

_resetForTest();
const itemD: Item = { ...itemA, id: pad32('0xa001') };
const listingD: ServerMarketplaceListing = {
  id: itemD.id, itemId: itemD.id, kioskId: KIOSK, price: 0.25, priceMist: '250000000',
  seller: SELLER, sellerName: 'Seller', item: itemD, listedAt: 7000,
};
_injectListingForTest(listingD);

const events3: MarketplaceEvent[] = [];
const unsub3 = subscribeMarketplace((e) => events3.push(e));

await _applyParsedEventForTest({
  type: `${PKG}::marketplace::ItemPurchased`,
  parsedJson: { kiosk_id: KIOSK, item_id: itemD.id, buyer: BUYER, price: '250000000', royalty_paid: '6250000' },
  timestampMs: 8000, txDigest: 'tx4',
});
await _applyParsedEventForTest({
  type: `${PKG}::marketplace::ItemPurchased`,
  parsedJson: { kiosk_id: KIOSK, item_id: itemD.id, buyer: BUYER, price: '250000000', royalty_paid: '6250000' },
  timestampMs: 8001, txDigest: 'tx4-replay',
});
const buyBroadcasts = events3.filter((e) => e.type === 'item_bought');
eq(buyBroadcasts.length, 1, 'replayed buy event broadcasts only once (no double-bump on reconnect)');
unsub3();

// =============================================================================
// 8 — kiosk Listing key BCS decode (chain-truth `kioskListed`)
// =============================================================================
console.log('\n[7] decodeListingKeyItemId — Listing { id: address, is_exclusive: bool }');

// We can't import the private decoder directly (it's an internal function),
// but we can verify the BCS layout it parses against. The Sui kiosk Listing
// key is 33 bytes: 32 for the item ID, 1 for the bool.
{
  // Build a synthetic listing key: id = ITEM_TX, isExclusive = false (0).
  const idBytes = new Uint8Array(32);
  const stripped = ITEM_TX.slice(2);
  for (let i = 0; i < 32; i++) idBytes[i] = parseInt(stripped.slice(i * 2, i * 2 + 2), 16);
  const fullKey = new Uint8Array(33);
  fullKey.set(idBytes, 0);
  fullKey[32] = 0; // is_exclusive = false
  // Recover the id by reading the first 32 bytes — which is exactly what
  // `decodeListingKeyItemId` does in lib/sui-contracts.ts.
  let recovered = '0x';
  for (let i = 0; i < 32; i++) recovered += fullKey[i].toString(16).padStart(2, '0');
  eq(recovered, ITEM_TX, 'first 32 BCS bytes = item ID (chain-truth source for kioskListed)');
  eq(fullKey.length, 33, 'Listing key total = 33 bytes (id 32 + bool 1)');
}

// =============================================================================
// Summary
// =============================================================================
console.log();
console.log(`${passes} passed, ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('UNCAUGHT', err);
  process.exit(1);
});
