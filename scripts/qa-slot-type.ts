/**
 * slot_type gauntlet — pins the v5.1 two-handed enforcement against the
 * chain `Item.slot_type` field, NOT the deleted `TWO_HANDED_NAMES`
 * hardcoded allowlist.
 *
 *   $ cd server && npx tsx ../scripts/qa-slot-type.ts
 *
 * Why this exists: pre-v5.1 the frontend guessed "is this weapon
 * two-handed?" by looking up the item's `name` in a 3-entry allowlist
 * (Steel Greatsword / Cursed Greatsword / Skullcrusher Maul). When a
 * new 2H weapon shipped on chain ("Nail Plank"), the picker happily
 * offered it for the off-hand slot, the save PTB tried
 * `equip_offhand(NailPlank)`, and the chain aborted with
 * EItemNotOffhand (code 9). This gauntlet ensures the regression
 * cannot return — `isTwoHanded` MUST read `slotType` and the
 * `TWO_HANDED_NAMES` constant MUST stay deleted.
 *
 * Pins:
 *   [1] isTwoHanded returns true for slotType=BOTH_HANDS regardless of name
 *   [2] isTwoHanded returns false for slotType=MAINHAND even if name was
 *       on the old allowlist ("Cursed Greatsword")
 *   [3] isTwoHanded ignores name entirely — Nail Plank with
 *       slotType=BOTH_HANDS reads as 2H without a code change
 *   [4] isTwoHanded returns false for non-weapon items even with
 *       slotType=BOTH_HANDS (defence — chain mint validation forbids it
 *       but the frontend still guards)
 *   [5] evaluateTwoHandedConflict('offhand', 2H, *) reports conflict
 *   [6] evaluateTwoHandedConflict('offhand', shield, weapon=2H) reports
 *       conflict (case 3 — anything blocked while mainhand is 2H)
 *   [7] evaluateTwoHandedConflict('weapon', 2H, offhand=shield) reports
 *       informational conflict ("will clear off-hand")
 *   [8] evaluateTwoHandedConflict('helmet', anything, *) reports no conflict
 *   [9] `TWO_HANDED_NAMES` export does not exist on the module
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import {
  isTwoHanded,
  evaluateTwoHandedConflict,
} from '../frontend/src/lib/two-handed-weapons';
import {
  ITEM_TYPES,
  SLOT_TYPES,
  type EquipmentSlots,
  type Item,
} from '../frontend/src/types/game';

let passes = 0;
let failures = 0;
function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
  passes++;
}
function fail(msg: string, detail: string) {
  console.log(`  ✗ ${msg}\n      ${detail}`);
  failures++;
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) ok(msg);
  else fail(msg, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function mkItem(partial: Partial<Item> & { id: string; name: string }): Item {
  return {
    id: partial.id,
    name: partial.name,
    itemType: partial.itemType ?? ITEM_TYPES.WEAPON,
    classReq: 0,
    levelReq: partial.levelReq ?? 1,
    rarity: partial.rarity ?? 1,
    slotType: partial.slotType,
    statBonuses: {
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
    },
    minDamage: 0,
    maxDamage: 0,
  };
}

const EMPTY: EquipmentSlots = {
  weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
  boots: null, belt: null, ring1: null, ring2: null, ring3: null,
  necklace: null, pants: null, bracelets: null,
};

function main() {
  console.log('\n=== slot_type gauntlet ===\n');

  // ===========================================================================
  // 1 — Two-handed weapon detected by slotType
  // ===========================================================================
  console.log('[1] BOTH_HANDS slotType detected as two-handed');
  const greatsword = mkItem({
    id: '0xa1', name: 'Steel Greatsword',
    itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.BOTH_HANDS,
  });
  eq(isTwoHanded(greatsword), true, 'Steel Greatsword (BOTH_HANDS) → 2H');

  // ===========================================================================
  // 2 — Old-allowlist name + MAINHAND slotType → NOT two-handed
  // ===========================================================================
  console.log('[2] Name on the OLD allowlist no longer counts');
  const mainhandImposter = mkItem({
    id: '0xa2', name: 'Cursed Greatsword',
    itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.MAINHAND,
  });
  eq(isTwoHanded(mainhandImposter), false,
    'Cursed Greatsword stamped MAINHAND on chain → not 2H (name is irrelevant)');

  // ===========================================================================
  // 3 — Nail Plank case (the bug). NEW 2H weapon, NOT in the old allowlist.
  // ===========================================================================
  console.log('[3] New 2H weapon (Nail Plank) detected without a code change');
  const nailPlank = mkItem({
    id: '0xa3', name: 'Nail Plank',
    itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.BOTH_HANDS,
  });
  eq(isTwoHanded(nailPlank), true,
    'Nail Plank (BOTH_HANDS) → 2H — closes the 2026-05-29 regression');

  // ===========================================================================
  // 4 — Non-weapon defence
  // ===========================================================================
  console.log('[4] Non-weapon items can never be two-handed');
  const helmet = mkItem({
    id: '0xa4', name: 'Helmet of Lies',
    itemType: ITEM_TYPES.HELMET, slotType: SLOT_TYPES.BOTH_HANDS,
  });
  eq(isTwoHanded(helmet), false, 'Helmet with BOTH_HANDS → still not 2H (defence)');

  const shield = mkItem({
    id: '0xa5', name: 'Round Shield',
    itemType: ITEM_TYPES.SHIELD, slotType: SLOT_TYPES.OFFHAND,
  });
  eq(isTwoHanded(shield), false, 'Shield with OFFHAND slot → not 2H');

  // ===========================================================================
  // 5 — Picker conflict: 2H in offhand slot
  // ===========================================================================
  console.log('[5] 2H weapon offered for offhand slot → conflict');
  const c5 = evaluateTwoHandedConflict({
    slot: 'offhand', candidate: greatsword, pending: EMPTY,
  });
  eq(c5.conflict, true, 'Greatsword → offhand → conflict');

  // ===========================================================================
  // 6 — Anything → offhand while weapon slot has 2H
  // ===========================================================================
  console.log('[6] Anything offered for offhand while weapon=2H → conflict');
  const pendingWith2H: EquipmentSlots = { ...EMPTY, weapon: greatsword };
  const c6 = evaluateTwoHandedConflict({
    slot: 'offhand', candidate: shield, pending: pendingWith2H,
  });
  eq(c6.conflict, true, 'Shield → offhand while weapon=2H → conflict');

  // ===========================================================================
  // 7 — 2H → weapon with offhand occupied → informational conflict
  // ===========================================================================
  console.log('[7] 2H → weapon while offhand is occupied → informational conflict');
  const pendingWithOffhand: EquipmentSlots = { ...EMPTY, offhand: shield };
  const c7 = evaluateTwoHandedConflict({
    slot: 'weapon', candidate: greatsword, pending: pendingWithOffhand,
  });
  eq(c7.conflict, true, 'Greatsword → weapon while offhand=shield → flagged');
  if (c7.reason && c7.reason.toLowerCase().includes('off-hand')) {
    ok('reason mentions off-hand auto-clear');
  } else {
    fail('reason should mention off-hand auto-clear', `got "${c7.reason}"`);
  }

  // ===========================================================================
  // 8 — Unrelated slots are unaffected
  // ===========================================================================
  console.log('[8] Helmet slot — no 2H conflict ever');
  const c8 = evaluateTwoHandedConflict({
    slot: 'helmet', candidate: helmet, pending: pendingWith2H,
  });
  eq(c8.conflict, false, 'Helmet candidate → helmet slot → no conflict');

  // ===========================================================================
  // 9 — TWO_HANDED_NAMES is gone
  // ===========================================================================
  console.log('[9] TWO_HANDED_NAMES export must not exist on the module');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../frontend/src/lib/two-handed-weapons');
  if ('TWO_HANDED_NAMES' in mod) {
    fail('TWO_HANDED_NAMES export still present',
      'remove the hardcoded allowlist — frontend MUST read chain slot_type');
  } else {
    ok('no TWO_HANDED_NAMES export — the name allowlist is gone');
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`slot-type gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
