/**
 * Slot-picker gauntlet (live test 2026-05-03).
 *
 *   $ cd server && npx tsx ../scripts/qa-equip-picker.ts
 *
 * Mr_Boss (Lv4 crit) clicked the weapon slot on the doll. The picker
 * showed three Common weapons. His Epic Cursed Greatsword (Lv5
 * required) was missing entirely — silently filtered out by
 * `item.levelReq <= effectiveLevel`. Compare with the inventory-click
 * flow, where the same weapon opens a detail modal showing "Requires
 * Level 5" and a List-on-Marketplace button. Same data, completely
 * different player feeling. The fix: never drop locked items, render
 * them dimmed with a "Lv N" badge instead.
 *
 * `buildSlotPickerEntries` owns selection + sort. This gauntlet pins
 * every rule: deduplication, kiosk filtering, pending-equipped
 * exclusion, slot-type matching, level-lock annotation, and stable
 * sort ordering. Pure function, no chain or DB calls.
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  buildSlotPickerEntries,
  type PickerEntry,
} from '../frontend/src/lib/equipment-picker';
import type { EquipmentSlots, Item, ItemType, Rarity } from '../frontend/src/types/game';
import { ITEM_TYPES } from '../frontend/src/types/game';

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
  else fail(label, `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}
function deepEq<T>(actual: T, expected: T, label: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label);
  else fail(label, `\n          actual=${JSON.stringify(actual)}\n          expected=${JSON.stringify(expected)}`);
}

// -- fixture builder ---------------------------------------------------------

const ZERO_BONUSES: Item['statBonuses'] = {
  strengthBonus: 0,
  dexterityBonus: 0,
  intuitionBonus: 0,
  enduranceBonus: 0,
  hpBonus: 0,
  armorBonus: 0,
  defenseBonus: 0,
  attackBonus: 0,
  critChanceBonus: 0,
  critMultiplierBonus: 0,
  evasionBonus: 0,
  antiCritBonus: 0,
  antiEvasionBonus: 0,
};

function mkItem(overrides: Partial<Item> & Pick<Item, 'id' | 'name' | 'itemType'>): Item {
  return {
    classReq: 0,
    levelReq: 1,
    rarity: 1 as Rarity,
    statBonuses: ZERO_BONUSES,
    minDamage: 0,
    maxDamage: 0,
    ...overrides,
  } as Item;
}

const WEAPON: ItemType = ITEM_TYPES.WEAPON;
const SHIELD: ItemType = ITEM_TYPES.SHIELD;
const HELMET: ItemType = ITEM_TYPES.HELMET;
const CHEST: ItemType = ITEM_TYPES.CHEST;
const GLOVES: ItemType = ITEM_TYPES.GLOVES;
const BOOTS: ItemType = ITEM_TYPES.BOOTS;
const BELT: ItemType = ITEM_TYPES.BELT;
const RING: ItemType = ITEM_TYPES.RING;
const NECKLACE: ItemType = ITEM_TYPES.NECKLACE;

const ALL_SLOTS: (keyof EquipmentSlots)[] = [
  'weapon', 'offhand', 'helmet', 'chest', 'gloves', 'boots',
  'belt', 'ring1', 'ring2', 'necklace',
];

function names(entries: PickerEntry[]): string[] {
  return entries.map((e) => e.item.name);
}

function main(): void {
  // ===========================================================================
  // 1 — empty inputs
  // ===========================================================================
  console.log('\n[1] Empty inputs');
  eq(buildSlotPickerEntries('weapon', [], [], new Set(), 5).length, 0,
     'no items → []');
  eq(buildSlotPickerEntries('weapon', [], [], new Set(), 0).length, 0,
     'level 0 with no items → []');

  // ===========================================================================
  // 2 — ⚡ THE BUG: locked items are KEPT, not dropped
  // ===========================================================================
  console.log('\n[2] Locked items are kept and annotated (the actual bug fix)');
  const mrBossWeapons = [
    mkItem({ id: '0xa', name: 'Cursed Greatsword', itemType: WEAPON, levelReq: 5, rarity: 4 }),
    mkItem({ id: '0xb', name: 'Parrying Dirk',     itemType: WEAPON, levelReq: 2 }),
    mkItem({ id: '0xc', name: 'Longsword',         itemType: WEAPON, levelReq: 2 }),
    mkItem({ id: '0xd', name: 'Short Rusty Sword', itemType: WEAPON, levelReq: 1 }),
  ];
  const lv4 = buildSlotPickerEntries('weapon', mrBossWeapons, [], new Set(), 4);
  eq(lv4.length, 4, 'Lv4 player → 4 weapons returned (3 unlocked + 1 locked, NOT 3)');
  eq(lv4.filter((e) => !e.locked).length, 3, '3 unlocked');
  eq(lv4.filter((e) => e.locked).length, 1, '1 locked (the Cursed Greatsword)');
  const cursed = lv4.find((e) => e.item.name === 'Cursed Greatsword');
  if (!cursed) {
    fail('Cursed Greatsword present', 'not found');
  } else {
    ok('Cursed Greatsword present');
    eq(cursed.locked, true, 'Cursed Greatsword.locked === true');
    eq(cursed.lockedReason, 'Requires Level 5', 'lockedReason = "Requires Level 5"');
  }

  // ===========================================================================
  // 3 — sort order: unlocked first (alpha), then locked (asc level, alpha)
  // ===========================================================================
  console.log('\n[3] Sort order — unlocked first (alpha), then locked (asc level, alpha)');
  deepEq(names(lv4),
    ['Longsword', 'Parrying Dirk', 'Short Rusty Sword', 'Cursed Greatsword'],
    'Lv4 sort: 3 unlocked alpha, then locked');

  const mixedLocks = [
    mkItem({ id: '1', name: 'Zeta Blade',  itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '2', name: 'Alpha Blade', itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '3', name: 'Mythic Edge', itemType: WEAPON, levelReq: 9 }),
    mkItem({ id: '4', name: 'Hero Edge',   itemType: WEAPON, levelReq: 9 }),
    mkItem({ id: '5', name: 'Dawn Edge',   itemType: WEAPON, levelReq: 7 }),
    mkItem({ id: '6', name: 'Mid Sword',   itemType: WEAPON, levelReq: 5 }),
  ];
  deepEq(names(buildSlotPickerEntries('weapon', mixedLocks, [], new Set(), 4)),
    ['Alpha Blade', 'Zeta Blade', 'Mid Sword', 'Dawn Edge', 'Hero Edge', 'Mythic Edge'],
    'unlocked alpha → Lv5 → Lv7 → Lv9 (alpha within ties)');
  deepEq(names(buildSlotPickerEntries('weapon', mixedLocks, [], new Set(), 9)),
    ['Alpha Blade', 'Dawn Edge', 'Hero Edge', 'Mid Sword', 'Mythic Edge', 'Zeta Blade'],
    'all unlocked at Lv9 → pure alpha');
  deepEq(names(buildSlotPickerEntries('weapon', mixedLocks, [], new Set(), 0)),
    ['Alpha Blade', 'Zeta Blade', 'Mid Sword', 'Dawn Edge', 'Hero Edge', 'Mythic Edge'],
    'lv0: only the Lv1s are unlocked, rest cascaded asc');

  // ===========================================================================
  // 4 — kiosk filter: listed AND unlisted-but-stuck are excluded
  // ===========================================================================
  console.log('\n[4] Kiosk filter (listed and parked-but-unlisted both excluded)');
  const withKiosk = [
    mkItem({ id: '1', name: 'Free',               itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '2', name: 'Listed',             itemType: WEAPON, levelReq: 1, inKiosk: true, kioskListed: true }),
    mkItem({ id: '3', name: 'Stuck',              itemType: WEAPON, levelReq: 1, inKiosk: true, kioskListed: false }),
  ];
  deepEq(names(buildSlotPickerEntries('weapon', withKiosk, [], new Set(), 5)),
    ['Free'], 'kiosk items filtered (listed + stuck both)');

  // Locked items in kiosk are also filtered (kiosk takes precedence).
  const lockedAndInKiosk = [
    mkItem({ id: '1', name: 'Free',         itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '2', name: 'Locked Listed', itemType: WEAPON, levelReq: 9, inKiosk: true, kioskListed: true }),
  ];
  deepEq(names(buildSlotPickerEntries('weapon', lockedAndInKiosk, [], new Set(), 4)),
    ['Free'], 'locked-AND-listed item is filtered (kiosk first)');

  // ===========================================================================
  // 5 — pending-equipped exclusion
  // ===========================================================================
  console.log('\n[5] Items already in pendingEquipment are excluded');
  const inv = [
    mkItem({ id: '1', name: 'A', itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '2', name: 'B', itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '3', name: 'C', itemType: WEAPON, levelReq: 1 }),
  ];
  deepEq(names(buildSlotPickerEntries('weapon', inv, [], new Set(['2']), 5)),
    ['A', 'C'], 'item id=2 already pending → excluded');
  deepEq(names(buildSlotPickerEntries('weapon', inv, [], new Set(['1', '2', '3']), 5)),
    [], 'all pending → []');
  // Even locked items still respect pending exclusion.
  const lockedPending = [
    mkItem({ id: '1', name: 'Locked A', itemType: WEAPON, levelReq: 9 }),
    mkItem({ id: '2', name: 'Locked B', itemType: WEAPON, levelReq: 9 }),
  ];
  deepEq(names(buildSlotPickerEntries('weapon', lockedPending, [], new Set(['1']), 4)),
    ['Locked B'], 'locked item already pending → excluded');

  // ===========================================================================
  // 6 — slot-type matching: only items satisfying SLOT_TO_ITEM_TYPE pass
  // ===========================================================================
  console.log('\n[6] Slot-type matching (every slot maps to expected types)');
  const oneOfEach = [
    mkItem({ id: '1',  name: 'W',  itemType: WEAPON,   levelReq: 1 }),
    mkItem({ id: '2',  name: 'S',  itemType: SHIELD,   levelReq: 1 }),
    mkItem({ id: '3',  name: 'H',  itemType: HELMET,   levelReq: 1 }),
    mkItem({ id: '4',  name: 'C',  itemType: CHEST,    levelReq: 1 }),
    mkItem({ id: '5',  name: 'G',  itemType: GLOVES,   levelReq: 1 }),
    mkItem({ id: '6',  name: 'B',  itemType: BOOTS,    levelReq: 1 }),
    mkItem({ id: '7',  name: 'Bt', itemType: BELT,     levelReq: 1 }),
    mkItem({ id: '8',  name: 'R',  itemType: RING,     levelReq: 1 }),
    mkItem({ id: '9',  name: 'N',  itemType: NECKLACE, levelReq: 1 }),
  ];
  deepEq(names(buildSlotPickerEntries('weapon',   oneOfEach, [], new Set(), 5)), ['W'],     'weapon → WEAPON only');
  // offhand accepts SHIELD + WEAPON (dual-wield)
  deepEq(names(buildSlotPickerEntries('offhand',  oneOfEach, [], new Set(), 5)), ['S', 'W'], 'offhand → SHIELD + WEAPON');
  deepEq(names(buildSlotPickerEntries('helmet',   oneOfEach, [], new Set(), 5)), ['H'],      'helmet → HELMET');
  deepEq(names(buildSlotPickerEntries('chest',    oneOfEach, [], new Set(), 5)), ['C'],      'chest → CHEST');
  deepEq(names(buildSlotPickerEntries('gloves',   oneOfEach, [], new Set(), 5)), ['G'],      'gloves → GLOVES');
  deepEq(names(buildSlotPickerEntries('boots',    oneOfEach, [], new Set(), 5)), ['B'],      'boots → BOOTS');
  deepEq(names(buildSlotPickerEntries('belt',     oneOfEach, [], new Set(), 5)), ['Bt'],     'belt → BELT');
  deepEq(names(buildSlotPickerEntries('ring1',    oneOfEach, [], new Set(), 5)), ['R'],      'ring1 → RING');
  deepEq(names(buildSlotPickerEntries('ring2',    oneOfEach, [], new Set(), 5)), ['R'],      'ring2 → RING (same set)');
  deepEq(names(buildSlotPickerEntries('necklace', oneOfEach, [], new Set(), 5)), ['N'],      'necklace → NECKLACE');

  // ===========================================================================
  // 7 — every slot is non-throwing for an empty inventory (sanity coverage)
  // ===========================================================================
  console.log('\n[7] All 10 slots safe with empty inventory');
  for (const s of ALL_SLOTS) {
    eq(buildSlotPickerEntries(s, [], [], new Set(), 5).length, 0, `${s} → []`);
  }

  // ===========================================================================
  // 8 — dedup: on-chain wins over server inventory (same id)
  // ===========================================================================
  console.log('\n[8] Dedup by id — on-chain wins on conflict');
  const serverV = mkItem({ id: '0xS', name: 'Server Sword', itemType: WEAPON, levelReq: 1 });
  const chainV  = mkItem({ id: '0xS', name: 'Chain Sword',  itemType: WEAPON, levelReq: 5 });
  const merged  = buildSlotPickerEntries('weapon', [serverV], [chainV], new Set(), 4);
  eq(merged.length, 1, 'one entry after dedup');
  eq(merged[0]?.item.name, 'Chain Sword', 'on-chain version wins');
  eq(merged[0]?.locked, true, 'chain version Lv5 → locked at Lv4');

  // No conflict → both pass through, sorted.
  const serverOnly = mkItem({ id: '0xS', name: 'Server Only', itemType: WEAPON, levelReq: 1 });
  const chainOnly  = mkItem({ id: '0xC', name: 'Chain Only',  itemType: WEAPON, levelReq: 1 });
  deepEq(names(buildSlotPickerEntries('weapon', [serverOnly], [chainOnly], new Set(), 5)),
    ['Chain Only', 'Server Only'], 'distinct ids both present');

  // ===========================================================================
  // 9 — boundary: levelReq === effectiveLevel is unlocked
  // ===========================================================================
  console.log('\n[9] Boundary: levelReq <= effectiveLevel is unlocked');
  const exact = [mkItem({ id: '1', name: 'Exact', itemType: WEAPON, levelReq: 5 })];
  eq(buildSlotPickerEntries('weapon', exact, [], new Set(), 5)[0]?.locked, false,
     'levelReq=5, level=5 → unlocked');
  eq(buildSlotPickerEntries('weapon', exact, [], new Set(), 4)[0]?.locked, true,
     'levelReq=5, level=4 → locked');
  eq(buildSlotPickerEntries('weapon', exact, [], new Set(), 6)[0]?.locked, false,
     'levelReq=5, level=6 → unlocked');

  // ===========================================================================
  // 10 — `lockedReason` only present when locked === true
  // ===========================================================================
  console.log('\n[10] lockedReason invariant');
  const mix = [
    mkItem({ id: '1', name: 'Free',   itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '2', name: 'Locked', itemType: WEAPON, levelReq: 9 }),
  ];
  const result = buildSlotPickerEntries('weapon', mix, [], new Set(), 4);
  const free = result.find((e) => e.item.name === 'Free')!;
  const lck  = result.find((e) => e.item.name === 'Locked')!;
  eq(free.locked, false, 'Free.locked === false');
  eq(free.lockedReason, undefined, 'Free.lockedReason === undefined');
  eq(lck.locked, true, 'Locked.locked === true');
  eq(lck.lockedReason, 'Requires Level 9', 'Locked.lockedReason is exact string');

  // ===========================================================================
  // 11 — wrong-slot items: chest in weapon slot is dropped
  // ===========================================================================
  console.log('\n[11] Wrong-slot items dropped');
  const wrongSlot = [
    mkItem({ id: '1', name: 'A Sword',  itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '2', name: 'A Helmet', itemType: HELMET, levelReq: 1 }),
    mkItem({ id: '3', name: 'A Chest',  itemType: CHEST,  levelReq: 1 }),
  ];
  deepEq(names(buildSlotPickerEntries('weapon', wrongSlot, [], new Set(), 5)),
    ['A Sword'], 'weapon slot only WEAPON-type');
  deepEq(names(buildSlotPickerEntries('helmet', wrongSlot, [], new Set(), 5)),
    ['A Helmet'], 'helmet slot only HELMET-type');

  // ===========================================================================
  // 12 — input arrays are not mutated (defense against subtle side effects)
  // ===========================================================================
  console.log('\n[12] Input arrays unchanged after sort');
  const original = [
    mkItem({ id: '1', name: 'Zeta',  itemType: WEAPON, levelReq: 1 }),
    mkItem({ id: '2', name: 'Alpha', itemType: WEAPON, levelReq: 1 }),
  ];
  const snapshot = original.map((i) => i.name).join(',');
  buildSlotPickerEntries('weapon', original, [], new Set(), 5);
  eq(original.map((i) => i.name).join(','), snapshot,
     'serverInventory order preserved (sort happens on internal buffer only)');

  // ===========================================================================
  // 12.5 — Two-handed enforcement (Bug 2 Path A, 2026-05-04)
  //
  // Cursed Greatsword + Skullcrusher Maul + Steel Greatsword are 2H —
  // equipping one in `weapon` should grey out the offhand picker; equipping
  // anything in offhand should grey out 2H candidates in the weapon picker.
  // Same locked + reason UX as level-locked items.
  // ===========================================================================
  console.log('\n[12.5] Two-handed conflict locking');

  const EMPTY_EQ: EquipmentSlots = {
    weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
    boots: null, belt: null, ring1: null, ring2: null, necklace: null,
  };
  const greatsword = mkItem({ id: '0xCursed', name: 'Cursed Greatsword', itemType: WEAPON, levelReq: 5 });
  const maul       = mkItem({ id: '0xMaul',   name: 'Skullcrusher Maul', itemType: WEAPON, levelReq: 6 });
  const steelGS    = mkItem({ id: '0xSteel',  name: 'Steel Greatsword',  itemType: WEAPON, levelReq: 5 });
  const oneHand    = mkItem({ id: '0x1H',     name: 'Longsword',         itemType: WEAPON, levelReq: 1 });
  const buckler    = mkItem({ id: '0xBuck',   name: 'Wooden Buckler',    itemType: SHIELD, levelReq: 1 });
  const dirk       = mkItem({ id: '0xDirk',   name: 'Parrying Dirk',     itemType: WEAPON, levelReq: 1 });

  // a) weapon picker, no pendingEquipment passed → backward-compat: 2H rule ignored.
  const noPending = buildSlotPickerEntries('weapon', [greatsword, oneHand], [], new Set(), 9);
  eq(noPending.length, 2, 'no pendingEquipment arg → 2H rule ignored, both candidates returned');
  eq(noPending.filter((e) => e.locked).length, 0, 'nothing locked when arg omitted');

  // b) weapon picker, pending.offhand empty → 2H candidate is unlocked.
  const wp1 = buildSlotPickerEntries('weapon', [greatsword, oneHand], [], new Set(), 9, EMPTY_EQ);
  const cgEntry = wp1.find((e) => e.item.id === '0xCursed')!;
  eq(cgEntry.locked, false, 'weapon slot, no offhand → Cursed Greatsword unlocked');

  // c) weapon picker, pending.offhand has a buckler → 2H candidates LOCKED.
  const wp2 = buildSlotPickerEntries('weapon', [greatsword, maul, steelGS, oneHand], [], new Set(), 9, {
    ...EMPTY_EQ, offhand: buckler,
  });
  eq(wp2.find((e) => e.item.id === '0xCursed')!.locked, true,  'Cursed Greatsword locked when offhand=Buckler');
  eq(wp2.find((e) => e.item.id === '0xMaul')!.locked,   true,  'Skullcrusher Maul locked when offhand=Buckler');
  eq(wp2.find((e) => e.item.id === '0xSteel')!.locked,  true,  'Steel Greatsword locked when offhand=Buckler');
  eq(wp2.find((e) => e.item.id === '0x1H')!.locked,     false, '1-handed Longsword still unlocked');
  const lockedReason = wp2.find((e) => e.item.id === '0xCursed')!.lockedReason ?? '';
  if (lockedReason.toLowerCase().includes('off-hand') || lockedReason.toLowerCase().includes('offhand')) {
    ok(`weapon-slot lockedReason mentions off-hand: "${lockedReason}"`);
  } else {
    fail('weapon-slot lockedReason mentions off-hand', `got: "${lockedReason}"`);
  }

  // d) weapon picker, pending.offhand has a 2nd weapon (dual-wield case) → still locks 2H.
  const wp3 = buildSlotPickerEntries('weapon', [greatsword, oneHand], [], new Set(), 9, {
    ...EMPTY_EQ, offhand: dirk,
  });
  eq(wp3.find((e) => e.item.id === '0xCursed')!.locked, true,
    'dual-wield offhand also blocks 2H mainhand candidates');

  // e) offhand picker, pending.weapon is 2H → ALL candidates locked (both shields + weapons).
  const oh1 = buildSlotPickerEntries('offhand', [buckler, oneHand, dirk], [], new Set(), 9, {
    ...EMPTY_EQ, weapon: maul,
  });
  eq(oh1.length, 3, 'offhand candidates still surface (locked, not hidden)');
  eq(oh1.every((e) => e.locked), true, 'all offhand candidates locked when weapon=2H');
  const ohReason = oh1[0].lockedReason ?? '';
  if (ohReason.toLowerCase().includes('two-handed') || ohReason.toLowerCase().includes('2h') || ohReason.toLowerCase().includes('off-hand')) {
    ok(`offhand-slot lockedReason mentions two-handed: "${ohReason}"`);
  } else {
    fail('offhand-slot lockedReason mentions two-handed', `got: "${ohReason}"`);
  }

  // f) offhand picker, pending.weapon is 1-handed → 1H + shield unlocked.
  //    (2H candidates are filtered separately in case (i) below — case 2 of
  //    the design rule, "2H never goes in offhand".)
  const oh2 = buildSlotPickerEntries('offhand', [buckler, dirk], [], new Set(), 9, {
    ...EMPTY_EQ, weapon: oneHand,
  });
  eq(oh2.every((e) => !e.locked), true, 'offhand unlocked for 1H + shield when weapon=1H');

  // f.i) NEW (2026-05-04 second-direction case) — offhand picker MUST lock 2H
  //      candidates regardless of mainhand state. Closes the gap where
  //      Skullcrusher Maul appeared selectable in the offhand picker even with
  //      a Longsword in mainhand, letting players dual-wield Longsword + Maul.
  const oh1H = buildSlotPickerEntries('offhand', [buckler, dirk, maul, greatsword], [], new Set(), 9, {
    ...EMPTY_EQ, weapon: oneHand,
  });
  eq(oh1H.find((e) => e.item.id === '0xMaul')!.locked,   true,  'Maul locked in offhand when weapon=1H');
  eq(oh1H.find((e) => e.item.id === '0xCursed')!.locked, true,  'Cursed Greatsword locked in offhand when weapon=1H');
  eq(oh1H.find((e) => e.item.id === '0xBuck')!.locked,   false, 'Buckler still unlocked');
  eq(oh1H.find((e) => e.item.id === '0xDirk')!.locked,   false, 'Parrying Dirk still unlocked');
  const ohReason2H = oh1H.find((e) => e.item.id === '0xMaul')!.lockedReason ?? '';
  if (ohReason2H.toLowerCase().includes('weapon slot') || ohReason2H.toLowerCase().includes('mainhand')) {
    ok(`offhand-slot 2H lockedReason directs to weapon slot: "${ohReason2H}"`);
  } else {
    fail('offhand-slot 2H lockedReason directs to weapon slot', `got: "${ohReason2H}"`);
  }

  // f.ii) NEW — 2H locked in offhand even when mainhand is empty. The design
  //       rule is "2H never goes in offhand", regardless of state.
  const ohMainEmpty = buildSlotPickerEntries('offhand', [buckler, maul], [], new Set(), 9, EMPTY_EQ);
  eq(ohMainEmpty.find((e) => e.item.id === '0xMaul')!.locked, true,
    '2H locked in offhand even when mainhand empty');
  eq(ohMainEmpty.find((e) => e.item.id === '0xBuck')!.locked, false,
    'Buckler unlocked when mainhand empty');

  // f.iii) NEW — 2H locked in offhand even when mainhand has another 2H.
  //        (The case-3 reason "Two-handed weapon equipped — unequip it first"
  //        applies to non-2H candidates; 2H candidates get the case-2 reason
  //        "wrong slot, equip in weapon slot". We assert case-2 wins.)
  const ohBoth2H = buildSlotPickerEntries('offhand', [maul, greatsword, buckler], [], new Set(), 9, {
    ...EMPTY_EQ, weapon: maul,
  });
  eq(ohBoth2H.find((e) => e.item.id === '0xCursed')!.locked, true,
    '2H candidate locked in offhand even when weapon is also 2H');
  // The case-2 reason ("equip in the weapon slot") wins over case-3 ("unequip the 2H").
  // Both are acceptable but case-2 is more directly actionable for the player.
  const reason2HBoth = ohBoth2H.find((e) => e.item.id === '0xCursed')!.lockedReason ?? '';
  if (reason2HBoth.toLowerCase().includes('weapon slot')) {
    ok(`2H + 2H offhand reason chooses case-2 (wrong slot): "${reason2HBoth}"`);
  } else {
    fail('2H + 2H offhand reason chooses case-2', `got: "${reason2HBoth}"`);
  }

  // g) Level lock takes precedence over 2H lock when both apply.
  const wp4 = buildSlotPickerEntries('weapon', [greatsword], [], new Set(), 4, {
    ...EMPTY_EQ, offhand: buckler,
  });
  eq(wp4[0].locked, true, 'level + 2H both apply → still locked');
  eq(wp4[0].lockedReason?.startsWith('Requires Level'), true,
    'level reason wins (player\'s mental model: "level up first")');

  // h) Other slots unaffected by 2H rule.
  const helmetPick = buildSlotPickerEntries('helmet', [
    mkItem({ id: '0xHelm', name: 'A Helmet', itemType: HELMET, levelReq: 1 }),
  ], [], new Set(), 9, { ...EMPTY_EQ, weapon: maul });
  eq(helmetPick[0].locked, false, 'helmet slot ignores 2H weapon in `weapon` slot');

  // ===========================================================================
  // 13 — large input perf sanity (1000 items resolve in <100 ms locally)
  // ===========================================================================
  console.log('\n[13] Large-input sanity (1000 items)');
  const many: Item[] = [];
  for (let i = 0; i < 1000; i++) {
    many.push(mkItem({
      id: `0x${i.toString(16).padStart(8, '0')}`,
      name: `Item ${i.toString().padStart(4, '0')}`,
      itemType: WEAPON,
      levelReq: (i % 9) + 1,
    }));
  }
  const t0 = Date.now();
  const big = buildSlotPickerEntries('weapon', many, [], new Set(), 5);
  const dt = Date.now() - t0;
  eq(big.length, 1000, '1000 items → 1000 entries');
  if (dt < 200) ok(`completed in ${dt}ms (<200 ms)`);
  else fail(`completed in ${dt}ms`, 'expected <200 ms');

  // ===========================================================================
  // Summary
  // ===========================================================================
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`equip-picker gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
