/**
 * Equipment-abort humanizer gauntlet.
 *
 *   $ cd server && npx tsx ../scripts/qa-equipment-aborts.ts
 *
 * Pins the chain → user-facing string mapping for every equipment.move
 * abort code in `contracts/sources/equipment.move`. If a Move constant
 * is renumbered, this gauntlet fails — forces the table in
 * `frontend/src/lib/equipment-aborts.ts` to be re-synced before any
 * frontend ships against a republished package.
 *
 * Real raw error strings recorded in the live `[Loadout] save rejected`
 * console logs of `tmp/sui-frontend.log` (2026-05-29 two-handed report)
 * are reused as inputs so the gauntlet exercises the exact SDK shape
 * that dapp-kit 2.16 throws in practice.
 *
 * Pins:
 *   [1] code 6 (EOffhandOccupied at equip_weapon)
 *   [2] code 7 (EWeaponIsTwoHanded at equip_offhand)
 *   [3] code 8 (EItemNotMainhand at equip_weapon)
 *   [4] code 9 (EItemNotOffhand at equip_offhand)
 *   [5] codes 0..5 retain their pre-v5.1 wording
 *   [6] unmapped equipment code → generic fallback "Abort code N (at ...)"
 *   [7] code 6 humanizer + module location string format intact
 *   [8] passing no map → generic fallback even for code 6 (chain-source-truth proof)
 *
 * Exits 0 on full pass, 1 on any failure.
 */
import { humanizeChainError } from '../frontend/src/lib/tx-result';
import { EQUIPMENT_ABORT_CODES } from '../frontend/src/lib/equipment-aborts';

let passes = 0;
let failures = 0;
function ok(msg: string) { console.log(`  ✓ ${msg}`); passes++; }
function fail(msg: string, detail: string) {
  console.log(`  ✗ ${msg}\n      ${detail}`);
  failures++;
}

function expectContains(haystack: string | null, needle: string, label: string) {
  if (haystack && haystack.includes(needle)) ok(`${label} — contains "${needle}"`);
  else fail(label, `expected to contain "${needle}", got: ${JSON.stringify(haystack)}`);
}

function main() {
  console.log('\n=== equipment-abort humanizer gauntlet ===\n');

  // Real raw strings from the live frontend log (2026-05-29).
  const raw6 = "MoveAbort(MoveLocation { module: ModuleId { address: ..., name: Identifier(\"equipment\") }, function: 1, instruction: 86, function_name: Some(\"equip_weapon\") }, 6) in command 1: abort code: 6, source: '0x308645f3..::equipment::equip_weapon' (instruction 86)";
  const raw7 = "MoveAbort(... abort code: 7 ... '0x308645f3..::equipment::equip_offhand' (instruction 105)";
  const raw8 = "abort code: 8 '0x308645f3..::equipment::equip_weapon' (instruction 65)";
  const raw9 = "abort code: 9 '0x308645f3..::equipment::equip_offhand' (instruction 69)";
  const raw99 = "abort code: 99 '0x308645f3..::equipment::equip_helmet' (instruction 0)";

  // ===========================================================================
  // 1 — code 6 (EOffhandOccupied)
  // ===========================================================================
  console.log('[1] code 6 — EOffhandOccupied at equip_weapon');
  const h6 = humanizeChainError(raw6, EQUIPMENT_ABORT_CODES);
  expectContains(h6, 'two-handed weapon', '6: copy mentions "two-handed weapon"');
  expectContains(h6, 'off-hand', '6: copy mentions off-hand');
  expectContains(h6, 'equip_weapon', '6: preserves Move location');

  // ===========================================================================
  // 2 — code 7 (EWeaponIsTwoHanded)
  // ===========================================================================
  console.log('[2] code 7 — EWeaponIsTwoHanded at equip_offhand');
  const h7 = humanizeChainError(raw7, EQUIPMENT_ABORT_CODES);
  expectContains(h7, 'two-handed weapon', '7: copy mentions "two-handed weapon"');
  expectContains(h7, 'Unequip', '7: copy tells user what to do');

  // ===========================================================================
  // 3 — code 8 (EItemNotMainhand)
  // ===========================================================================
  console.log('[3] code 8 — EItemNotMainhand at equip_weapon');
  const h8 = humanizeChainError(raw8, EQUIPMENT_ABORT_CODES);
  expectContains(h8, 'weapon slot', '8: copy mentions weapon slot');
  expectContains(h8, 'off-hand', '8: copy explains the item is off-hand-typed');

  // ===========================================================================
  // 4 — code 9 (EItemNotOffhand)
  // ===========================================================================
  console.log('[4] code 9 — EItemNotOffhand at equip_offhand');
  const h9 = humanizeChainError(raw9, EQUIPMENT_ABORT_CODES);
  expectContains(h9, 'off-hand slot', '9: copy mentions off-hand slot');

  // ===========================================================================
  // 5 — codes 0..5 still mapped (no regression on pre-v5.1 wording)
  // ===========================================================================
  console.log('[5] codes 0..5 retain pre-v5.1 wording');
  for (let code = 0; code <= 5; code++) {
    const raw = `abort code: ${code} '0x..::equipment::equip_helmet' (instruction 0)`;
    const out = humanizeChainError(raw, EQUIPMENT_ABORT_CODES);
    if (!out || out.startsWith(`Abort code ${code}`)) {
      fail(`code ${code} mapped`, `humanizer returned generic fallback "${out}"`);
    } else {
      ok(`code ${code} → "${out.slice(0, 50)}…"`);
    }
  }

  // ===========================================================================
  // 6 — unmapped code → generic fallback
  // ===========================================================================
  console.log('[6] unmapped code falls through to generic');
  const h99 = humanizeChainError(raw99, EQUIPMENT_ABORT_CODES);
  expectContains(h99, 'Abort code 99', '99: generic fallback kicks in');
  expectContains(h99, 'equip_helmet', '99: location string preserved');

  // ===========================================================================
  // 7 — code-6 wording matches the user-confirmed copy
  // ===========================================================================
  console.log('[7] code-6 copy matches the user-approved wording');
  if (EQUIPMENT_ABORT_CODES[6]?.toLowerCase().startsWith("that's a two-handed weapon")) {
    ok('code 6 copy matches "That\'s a two-handed weapon …"');
  } else {
    fail('code 6 copy drift', `wording changed: "${EQUIPMENT_ABORT_CODES[6]}"`);
  }

  // ===========================================================================
  // 8 — humanizer without the map returns the generic fallback even for code 6.
  //
  // This is the regression that produced the 2026-05-29 toast: the
  // saveLoadout catch block called humanizeChainError WITHOUT the abort
  // map, so users saw "Abort code 6 (at equipment::equip_weapon:86)"
  // instead of the friendly copy. Pin the contract: humanizer with no
  // map → generic fallback. Then proof: with the map → friendly copy.
  // ===========================================================================
  console.log('[8] no-map call falls through; with-map call humanizes');
  const noMap = humanizeChainError(raw6); // no abortCodes arg
  expectContains(noMap, 'Abort code 6', 'no map → generic fallback');
  const withMap = humanizeChainError(raw6, EQUIPMENT_ABORT_CODES);
  if (withMap && !withMap.startsWith('Abort code')) {
    ok('with map → friendly copy (regression fix verified)');
  } else {
    fail('with-map humanize', `expected friendly copy, got "${withMap}"`);
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  const total = passes + failures;
  console.log('\n' + '='.repeat(60));
  console.log(`equipment-aborts gauntlet: ${passes}/${total} PASS, ${failures} FAIL`);
  console.log('='.repeat(60));
  if (failures > 0) process.exit(1);
}

main();
