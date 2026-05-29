/**
 * classifyStageEquip gauntlet — pins the educational-modal trigger.
 *
 *   $ cd server && npx tsx ../scripts/qa-two-handed-stage-classifier.ts
 *
 * `lib/two-handed-weapons.ts::classifyStageEquip` is the pure decision
 * helper that `useEquipmentActions.stageEquip` uses to decide between
 * three UX paths:
 *
 *   - `'auto_clear'`      → silent off-hand clear + bottom toast
 *   - `'block_and_explain'`→ refuse stage + open educational modal
 *   - `'ok'`              → proceed
 *
 * The educational modal MUST NOT fire on the correct unequip-first
 * flow. This gauntlet pins both halves of the contract:
 *
 *   [1] off-hand attempted while pending.weapon is 2H → block_and_explain
 *   [2] 2H weapon attempted into off-hand slot → block_and_explain
 *   [3] 2H weapon attempted into weapon slot with occupied off-hand → auto_clear
 *   [4] correct flow A: off-hand unequipped first, THEN 2H weapon → ok
 *   [5] correct flow B: 2H unequipped first, THEN off-hand → ok
 *   [6] 1H weapon → off-hand slot (dual-wield) with empty mainhand → ok
 *   [7] 1H weapon → weapon slot with shield in off-hand → ok
 *   [8] non-equipment slots (helmet/ring/etc.) always → ok regardless of weapon
 *   [9] shield → off-hand with 1H weapon equipped → ok (normal config)
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { classifyStageEquip } from '../frontend/src/lib/two-handed-weapons';
import {
  ITEM_TYPES,
  SLOT_TYPES,
  type EquipmentSlots,
  type Item,
} from '../frontend/src/types/game';

let passes = 0;
let failures = 0;
function ok(msg: string) { console.log(`  ✓ ${msg}`); passes++; }
function fail(msg: string, detail: string) {
  console.log(`  ✗ ${msg}\n      ${detail}`);
  failures++;
}
function eq<T>(actual: T, expected: T, msg: string) {
  if (actual === expected) ok(msg);
  else fail(msg, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function mkItem(p: Partial<Item> & { id: string; name: string }): Item {
  return {
    id: p.id, name: p.name,
    itemType: p.itemType ?? ITEM_TYPES.WEAPON,
    classReq: 0,
    levelReq: p.levelReq ?? 1,
    rarity: p.rarity ?? 1,
    slotType: p.slotType,
    statBonuses: {
      strengthBonus: 0, dexterityBonus: 0, intuitionBonus: 0, enduranceBonus: 0,
      hpBonus: 0, armorBonus: 0, defenseBonus: 0, attackBonus: 0,
      critChanceBonus: 0, critMultiplierBonus: 0, evasionBonus: 0,
      antiCritBonus: 0, antiEvasionBonus: 0,
    },
    minDamage: 0, maxDamage: 0,
  };
}

const EMPTY: EquipmentSlots = {
  weapon: null, offhand: null, helmet: null, chest: null, gloves: null,
  boots: null, belt: null, ring1: null, ring2: null, ring3: null,
  necklace: null, pants: null, bracelets: null,
};

const greatsword = mkItem({
  id: '0xCursed', name: 'Cursed Greatsword',
  itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.BOTH_HANDS,
});
const nailPlank = mkItem({
  id: '0xNail', name: 'Nail Plank',
  itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.BOTH_HANDS,
});
const longsword = mkItem({
  id: '0x1H', name: 'Longsword',
  itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.MAINHAND,
});
const shield = mkItem({
  id: '0xBuck', name: 'Wooden Buckler',
  itemType: ITEM_TYPES.SHIELD, slotType: SLOT_TYPES.OFFHAND,
});
const helmet = mkItem({
  id: '0xH', name: 'Helm',
  itemType: ITEM_TYPES.HELMET,
});

function main() {
  console.log('\n=== classifyStageEquip gauntlet ===\n');

  // ===========================================================================
  // 1 — wrong-order: off-hand attempted while weapon is 2H → modal
  // ===========================================================================
  console.log('[1] off-hand staged while pending.weapon is 2H → block_and_explain');
  eq(
    classifyStageEquip({
      slot: 'offhand', candidate: shield,
      pending: { ...EMPTY, weapon: nailPlank },
    }),
    'block_and_explain',
    'shield → offhand with 2H weapon equipped → fires educational modal',
  );
  // 1H weapon into offhand slot while mainhand is 2H — same conflict.
  eq(
    classifyStageEquip({
      slot: 'offhand', candidate: longsword,
      pending: { ...EMPTY, weapon: greatsword },
    }),
    'block_and_explain',
    '1H weapon → offhand with 2H weapon equipped → modal',
  );

  // ===========================================================================
  // 2 — 2H candidate staged INTO offhand slot → modal
  // ===========================================================================
  console.log('[2] 2H weapon staged into offhand slot → block_and_explain');
  eq(
    classifyStageEquip({
      slot: 'offhand', candidate: greatsword, pending: EMPTY,
    }),
    'block_and_explain',
    '2H weapon → offhand → modal (even with empty mainhand)',
  );

  // ===========================================================================
  // 3 — auto-clear: 2H staged into weapon slot with occupied off-hand
  // ===========================================================================
  console.log('[3] 2H weapon → weapon slot with occupied off-hand → auto_clear');
  eq(
    classifyStageEquip({
      slot: 'weapon', candidate: greatsword,
      pending: { ...EMPTY, offhand: shield },
    }),
    'auto_clear',
    '2H → weapon with shield in off-hand → silent clear + toast (no modal)',
  );

  // ===========================================================================
  // 4 — CORRECT flow A: unequip off-hand FIRST, then equip 2H → ok
  //
  // The pending state when the player stages the 2H weapon already has
  // offhand=null because they unequipped it first. classifyStageEquip
  // sees no conflict and returns 'ok' — no modal.
  // ===========================================================================
  console.log('[4] correct flow A: 2H → weapon with off-hand already empty → ok');
  eq(
    classifyStageEquip({
      slot: 'weapon', candidate: greatsword,
      pending: EMPTY, // off-hand already cleared
    }),
    'ok',
    'unequip off-hand → equip 2H → no modal, no toast',
  );

  // ===========================================================================
  // 5 — CORRECT flow B: unequip 2H FIRST, then equip off-hand → ok
  // ===========================================================================
  console.log('[5] correct flow B: shield → offhand with weapon slot empty → ok');
  eq(
    classifyStageEquip({
      slot: 'offhand', candidate: shield,
      pending: EMPTY, // 2H already cleared from weapon slot
    }),
    'ok',
    'unequip 2H → equip off-hand → no modal',
  );

  // ===========================================================================
  // 6 — 1H weapon into off-hand (dual-wield) with empty mainhand → ok
  // ===========================================================================
  console.log('[6] 1H weapon → offhand slot (dual-wield) → ok');
  eq(
    classifyStageEquip({
      slot: 'offhand', candidate: longsword, pending: EMPTY,
    }),
    'ok',
    '1H → offhand with empty mainhand → no modal (dual-wield is legal)',
  );

  // ===========================================================================
  // 7 — 1H weapon into weapon slot with shield off-hand → ok
  // ===========================================================================
  console.log('[7] 1H weapon → weapon slot with shield in off-hand → ok');
  eq(
    classifyStageEquip({
      slot: 'weapon', candidate: longsword,
      pending: { ...EMPTY, offhand: shield },
    }),
    'ok',
    'normal sword-and-shield configuration → no modal',
  );

  // ===========================================================================
  // 8 — Non-equipment-conflict slots → always ok
  // ===========================================================================
  console.log('[8] non-weapon slots → always ok regardless of weapon state');
  for (const slot of ['helmet', 'chest', 'gloves', 'boots', 'belt',
       'ring1', 'ring2', 'ring3', 'necklace', 'pants', 'bracelets'] as const) {
    const out = classifyStageEquip({
      slot, candidate: helmet,
      pending: { ...EMPTY, weapon: greatsword }, // 2H equipped — shouldn't matter
    });
    if (out !== 'ok') fail(`slot=${slot}`, `expected 'ok', got '${out}'`);
  }
  ok('every non-weapon slot returns ok even with 2H weapon equipped');

  // ===========================================================================
  // 9 — Shield to off-hand with 1H weapon → ok (normal config)
  // ===========================================================================
  console.log('[9] shield → offhand with 1H weapon equipped → ok');
  eq(
    classifyStageEquip({
      slot: 'offhand', candidate: shield,
      pending: { ...EMPTY, weapon: longsword },
    }),
    'ok',
    'shield + 1H weapon → standard sword-and-board, no modal',
  );

  // ===========================================================================
  // Summary
  // ===========================================================================
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`classifyStageEquip gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
