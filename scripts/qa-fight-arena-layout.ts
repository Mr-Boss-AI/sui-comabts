/**
 * Phase 3 Fight-Room layout gauntlet (v2 polish pass, 2026-05-16).
 *
 *   $ cd server && npx tsx ../scripts/qa-fight-arena-layout.ts
 *
 * The fight-room was visually restructured to match
 * `Downloads/fight_room_layout_v5_tall_dolls.html` and then polished:
 *
 *   • Top row    = grid 1fr auto 1fr (HP card · timer card · HP card)
 *   • Middle row = grid 1fr 200px 1fr (doll | YOUR MOVE | doll)
 *   • Bottom row = full-width BATTLE LOG
 *
 * The doll panels reuse the read-only `MiniEquipmentFrame` (shared
 * with the Player Profile modal) so changes to the canonical 10-slot
 * doll automatically flow into the fight-room. The HP bar inside the
 * mini frame is suppressed via `hideHpBar` — HP renders once, in the
 * top row.
 *
 * Zone buttons in the `YOUR MOVE` column wear the game-theme chrome
 * (var(--r-sharp) / var(--sh-plate-sm) / var(--ls-button)) with full
 * zone labels — HEAD / CHEST / STOMACH / BELT / LEGS — instead of
 * abbreviations. Selected ATK = blood-red accent + glow; selected
 * BLK = steel-blue accent + glow.
 *
 * Fight logic, WS messages, lock-in behaviour, zone semantics did NOT
 * change. This gauntlet pins the structural + chrome pieces so a stray
 * refactor would trip the build before it can ship a regression.
 *
 * Exits 0 on full pass, 1 on any failure. No DOM, no React render —
 * the pin is grep-style structural shape matching.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..');

let passes = 0;
let failures = 0;
const failureLog: string[] = [];

function ok(label: string): void {
  passes++;
  console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
}
function fail(label: string, detail: string): void {
  failures++;
  failureLog.push(`${label}\n        ${detail}`);
  console.log(`  \x1b[31mFAIL\x1b[0m ${label}\n        ${detail}`);
}
function contains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) ok(label);
  else fail(label, `missing substring: ${needle}`);
}
function notContains(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) ok(label);
  else fail(label, `unexpected substring: ${needle}`);
}
function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function section(label: string): void {
  console.log(`\n${label}`);
}

function main(): void {
  const arena = readSrc('frontend/src/components/fight/fight-arena.tsx');
  const selector = readSrc('frontend/src/components/fight/zone-selector.tsx');

  // ============================================================
  // [1] Top row — HP card · timer card · HP card  (grid 1fr auto 1fr)
  // ============================================================
  section('[1] Top row — 3-card grid');
  contains(arena, 'data-testid="fight-top-row"', 'top row has data-testid="fight-top-row"');
  contains(arena, '"1fr auto 1fr"', 'top row grid is 1fr auto 1fr');
  contains(arena, 'function HpCard', 'HpCard component declared');
  contains(arena, 'function TurnCard', 'TurnCard component declared');
  contains(arena, '<HpCard', 'HpCard rendered');
  contains(arena, '<TurnCard', 'TurnCard rendered');

  // ============================================================
  // [2] Middle row — 1fr 240px 1fr  (doll | YOUR MOVE | doll)
  // ============================================================
  section('[2] Middle row — 1fr 240px 1fr');
  contains(arena, 'data-testid="fight-middle-row"', 'middle row has data-testid="fight-middle-row"');
  contains(arena, '"1fr 240px 1fr"', 'middle row grid is 1fr 240px 1fr (v3 widened from 200px)');
  contains(arena, 'function FighterPanel', 'FighterPanel wrapper component declared');
  contains(arena, 'Your Move', 'Your Move section label present');

  // ============================================================
  // [3] FighterPanel — reuses MiniEquipmentFrame, HP bar hidden,
  //     local player portrait wired from localStorage.
  // ============================================================
  section('[3] FighterPanel — read-only MiniEquipmentFrame reuse');
  contains(arena, "from \"@/components/social/mini-equipment-frame\"", 'imports MiniEquipmentFrame from canonical source');
  contains(arena, '<MiniEquipmentFrame', 'renders MiniEquipmentFrame');
  contains(arena, 'hideHpBar', 'passes hideHpBar (HP only in top row)');
  contains(arena, 'readPortrait', 'reads local NFT portrait for own panel');
  contains(arena, 'portraitImageUrl={myPortrait?.imageUrl', 'wires resolved portrait image into own panel');

  // ============================================================
  // [4] YOUR MOVE column — list-variant ZoneSelector + bottom Lock in
  // ============================================================
  section('[4] YOUR MOVE column — list selector + lock-in');
  contains(arena, 'variant="list"', 'ZoneSelector invoked with variant="list"');
  contains(arena, 'submitAction', 'submitAction handler still present');
  contains(arena, '"fight_action"', 'WS fight_action message unchanged');
  contains(arena, 'attackZones, blockZones', 'fight_action carries attack+block zones');
  contains(arena, 'Lock in', 'Lock-in button label present');
  contains(arena, 'Pick zones', 'disabled-state button label present');
  contains(arena, 'marginTop: "auto"', 'Lock-in button anchored at bottom (marginTop:auto)');

  // ============================================================
  // [5] Bottom row — full-width BATTLE LOG, max-height 200, scrollable
  // ============================================================
  section('[5] Bottom row — BATTLE LOG');
  contains(arena, 'data-testid="fight-bottom-row"', 'bottom row has data-testid="fight-bottom-row"');
  contains(arena, 'Battle Log', 'Battle Log section label present');
  contains(arena, 'maxHeight: 200', 'Battle log max-height = 200');
  contains(arena, 'overflowY: "auto"', 'Battle log is scrollable');
  contains(arena, '<DamageLog', 'DamageLog still rendered');

  // ============================================================
  // [6] ZoneSelector — variant prop + list variant
  // ============================================================
  section('[6] ZoneSelector — variant=list');
  contains(selector, 'variant?: "body" | "list"', 'variant prop declared');
  contains(selector, 'variant = "body"', 'default variant is body (back-compat)');
  contains(selector, 'function ZoneSelectorList', 'ZoneSelectorList sub-component declared');
  contains(selector, 'export const BLOCK_PAIRS', 'BLOCK_PAIRS exported for reuse');
  contains(selector, 'export const SHIELD_LINES', 'SHIELD_LINES exported for reuse');

  // ============================================================
  // [7] Block-pair logic preserved (no regression in selection rules)
  // ============================================================
  section('[7] Selection rules preserved');
  contains(selector, 'head: ["head", "chest"]', 'BLOCK_PAIRS head → [head, chest]');
  contains(selector, 'legs: ["legs", "head"]', 'BLOCK_PAIRS legs → [legs, head] (circular)');
  contains(selector, 'head: ["head", "chest", "stomach"]', 'SHIELD_LINES head → 3-zone line');
  contains(selector, 'shieldMode', 'shield-mode branch present');
  contains(selector, 'dualWieldMode', 'dual-wield branch present');

  // ============================================================
  // [8] v3 layout — row-paired grid (ATK | label | BLK per zone)
  // ============================================================
  section('[8] Row-paired grid — ATK | label | BLK per body zone');
  contains(selector, 'gridTemplateColumns: "1fr auto 1fr"', 'grid cols = 1fr auto 1fr');
  contains(selector, 'gridTemplateRows: "auto repeat(5, auto)"', 'grid rows = header + 5 zones');
  contains(selector, 'data-testid="zone-selector-list"', 'list variant marked with data-testid');
  contains(selector, 'ZONE_LABELS[zone].toUpperCase()', 'centre cell renders full zone label');
  contains(selector, 'function ZoneActionButton', 'single per-cell button component');
  contains(selector, 'kind="atk"', 'ATK cell uses kind="atk"');
  contains(selector, 'kind="blk"', 'BLK cell uses kind="blk"');

  // ============================================================
  // [8b] Game-theme button chrome + Tabler-style icons + glow
  // ============================================================
  section('[8b] Button chrome, icons, glow tokens');
  contains(selector, 'var(--r-sharp)', 'buttons use --r-sharp corner radius');
  contains(selector, 'var(--ls-button)', 'labels use --ls-button letter-spacing');
  contains(selector, 'var(--sh-plate-sm)', 'buttons carry --sh-plate-sm plate shadow');
  contains(selector, 'var(--sc-blood)', 'ATK accent = --sc-blood');
  contains(selector, 'var(--sc-steel)', 'BLK accent = --sc-steel');
  contains(selector, 'var(--sc-blood-deep)', 'ATK default border = --sc-blood-deep');
  contains(selector, 'var(--sc-steel-deep)', 'BLK default border = --sc-steel-deep');
  contains(selector, 'function IconSword', 'inline sword icon (Tabler outline style)');
  contains(selector, 'function IconShield', 'inline shield icon (Tabler outline style)');
  contains(selector, 'function IconCheck', 'inline check icon for selected badge');
  contains(selector, 'rgba(226, 75, 74, 0.6)', 'red glow rgba spec-matched');
  contains(selector, 'rgba(55, 138, 221, 0.6)', 'blue glow rgba spec-matched');
  contains(selector, '@keyframes zs-pulse-red', 'red pulse keyframes declared');
  contains(selector, '@keyframes zs-pulse-blue', 'blue pulse keyframes declared');
  contains(selector, '${pulseKf} 1.4s ease-in-out infinite', 'pulse animation wired to selected button via pulseKf template');

  // ============================================================
  // [9] No regression — fight logic surface is unchanged
  // ============================================================
  section('[9] Fight logic surface intact');
  contains(arena, 'handleAttackToggle', 'handleAttackToggle preserved');
  contains(arena, 'handleBlockPairSelect', 'handleBlockPairSelect preserved');
  contains(arena, 'fight.turnDeadline', 'turn deadline still wired to TurnTimer');
  contains(arena, 'state.socket.send', 'WS send path intact');
  contains(arena, '<OpponentDisconnectedBanner', 'OpponentDisconnectedBanner still rendered');
  contains(arena, '<FightResultModal', 'FightResultModal still rendered');
  contains(arena, 'setAcknowledgedFightId', 'fight-outcome-ack write preserved');

  // ============================================================
  // [10] Old layout artefacts removed — guard against silent revert
  // ============================================================
  section('[10] Pre-Phase-3 layout artefacts removed');
  notContains(arena, 'function FighterDisplay', 'old FighterDisplay component removed');
  notContains(arena, 'max-w-5xl', 'old Tailwind max-w-5xl container removed');
  notContains(arena, 'LOCKED IN', 'old LOCKED-IN copy replaced with compact LOCKED');
  notContains(arena, 'function SlotCell', 'v1 placeholder SlotCell removed (now uses MiniEquipmentFrame)');
  notContains(arena, 'function DollSilhouette', 'v1 placeholder DollSilhouette removed');

  // ============================================================
  // Summary
  // ============================================================
  console.log(`\n────────────────────────────────────────`);
  console.log(`Passed: ${passes}    Failed: ${failures}`);
  if (failures > 0) {
    console.log(`\nFailures:\n`);
    for (const f of failureLog) console.log(`  • ${f}`);
    process.exit(1);
  }
  console.log(`\n  \x1b[32mPhase-3 fight-room layout pinned.\x1b[0m`);
  process.exit(0);
}

main();
