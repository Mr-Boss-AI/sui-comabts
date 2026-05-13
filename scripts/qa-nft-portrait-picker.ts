/**
 * NFT Portrait Picker gauntlet (Phase 2 Step 2, 2026-05-13).
 *
 *   $ cd server && npx tsx ../scripts/qa-nft-portrait-picker.ts
 *
 * Pins the pure helpers in `frontend/src/lib/nft-portrait.ts`:
 *   • Display-field extraction across the two SDK shapes (top-level
 *     `display.data` vs nested `data.display.data`)
 *   • Image URL normalisation (ipfs:// + bare CID + http(s) + empty)
 *   • Portrait-candidate predicate (objectId + image_url OR name)
 *   • Raw-object → NftCandidate conversion
 *   • Filter+map over a mixed list
 *   • Picker state machine (loading / empty / error / ready)
 *   • Selection state machine (pick / clear / reset + canCommit)
 *   • localStorage persistence with wallet-keyed buckets
 *
 * Pure JS, no DB, no WS, no chain, no React. Storage injected via a
 * stub so we test the boundary contract instead of jsdom plumbing.
 */

import {
  PORTRAIT_STORAGE_PREFIX,
  filterPortraitCandidates,
  getDisplayField,
  isPortraitCandidate,
  nextSelectionState,
  normaliseImageUrl,
  pickerStateOf,
  portraitKeyForWallet,
  readPortrait,
  toNftCandidate,
  writePortrait,
  type NftCandidate,
  type PortraitStorage,
  type RawOwnedObject,
  type SelectionState,
} from '../frontend/src/lib/nft-portrait';

let passes = 0;
let failures = 0;
const failureLog: string[] = [];

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  const msg = `${label}\n        ${detail}`;
  failureLog.push(msg);
  console.log(`  \x1b[31mFAIL\x1b[0m ${msg}`);
}
function eq<T>(actual: T, expected: T, label: string): void {
  if (Object.is(actual, expected)) ok(label);
  else
    fail(
      label,
      `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
}
function truthy(value: unknown, label: string): void {
  if (value) ok(label);
  else fail(label, `expected truthy, got ${JSON.stringify(value)}`);
}
function deep(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else
    fail(
      label,
      `\n        actual  =${JSON.stringify(actual)}\n        expected=${JSON.stringify(expected)}`,
    );
}

function mkRaw(
  id: string,
  display: Record<string, string | null> | null,
  type = '0x1::nft::Item',
): RawOwnedObject {
  return {
    objectId: id,
    type,
    display: display === null ? null : { data: display },
  };
}

/** Make a stub that mirrors localStorage's contract enough for the
 *  injected boundary tests. Records writes so the gauntlet can assert
 *  on key + payload. */
function mkStorage(): PortraitStorage & {
  store: Map<string, string>;
  writes: Array<{ key: string; value: string | null }>;
} {
  const store = new Map<string, string>();
  const writes: Array<{ key: string; value: string | null }> = [];
  return {
    store,
    writes,
    getItem(k) {
      return store.has(k) ? (store.get(k) as string) : null;
    },
    setItem(k, v) {
      store.set(k, v);
      writes.push({ key: k, value: v });
    },
    removeItem(k) {
      store.delete(k);
      writes.push({ key: k, value: null });
    },
  };
}

function main(): void {
  // ===========================================================================
  // [1] getDisplayField — top-level + nested SDK shapes
  // ===========================================================================
  console.log('\n[1] getDisplayField — handles both SDK display shapes');
  const top: RawOwnedObject = {
    objectId: '0x1',
    display: { data: { name: 'Top NFT', image_url: 'https://x/y.png' } },
  };
  eq(getDisplayField(top, 'name'), 'Top NFT', 'top-level display.data.name');
  eq(getDisplayField(top, 'image_url'), 'https://x/y.png', 'top-level image_url');
  eq(getDisplayField(top, 'missing'), null, 'missing key → null');

  const nested: RawOwnedObject = {
    objectId: '0x2',
    data: {
      display: { data: { name: 'Nested NFT', description: 'd' } },
    },
  };
  eq(getDisplayField(nested, 'name'), 'Nested NFT', 'nested data.display.data.name');
  eq(getDisplayField(nested, 'description'), 'd', 'nested description');
  eq(getDisplayField(nested, 'image_url'), null, 'nested missing → null');

  const both: RawOwnedObject = {
    objectId: '0x3',
    display: { data: { name: 'Top wins' } },
    data: { display: { data: { name: 'Nested loses' } } },
  };
  eq(getDisplayField(both, 'name'), 'Top wins', 'top wins when both present');

  // ===========================================================================
  // [2] normaliseImageUrl — ipfs/CID/http/empty
  // ===========================================================================
  console.log('\n[2] normaliseImageUrl');
  eq(normaliseImageUrl(''), '', 'empty → empty');
  eq(normaliseImageUrl(null), '', 'null → empty');
  eq(normaliseImageUrl(undefined), '', 'undefined → empty');
  eq(normaliseImageUrl('   '), '', 'whitespace → empty');
  eq(
    normaliseImageUrl('https://example.com/x.png'),
    'https://example.com/x.png',
    'https unchanged',
  );
  eq(
    normaliseImageUrl('http://example.com/x.png'),
    'http://example.com/x.png',
    'http unchanged',
  );
  eq(
    normaliseImageUrl('ipfs://bafyABC/img.png'),
    'https://gateway.pinata.cloud/ipfs/bafyABC/img.png',
    'ipfs:// → Pinata gateway',
  );
  eq(
    normaliseImageUrl('bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy'),
    'https://gateway.pinata.cloud/ipfs/bafybeiarz5gk3selzpjclugdl2odmvdtbtvi7gtky65m7chkyjymci3yfy',
    'bare bafy CID → Pinata gateway',
  );
  eq(
    normaliseImageUrl('QmTzQ1Ngy5K8BVqq5T7FmPbY3RjcDQzZGTtGmCfYFc1ABC'),
    'https://gateway.pinata.cloud/ipfs/QmTzQ1Ngy5K8BVqq5T7FmPbY3RjcDQzZGTtGmCfYFc1ABC',
    'bare Qm CID → Pinata gateway',
  );
  eq(
    normaliseImageUrl('  https://x/y.png  '),
    'https://x/y.png',
    'whitespace trimmed before scheme check',
  );

  // ===========================================================================
  // [3] isPortraitCandidate — qualification predicate
  // ===========================================================================
  console.log('\n[3] isPortraitCandidate');
  eq(
    isPortraitCandidate(mkRaw('0xa1', { name: 'N', image_url: 'https://x/y' })),
    true,
    'has both name + image → candidate',
  );
  eq(
    isPortraitCandidate(mkRaw('0xa2', { name: 'Only name' })),
    true,
    'has name only → candidate (renders as name on gunmetal)',
  );
  eq(
    isPortraitCandidate(mkRaw('0xa3', { image_url: 'https://x/y' })),
    true,
    'has image only → candidate',
  );
  eq(
    isPortraitCandidate(mkRaw('0xa4', {})),
    false,
    'no name + no image → not a candidate',
  );
  eq(
    isPortraitCandidate(mkRaw('0xa5', { name: '   ', image_url: '   ' })),
    false,
    'whitespace-only fields → not a candidate',
  );
  eq(
    isPortraitCandidate(mkRaw('', { name: 'N' })),
    false,
    'empty objectId → not a candidate',
  );
  eq(
    isPortraitCandidate({ objectId: '0xb1', data: { objectId: '0xb1', display: { data: { name: 'N' } } } }),
    true,
    'nested data.display shape qualifies',
  );

  // ===========================================================================
  // [4] toNftCandidate — full conversion
  // ===========================================================================
  console.log('\n[4] toNftCandidate');
  const c = toNftCandidate(
    mkRaw('0xabc1234', { name: 'Skullcrusher Maul', image_url: 'ipfs://bafy/img.png' }, '0xpkg::item::Item'),
  );
  truthy(c, 'returns non-null for valid input');
  eq(c?.objectId, '0xabc1234', 'objectId copied');
  eq(c?.name, 'Skullcrusher Maul', 'name copied');
  eq(
    c?.imageUrl,
    'https://gateway.pinata.cloud/ipfs/bafy/img.png',
    'image normalised',
  );
  eq(c?.typeTag, '0xpkg::item::Item', 'typeTag copied');

  const fallbackName = toNftCandidate(
    mkRaw('0x0000aaaa1111bbbb', { image_url: 'https://x/y.png' }),
  );
  truthy(fallbackName?.name?.startsWith('NFT 0x0000aaaa'), 'fallback name uses prefix');

  eq(toNftCandidate(mkRaw('0xnone', {})), null, 'invalid input → null');

  // ===========================================================================
  // [5] filterPortraitCandidates — order preserved + filters work
  // ===========================================================================
  console.log('\n[5] filterPortraitCandidates');
  const raw: RawOwnedObject[] = [
    mkRaw('0x1', { name: 'A', image_url: 'https://x/a.png' }),
    mkRaw('0x2', {}), // dropped — no name/image
    mkRaw('0x3', { name: 'B' }),
    mkRaw('', { name: 'no id' }), // dropped — empty objectId
    mkRaw('0x4', { image_url: 'ipfs://CID' }),
  ];
  const filtered = filterPortraitCandidates(raw);
  eq(filtered.length, 3, '3 of 5 qualify');
  eq(filtered[0].objectId, '0x1', 'order preserved (0x1 first)');
  eq(filtered[1].objectId, '0x3', 'order preserved (0x3 second)');
  eq(filtered[2].objectId, '0x4', 'order preserved (0x4 third)');
  eq(filtered[0].name, 'A', 'A name carried');
  eq(filtered[1].imageUrl, '', 'name-only entry has empty imageUrl');
  truthy(
    filtered[2].imageUrl.startsWith('https://gateway.pinata.cloud/'),
    'ipfs:// normalised to gateway',
  );

  eq(filterPortraitCandidates([]).length, 0, 'empty input → empty result');

  // ===========================================================================
  // [6] pickerStateOf — render-slot decision
  // ===========================================================================
  console.log('\n[6] pickerStateOf');
  eq(
    pickerStateOf({ isLoading: true, error: null, candidates: [] }),
    'loading',
    'loading wins everything',
  );
  eq(
    pickerStateOf({ isLoading: true, error: 'x', candidates: [] }),
    'loading',
    'loading wins over error too',
  );
  eq(
    pickerStateOf({ isLoading: false, error: 'rpc died', candidates: [] }),
    'error',
    'error when not loading',
  );
  eq(
    pickerStateOf({ isLoading: false, error: null, candidates: [] }),
    'empty',
    'empty when no error + no candidates',
  );
  const mockCandidate: NftCandidate = {
    objectId: '0x1',
    name: 'C',
    imageUrl: '',
    typeTag: '',
  };
  eq(
    pickerStateOf({ isLoading: false, error: null, candidates: [mockCandidate] }),
    'ready',
    'ready when not loading + no error + ≥1 candidate',
  );
  eq(
    pickerStateOf({ isLoading: false, error: 'err', candidates: [mockCandidate] }),
    'error',
    'error wins even when candidates exist (server returned stale list)',
  );

  // ===========================================================================
  // [7] nextSelectionState — pick / clear / reset
  // ===========================================================================
  console.log('\n[7] nextSelectionState');
  const itemA: NftCandidate = { objectId: '0xA', name: 'A', imageUrl: '', typeTag: '' };
  const itemB: NftCandidate = { objectId: '0xB', name: 'B', imageUrl: '', typeTag: '' };
  const empty: SelectionState = { staged: null, canCommit: false };

  // pick when nothing saved
  deep(
    nextSelectionState(empty, { kind: 'pick', item: itemA }, null),
    { staged: itemA, canCommit: true },
    'pick (no saved) → canCommit',
  );
  // pick when same as saved
  deep(
    nextSelectionState(empty, { kind: 'pick', item: itemA }, itemA),
    { staged: itemA, canCommit: false },
    'pick same as saved → !canCommit',
  );
  // pick when different from saved
  deep(
    nextSelectionState(empty, { kind: 'pick', item: itemB }, itemA),
    { staged: itemB, canCommit: true },
    'pick different from saved → canCommit',
  );
  // pick replaces previous staged
  const staged: SelectionState = { staged: itemA, canCommit: true };
  deep(
    nextSelectionState(staged, { kind: 'pick', item: itemB }, null),
    { staged: itemB, canCommit: true },
    'pick replaces prior staged',
  );

  // clear when saved is null → no-op
  deep(
    nextSelectionState(empty, { kind: 'clear' }, null),
    { staged: null, canCommit: false },
    'clear with nothing saved → !canCommit',
  );
  // clear when saved is non-null → commit is meaningful
  deep(
    nextSelectionState(staged, { kind: 'clear' }, itemA),
    { staged: null, canCommit: true },
    'clear with saved → canCommit',
  );

  // reset
  deep(
    nextSelectionState(staged, { kind: 'reset', saved: itemB }, itemB),
    { staged: itemB, canCommit: false },
    'reset → staged = saved, !canCommit',
  );
  deep(
    nextSelectionState(staged, { kind: 'reset', saved: null }, null),
    { staged: null, canCommit: false },
    'reset to null',
  );

  // ===========================================================================
  // [8] portraitKeyForWallet — canonical bucket per wallet
  // ===========================================================================
  console.log('\n[8] portraitKeyForWallet');
  eq(
    portraitKeyForWallet('0xABCdef'),
    `${PORTRAIT_STORAGE_PREFIX}:0xabcdef`,
    'lowercases address',
  );
  eq(
    portraitKeyForWallet('0xabcdef'),
    `${PORTRAIT_STORAGE_PREFIX}:0xabcdef`,
    'already-lowercase passes through',
  );
  eq(
    portraitKeyForWallet(null),
    `${PORTRAIT_STORAGE_PREFIX}:anon`,
    'null → anon bucket',
  );
  eq(
    portraitKeyForWallet(undefined),
    `${PORTRAIT_STORAGE_PREFIX}:anon`,
    'undefined → anon bucket',
  );
  eq(
    portraitKeyForWallet(''),
    `${PORTRAIT_STORAGE_PREFIX}:anon`,
    'empty → anon bucket',
  );
  truthy(
    portraitKeyForWallet('0xABCdef') === portraitKeyForWallet('0xabcdef'),
    'case-folding makes mixed/lower equivalent',
  );

  // ===========================================================================
  // [9] readPortrait — happy path + bad data tolerance
  // ===========================================================================
  console.log('\n[9] readPortrait');
  const s9 = mkStorage();
  // empty store
  eq(readPortrait(s9, '0xa'), null, 'no entry → null');
  // good payload
  const good: NftCandidate = {
    objectId: '0xobj',
    name: 'Test NFT',
    imageUrl: 'https://x/y.png',
    typeTag: '0xpkg::nft::Token',
  };
  s9.store.set(portraitKeyForWallet('0xa'), JSON.stringify(good));
  deep(readPortrait(s9, '0xa'), good, 'round-trip from JSON');
  // malformed JSON
  s9.store.set(portraitKeyForWallet('0xa'), '{not json');
  eq(readPortrait(s9, '0xa'), null, 'malformed JSON → null (no throw)');
  // missing required fields
  s9.store.set(portraitKeyForWallet('0xa'), '{"name":"only name"}');
  eq(readPortrait(s9, '0xa'), null, 'missing objectId → null');
  s9.store.set(portraitKeyForWallet('0xa'), '{"objectId":"0xx"}');
  eq(readPortrait(s9, '0xa'), null, 'missing name → null');
  // payload with missing optional fields fills with empties
  s9.store.set(
    portraitKeyForWallet('0xa'),
    '{"objectId":"0x1","name":"N"}',
  );
  const minimal = readPortrait(s9, '0xa');
  eq(minimal?.objectId, '0x1', 'minimal payload restored: objectId');
  eq(minimal?.name, 'N', 'minimal payload restored: name');
  eq(minimal?.imageUrl, '', 'missing imageUrl → empty string');
  eq(minimal?.typeTag, '', 'missing typeTag → empty string');

  // ===========================================================================
  // [10] writePortrait — happy / clear / wallet isolation
  // ===========================================================================
  console.log('\n[10] writePortrait');
  const s10 = mkStorage();
  writePortrait(s10, '0xa', good);
  eq(s10.writes.length, 1, 'one write op');
  eq(s10.writes[0].key, portraitKeyForWallet('0xa'), 'wrote to wallet-keyed bucket');
  truthy(s10.writes[0].value && s10.writes[0].value.includes('"name":"Test NFT"'), 'serialised name');

  // clear via null
  writePortrait(s10, '0xa', null);
  eq(s10.writes.length, 2, 'second op recorded');
  eq(s10.writes[1].value, null, 'null write = removeItem');
  eq(s10.store.has(portraitKeyForWallet('0xa')), false, 'storage cleared');

  // ===========================================================================
  // [11] Wallet isolation — two wallets in same browser
  // ===========================================================================
  console.log('\n[11] wallet isolation — two wallets in same storage');
  const s11 = mkStorage();
  const wallet1 = '0x06d6cb677518cc70884df24541d91d7a1d2ca5db';
  const wallet2 = '0xd05ae8e26e9c239b4888822c83046fe7adaac243';
  const portraitA: NftCandidate = { objectId: '0x1', name: 'Mr_Boss portrait', imageUrl: '', typeTag: '' };
  const portraitB: NftCandidate = { objectId: '0x2', name: 'Sx portrait', imageUrl: '', typeTag: '' };
  writePortrait(s11, wallet1, portraitA);
  writePortrait(s11, wallet2, portraitB);
  deep(readPortrait(s11, wallet1), portraitA, 'wallet1 reads back its own');
  deep(readPortrait(s11, wallet2), portraitB, 'wallet2 reads back its own');
  truthy(
    portraitKeyForWallet(wallet1) !== portraitKeyForWallet(wallet2),
    'wallets have different storage keys',
  );

  // Clearing wallet1 leaves wallet2 intact
  writePortrait(s11, wallet1, null);
  eq(readPortrait(s11, wallet1), null, 'wallet1 cleared');
  deep(readPortrait(s11, wallet2), portraitB, 'wallet2 unaffected');

  // ===========================================================================
  // [12] Storage failure tolerance — quota / disabled / SSR
  // ===========================================================================
  console.log('\n[12] storage failure tolerance');
  const brokenStorage: PortraitStorage = {
    getItem() {
      throw new Error('SecurityError: storage disabled');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {
      throw new Error('SecurityError');
    },
  };
  // Read should swallow + return null
  eq(readPortrait(brokenStorage, '0xa'), null, 'thrown getItem → null (no crash)');
  // Write should not throw
  let threw = false;
  try {
    writePortrait(brokenStorage, '0xa', good);
  } catch {
    threw = true;
  }
  eq(threw, false, 'thrown setItem → silent fail (no crash)');
  threw = false;
  try {
    writePortrait(brokenStorage, '0xa', null);
  } catch {
    threw = true;
  }
  eq(threw, false, 'thrown removeItem → silent fail (no crash)');

  // ===========================================================================
  // [13] End-to-end picker scenario — wallet selects, refreshes, picks again
  // ===========================================================================
  console.log('\n[13] end-to-end scenario');
  const s13 = mkStorage();
  const wallet = '0xMR_BOSS';
  const inventory: RawOwnedObject[] = [
    mkRaw('0x1', { name: 'Bloodletter Gauntlets', image_url: 'ipfs://bafy/glove.png' }),
    mkRaw('0x2', { name: 'Shadowstep Wraps', image_url: 'ipfs://bafy/wraps.png' }),
    mkRaw('0x3', {}), // junk object — filtered out
    mkRaw('0x4', { name: 'Pendant of Wrath', image_url: 'ipfs://bafy/pend.png' }),
  ];
  const candidates = filterPortraitCandidates(inventory);
  eq(candidates.length, 3, 'inventory → 3 candidates (junk dropped)');

  // Initial state — no saved portrait
  let saved = readPortrait(s13, wallet);
  eq(saved, null, 'first open → no saved portrait');
  let sel: SelectionState = { staged: saved, canCommit: false };

  // User picks Bloodletter Gauntlets
  sel = nextSelectionState(sel, { kind: 'pick', item: candidates[0] }, saved);
  eq(sel.staged?.objectId, '0x1', 'staged Bloodletter');
  eq(sel.canCommit, true, 'differs from saved (null) → canCommit');

  // Commit → write to storage
  writePortrait(s13, wallet, sel.staged);
  saved = readPortrait(s13, wallet);
  deep(saved, candidates[0], 'persisted Bloodletter');

  // Page reload — modal re-mounts with current=saved
  sel = { staged: saved, canCommit: false };
  // User picks the same — no commit
  sel = nextSelectionState(sel, { kind: 'pick', item: candidates[0] }, saved);
  eq(sel.canCommit, false, 'picking the same → !canCommit');

  // User picks a different one
  sel = nextSelectionState(sel, { kind: 'pick', item: candidates[1] }, saved);
  eq(sel.staged?.objectId, '0x2', 'switched to Shadowstep');
  eq(sel.canCommit, true, 'switch is committable');

  // User clicks Clear instead
  sel = nextSelectionState(sel, { kind: 'clear' }, saved);
  eq(sel.staged, null, 'clear stages null');
  eq(sel.canCommit, true, 'clear is committable since saved is non-null');

  // Commit clear → storage emptied
  writePortrait(s13, wallet, sel.staged);
  eq(readPortrait(s13, wallet), null, 'storage cleared');

  // Wallet B picks something — must not affect wallet A
  writePortrait(s13, '0xSX', candidates[2]);
  deep(readPortrait(s13, '0xSX'), candidates[2], 'wallet B saved');
  eq(readPortrait(s13, wallet), null, 'wallet A still null');

  // ===========================================================================
  // [14] Purity guards — input lists are not mutated
  // ===========================================================================
  console.log('\n[14] purity / immutability guards');
  const purityRaw: RawOwnedObject[] = [
    mkRaw('0x1', { name: 'A' }),
    mkRaw('0x2', { name: 'B' }),
  ];
  const snap = JSON.stringify(purityRaw);
  void filterPortraitCandidates(purityRaw);
  eq(
    JSON.stringify(purityRaw),
    snap,
    'filterPortraitCandidates does not mutate input',
  );
  void toNftCandidate(purityRaw[0]);
  eq(JSON.stringify(purityRaw), snap, 'toNftCandidate does not mutate input');

  // pickerStateOf + nextSelectionState produce new objects
  const baseSel: SelectionState = { staged: null, canCommit: false };
  const next = nextSelectionState(baseSel, { kind: 'pick', item: candidates[0] }, null);
  truthy(next !== baseSel, 'nextSelectionState returns a new object');

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n' + '='.repeat(60));
  console.log(`NFT Portrait Picker gauntlet: ${passes} passes / ${failures} failures`);
  console.log('='.repeat(60));
  if (failures > 0) {
    console.log('\nFAILURES:');
    for (const f of failureLog) console.log('  ' + f);
    process.exit(1);
  }
}

main();
