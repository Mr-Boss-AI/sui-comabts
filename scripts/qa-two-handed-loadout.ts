/**
 * Two-handed loadout-save gauntlet.
 *
 *   $ cd server && npx tsx ../scripts/qa-two-handed-loadout.ts
 *
 * Pins `buildSaveLoadoutTx` (`frontend/src/lib/loadout-tx.ts`) for the
 * cross-slot 2H invariant and PTB op ordering, both introduced
 * 2026-05-29 to close the Nail Plank regression. The chain enforces:
 *
 *   - equip_weapon(2H) requires offhand DOF empty (EOffhandOccupied=6)
 *   - equip_offhand requires current weapon NOT 2H (EWeaponIsTwoHanded=7)
 *   - equip_offhand requires item slot_type != BOTH_HANDS (EItemNotOffhand=9)
 *
 * The save builder MUST:
 *   1. silently reconcile pending.offhand to null when pending.weapon is
 *      2H (returning offhandAutoCleared=true so the caller can surface
 *      a non-blocking notice);
 *   2. emit all unequip moveCalls BEFORE any equip moveCall, so the
 *      cross-slot "unequip offhand first, then equip 2H weapon" swap
 *      satisfies the chain invariant at the moment equip_weapon runs;
 *   3. never emit an equip_offhand call when reconciledPending.offhand
 *      is null.
 *
 * Pins:
 *   [1] valid: pending.weapon=2H + pending.offhand=null → ordered PTB
 *   [2] reconcile: pending.weapon=2H + pending.offhand=shield →
 *       offhandAutoCleared=true; PTB has NO equip_offhand call
 *   [3] swap 1H+shield → 2H: unequip_offhand emitted BEFORE
 *       equip_weapon (the cross-slot ordering rule)
 *   [4] swap 2H → 1H+shield: unequip_weapon BEFORE equip_offhand
 *   [5] reconciledPending reflects the offhand clear (rebase truth)
 *   [6] PTB ends with save_loadout when changedSlots is non-empty
 *   [7] no-op save (committed === pending) returns empty changedSlots
 *
 * Exits 0 on full pass, 1 on any failure.
 */

// The frontend's `lib/sui-contracts.ts` reads NEXT_PUBLIC_* env at
// module load and throws if PACKAGE_ID is missing. Loadout-tx.ts
// transitively imports it for CALL_PACKAGE + SUI_CLOCK. Set fake
// values BEFORE the dynamic import below so module evaluation
// succeeds in the test harness.
process.env.NEXT_PUBLIC_SUI_PACKAGE_ID =
  process.env.NEXT_PUBLIC_SUI_PACKAGE_ID ||
  '0x' + 'a'.repeat(64); // chain-valid-shape 32-byte hex
process.env.NEXT_PUBLIC_TREASURY_ADDRESS =
  process.env.NEXT_PUBLIC_TREASURY_ADDRESS ||
  '0x' + 'b'.repeat(64);

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

const FAKE_OBJECT_ID = (n: string) =>
  '0x' + n.padStart(64, '0'); // chain-valid-looking 32-byte hex
const TEST_PKG = process.env.NEXT_PUBLIC_SUI_PACKAGE_ID!;
// Need a 64-hex-char address; the SDK's TransactionData schema validates
// every object id before `getData()` returns.
const CHAR_ID = FAKE_OBJECT_ID('c1');

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

// Inspect the moveCalls a Transaction will emit. The SDK stores
// commands on `tx.getData().commands` — each MoveCall has the shape
// { $kind: 'MoveCall', MoveCall: { package, module, function, ... } }.
// We extract a flat array of `module::function` strings preserving
// command order.
function moveCallTargets(tx: any): string[] {
  const data = tx.getData();
  const cmds = data?.commands ?? [];
  const out: string[] = [];
  for (const c of cmds) {
    // The shape v2 SDK uses is { $kind, MoveCall: { module, function, ... } }
    if (c?.$kind === 'MoveCall' && c.MoveCall) {
      const mc = c.MoveCall;
      out.push(`${mc.module}::${mc.function}`);
    }
  }
  return out;
}

async function main() {
  console.log('\n=== two-handed loadout-save gauntlet ===\n');

  // Dynamic import so module evaluation happens AFTER env is set.
  const { buildSaveLoadoutTx } = await import('../frontend/src/lib/loadout-tx');
  void TEST_PKG;

  const greatsword = mkItem({
    id: FAKE_OBJECT_ID('a1'), name: 'Steel Greatsword',
    itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.BOTH_HANDS,
  });
  const nailPlank = mkItem({
    id: FAKE_OBJECT_ID('a2'), name: 'Nail Plank',
    itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.BOTH_HANDS,
  });
  const longsword = mkItem({
    id: FAKE_OBJECT_ID('a3'), name: 'Longsword',
    itemType: ITEM_TYPES.WEAPON, slotType: SLOT_TYPES.MAINHAND,
  });
  const shield = mkItem({
    id: FAKE_OBJECT_ID('a4'), name: 'Round Shield',
    itemType: ITEM_TYPES.SHIELD, slotType: SLOT_TYPES.OFFHAND,
  });

  // ===========================================================================
  // 1 — Valid: 2H weapon, no offhand
  // ===========================================================================
  console.log('[1] valid pending: 2H weapon + empty offhand');
  {
    const committed: EquipmentSlots = EMPTY;
    const pending: EquipmentSlots = { ...EMPTY, weapon: greatsword };
    const r = buildSaveLoadoutTx(CHAR_ID, committed, pending);
    eq(r.offhandAutoCleared, false, 'no offhand reconciliation needed');
    eq(r.reconciledPending.weapon?.id, greatsword.id, 'reconciledPending keeps the 2H weapon');
    eq(r.reconciledPending.offhand, null, 'reconciledPending offhand stays null');
    const targets = moveCallTargets(r.tx);
    const equipWeapon = targets.indexOf('equipment::equip_weapon');
    const save = targets.indexOf('equipment::save_loadout');
    if (equipWeapon >= 0 && save > equipWeapon) ok('PTB: equip_weapon → save_loadout');
    else fail('PTB order', `targets=${JSON.stringify(targets)}`);
    if (!targets.includes('equipment::equip_offhand')) ok('no equip_offhand in PTB');
    else fail('stray equip_offhand', `targets=${JSON.stringify(targets)}`);
  }

  // ===========================================================================
  // 2 — Reconcile: 2H weapon + occupied offhand → auto-clear
  // ===========================================================================
  console.log('[2] pending.weapon=2H + pending.offhand=shield → auto-clear');
  {
    const committed: EquipmentSlots = EMPTY;
    const pending: EquipmentSlots = { ...EMPTY, weapon: nailPlank, offhand: shield };
    const r = buildSaveLoadoutTx(CHAR_ID, committed, pending);
    eq(r.offhandAutoCleared, true, 'offhandAutoCleared=true');
    eq(r.reconciledPending.weapon?.id, nailPlank.id, 'reconciledPending keeps Nail Plank');
    eq(r.reconciledPending.offhand, null, 'reconciledPending offhand reconciled to null');
    const targets = moveCallTargets(r.tx);
    if (!targets.includes('equipment::equip_offhand')) ok('PTB has NO equip_offhand call');
    else fail('illegal equip_offhand', `targets=${JSON.stringify(targets)}`);
  }

  // ===========================================================================
  // 3 — 1H+shield → 2H swap: unequip_offhand BEFORE equip_weapon
  // ===========================================================================
  console.log('[3] swap 1H+shield → 2H: cross-slot unequip-before-equip rule');
  {
    const committed: EquipmentSlots = { ...EMPTY, weapon: longsword, offhand: shield };
    const pending: EquipmentSlots = { ...EMPTY, weapon: greatsword };
    const r = buildSaveLoadoutTx(CHAR_ID, committed, pending);
    const targets = moveCallTargets(r.tx);
    const unequipOffhand = targets.indexOf('equipment::unequip_offhand');
    const equipWeapon = targets.indexOf('equipment::equip_weapon');
    const unequipWeapon = targets.indexOf('equipment::unequip_weapon');
    if (unequipOffhand >= 0 && equipWeapon >= 0 && unequipOffhand < equipWeapon) {
      ok(`unequip_offhand (idx ${unequipOffhand}) BEFORE equip_weapon (idx ${equipWeapon})`);
    } else {
      fail('cross-slot ordering broken',
        `targets=${JSON.stringify(targets)} — unequip_offhand must precede equip_weapon`);
    }
    if (unequipWeapon >= 0 && unequipWeapon < equipWeapon) {
      ok(`unequip_weapon (idx ${unequipWeapon}) BEFORE equip_weapon (idx ${equipWeapon})`);
    } else {
      fail('unequip-before-equip general rule', `targets=${JSON.stringify(targets)}`);
    }
  }

  // ===========================================================================
  // 4 — Reverse swap: 2H → 1H+shield: unequip_weapon BEFORE equip_offhand
  // ===========================================================================
  console.log('[4] swap 2H → 1H+shield: unequip_weapon BEFORE equip_offhand');
  {
    const committed: EquipmentSlots = { ...EMPTY, weapon: greatsword };
    const pending: EquipmentSlots = { ...EMPTY, weapon: longsword, offhand: shield };
    const r = buildSaveLoadoutTx(CHAR_ID, committed, pending);
    eq(r.offhandAutoCleared, false, 'no auto-clear when pending.weapon is 1H');
    const targets = moveCallTargets(r.tx);
    const unequipWeapon = targets.indexOf('equipment::unequip_weapon');
    const equipOffhand = targets.indexOf('equipment::equip_offhand');
    if (unequipWeapon >= 0 && equipOffhand >= 0 && unequipWeapon < equipOffhand) {
      ok(`unequip_weapon (idx ${unequipWeapon}) BEFORE equip_offhand (idx ${equipOffhand})`);
    } else {
      fail('reverse-swap ordering broken', `targets=${JSON.stringify(targets)}`);
    }
  }

  // ===========================================================================
  // 5 — reconciledPending is the rebase truth (not the original pending)
  // ===========================================================================
  console.log('[5] reconciledPending is what COMMIT_SAVED MUST rebase against');
  {
    const committed: EquipmentSlots = { ...EMPTY, offhand: shield };
    const pending: EquipmentSlots = { ...EMPTY, weapon: greatsword, offhand: shield };
    const r = buildSaveLoadoutTx(CHAR_ID, committed, pending);
    eq(r.offhandAutoCleared, true, 'auto-clear fires when both 2H and offhand present');
    // The reducer rebases committed := reconciledPending on success — if
    // that field still carries the shield, the UI would render a stale
    // offhand AFTER a successful save. The 2026-05-29 fix routes via
    // reconciledPending precisely to prevent that drift.
    eq(r.reconciledPending.offhand, null, 'reconciledPending.offhand is null (rebase truth)');
    if (pending.offhand?.id === shield.id) {
      ok('original pending object NOT mutated (defensive copy honoured)');
    } else {
      fail('pending mutated', 'buildSaveLoadoutTx mutated the caller\'s pending object');
    }
  }

  // ===========================================================================
  // 6 — save_loadout always comes last
  // ===========================================================================
  console.log('[6] save_loadout is the final command');
  {
    const committed: EquipmentSlots = EMPTY;
    const pending: EquipmentSlots = { ...EMPTY, weapon: longsword, offhand: shield };
    const r = buildSaveLoadoutTx(CHAR_ID, committed, pending);
    const targets = moveCallTargets(r.tx);
    eq(targets[targets.length - 1], 'equipment::save_loadout', 'last command is save_loadout');
  }

  // ===========================================================================
  // 7 — No-op save (committed === pending) produces no calls
  // ===========================================================================
  console.log('[7] no-op save: no moveCalls emitted');
  {
    const committed: EquipmentSlots = { ...EMPTY, weapon: longsword, offhand: shield };
    const pending: EquipmentSlots = { ...EMPTY, weapon: longsword, offhand: shield };
    const r = buildSaveLoadoutTx(CHAR_ID, committed, pending);
    eq(r.changedSlots.length, 0, 'changedSlots is empty');
    const targets = moveCallTargets(r.tx);
    eq(targets.length, 0, 'no moveCalls (not even save_loadout)');
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`two-handed loadout-save gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Unhandled:', err);
  process.exit(1);
});
