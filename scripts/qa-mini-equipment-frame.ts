/**
 * MiniEquipmentFrame gauntlet — pins the Player Profile mini equipment
 * frame at ~80% scale of the main Character page.
 *
 *   $ cd server && npx tsx ../scripts/qa-mini-equipment-frame.ts
 *
 * Covers:
 *   [1]  File / public surface
 *   [2]  Scaled TWEAK_DEFAULTS (bigSlotW 76, bigSlotH 86, …)
 *   [3]  Grid template uses 1fr in the center column (regression guard
 *        for the diagnosed fixed-width root cause on the main frame)
 *   [4]  Primitives are imported from character-profile.tsx — no parallel
 *        SlotTile / HpBar / PortraitFrame / TribalOrnament defined locally
 *   [5]  Read-only behaviour — no onClick wired to slots / portrait,
 *        no SLOT_PICKER / portrait picker callbacks
 *   [6]  Slot layout matches the extracted spec (helmet → shoulders* →
 *        weapon → chest → belt; necklace → rings → gloves → offhand →
 *        pants* → boots)
 *   [7]  Belt sized {w: bigSlotW, h: beltSlotH} per spec
 *   [8]  PortraitFrame empty state copy overridden to "No portrait set"
 *        with the bronze + icon hidden
 *   [9]  HpBar wired to currentHp / maxHp
 *  [10]  PlayerProfileModal consumes MiniEquipmentFrame (no parallel doll)
 *  [11]  PortraitFrame exposes the new read-only props (onClick optional,
 *        emptyTitle, emptySubtitle, hidePlusIcon)
 *  [12]  Character page primitives are exported (regression guard against
 *        someone unexporting them and the mini frame quietly breaking)
 *  [13]  Modal `extraWide` prop wired to 960 max-width
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
  else fail(label, `unexpected substring present: ${needle}`);
}
function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function main(): void {
  // ===========================================================================
  // [1] File / public surface
  // ===========================================================================
  console.log('\n[1] MiniEquipmentFrame — file + exports');
  const mini = readSrc('frontend/src/components/social/mini-equipment-frame.tsx');
  contains(mini, 'export function MiniEquipmentFrame', 'MiniEquipmentFrame function exported');
  contains(mini, 'export interface MiniEquipmentFrameProps', 'props interface exported');
  contains(mini, 'export const MINI_FRAME_TWEAKS', 'scaled TWEAK constants exported');

  // ===========================================================================
  // [2] Scaled TWEAK_DEFAULTS at ~80% of the main frame
  // ===========================================================================
  console.log('\n[2] MINI_FRAME_TWEAKS — 80% scale of the main TWEAK_DEFAULTS');
  contains(mini, 'bigSlotW: 76', 'bigSlotW = 76 (was 96)');
  contains(mini, 'bigSlotH: 86', 'bigSlotH = 86 (was 108)');
  contains(mini, 'ringSlotSize: 35', 'ringSlotSize = 35 (was 44)');
  contains(mini, 'beltSlotH: 44', 'beltSlotH = 44 (was 56)');
  contains(mini, 'colGap: 6', 'colGap = 6 (was 8)');
  contains(mini, 'slotGap: 5', 'slotGap = 5 (was 6)');
  contains(mini, 'framePad: 10', 'framePad = 10 (was 12)');

  // ===========================================================================
  // [3] Grid template — center column stays 1fr
  // ===========================================================================
  console.log('\n[3] Mini frame grid — 76px 6px 1fr 6px 76px');
  contains(
    mini,
    '`${bigSlotW}px ${colGap}px 1fr ${colGap}px ${bigSlotW}px`',
    'grid-template-columns uses 1fr for the center (regression guard)',
  );
  notContains(mini, 'CENTER = round(', 'no legacy fixed-width CENTER constant in the mini frame');

  // ===========================================================================
  // [4] Primitives — imported, never duplicated
  // ===========================================================================
  console.log('\n[4] Primitives imported from character-profile.tsx');
  contains(
    mini,
    'from "@/components/character/character-profile"',
    'imports from the main Character page module',
  );
  contains(mini, 'SlotTile,', 'imports SlotTile primitive');
  contains(mini, 'HpBar,', 'imports HpBar primitive');
  contains(mini, 'PortraitFrame,', 'imports PortraitFrame primitive');
  contains(mini, 'TribalOrnament,', 'imports TribalOrnament primitive');
  // No parallel function definitions — those would defeat the reuse goal.
  notContains(mini, 'function SlotTile(', 'no parallel SlotTile function defined locally');
  notContains(mini, 'function HpBar(', 'no parallel HpBar function defined locally');
  notContains(mini, 'function PortraitFrame(', 'no parallel PortraitFrame function defined locally');
  notContains(mini, 'function TribalOrnament(', 'no parallel TribalOrnament function defined locally');

  // ===========================================================================
  // [5] Read-only — no onClick wired to slots, no portrait picker handler
  // ===========================================================================
  console.log('\n[5] Read-only — no click handlers wired through');
  notContains(mini, 'onClick={()', 'no inline onClick handlers anywhere in the mini frame');
  notContains(mini, 'onSlot', 'no onSlot callback prop forwarded');
  notContains(mini, 'onPortrait', 'no onPortrait callback prop forwarded');

  // ===========================================================================
  // [6] Slot layout — matches the extracted spec column order
  // ===========================================================================
  console.log('\n[6] Slot layout matches the extracted spec');
  const helmetIdx = mini.indexOf('slot="helmet"');
  const shouldersIdx = mini.indexOf('futureLabel="Shoulders"');
  const weaponIdx = mini.indexOf('slot="weapon"');
  const chestIdx = mini.indexOf('slot="chest"');
  const beltIdx = mini.indexOf('slot="belt"');
  if (
    helmetIdx > 0 &&
    shouldersIdx > helmetIdx &&
    weaponIdx > shouldersIdx &&
    chestIdx > weaponIdx &&
    beltIdx > chestIdx
  ) {
    ok('left col: helmet → shoulders* → weapon → chest → belt');
  } else {
    fail(
      'left col order',
      `helmet=${helmetIdx}, shoulders=${shouldersIdx}, weapon=${weaponIdx}, chest=${chestIdx}, belt=${beltIdx}`,
    );
  }
  const necklaceIdx = mini.indexOf('slot="necklace"');
  const ring1Idx = mini.indexOf('slot="ring1"');
  const ring2Idx = mini.indexOf('slot="ring2"');
  const ring3Idx = mini.indexOf('futureLabel="Ring 3"');
  const glovesIdx = mini.indexOf('slot="gloves"');
  const offhandIdx = mini.indexOf('slot="offhand"');
  const pantsIdx = mini.indexOf('futureLabel="Pants"');
  const bootsIdx = mini.indexOf('slot="boots"');
  if (
    necklaceIdx > 0 &&
    ring1Idx > necklaceIdx &&
    ring2Idx > ring1Idx &&
    ring3Idx > ring2Idx &&
    glovesIdx > ring3Idx &&
    offhandIdx > glovesIdx &&
    pantsIdx > offhandIdx &&
    bootsIdx > pantsIdx
  ) {
    ok('right col: necklace → ring1 → ring2 → ring3* → gloves → offhand → pants* → boots');
  } else {
    fail(
      'right col order',
      `necklace=${necklaceIdx}, ring1=${ring1Idx}, ring2=${ring2Idx}, ring3=${ring3Idx}, gloves=${glovesIdx}, offhand=${offhandIdx}, pants=${pantsIdx}, boots=${bootsIdx}`,
    );
  }

  // ===========================================================================
  // [7] Belt sized {w: bigSlotW, h: beltSlotH}
  // ===========================================================================
  console.log('\n[7] Belt sized bigSlotW × beltSlotH');
  contains(
    mini,
    '{ w: bigSlotW, h: beltSlotH }',
    'belt is bigSlotW × beltSlotH (76 × 44)',
  );

  // ===========================================================================
  // [8] PortraitFrame empty state — "No portrait set", no + icon
  // ===========================================================================
  console.log('\n[8] PortraitFrame read-only empty state');
  contains(mini, 'emptyTitle="No portrait set"', 'empty title overridden to read-only copy');
  contains(mini, 'emptySubtitle=""', 'subtitle suppressed in read-only mode');
  contains(mini, 'hidePlusIcon', 'bronze + icon hidden in read-only mode');

  // ===========================================================================
  // [9] HpBar wired to current / max hp
  // ===========================================================================
  console.log('\n[9] HpBar wired to current / max hp');
  contains(mini, 'current={currentHp}', 'HpBar current bound to currentHp prop');
  contains(mini, 'max={maxHp}', 'HpBar max bound to maxHp prop');

  // ===========================================================================
  // [10] PlayerProfileModal consumes MiniEquipmentFrame (no parallel doll)
  // ===========================================================================
  console.log('\n[10] PlayerProfileModal consumes MiniEquipmentFrame');
  const modal = readSrc('frontend/src/components/social/player-profile-modal.tsx');
  contains(modal, 'from "./mini-equipment-frame"', 'modal imports the mini frame');
  contains(modal, '<MiniEquipmentFrame', 'modal renders <MiniEquipmentFrame');
  contains(modal, 'equipment={profile.equipment}', 'mini frame receives profile.equipment');
  // Legacy ProfileSlot doll must be gone.
  notContains(modal, 'function ProfileSlot(', 'legacy ProfileSlot helper removed');
  notContains(modal, 'gridTemplateColumns: "repeat(5, 1fr)"', 'legacy 5-col flat doll grid removed');

  // ===========================================================================
  // [11] PortraitFrame read-only props on the main module
  // ===========================================================================
  console.log('\n[11] PortraitFrame exposes read-only props');
  const charProfile = readSrc('frontend/src/components/character/character-profile.tsx');
  contains(charProfile, 'export interface PortraitFrameProps', 'PortraitFrameProps exported');
  contains(charProfile, 'onClick?: () => void', 'PortraitFrame onClick optional');
  contains(charProfile, 'emptyTitle?: string', 'PortraitFrame accepts emptyTitle override');
  contains(charProfile, 'emptySubtitle?: ReactNode', 'PortraitFrame accepts emptySubtitle override');
  contains(charProfile, 'hidePlusIcon?: boolean', 'PortraitFrame accepts hidePlusIcon');
  contains(charProfile, 'const interactive = typeof onClick === "function"', 'falls back to non-interactive when onClick missing');

  // ===========================================================================
  // [12] Primitives are exported (regression guard)
  // ===========================================================================
  console.log('\n[12] Character page primitives are exported');
  contains(charProfile, 'export function SlotTile', 'SlotTile exported');
  contains(charProfile, 'export function HpBar', 'HpBar exported');
  contains(charProfile, 'export function PortraitFrame', 'PortraitFrame exported');
  contains(charProfile, 'export function TribalOrnament', 'TribalOrnament exported');

  // ===========================================================================
  // [13] Modal extraWide → 960
  // ===========================================================================
  console.log('\n[13] Modal extraWide prop wired to 960 max');
  const modalSrc = readSrc('frontend/src/components/ui/modal.tsx');
  contains(modalSrc, 'extraWide?: boolean', 'Modal exposes extraWide prop');
  contains(
    modalSrc,
    'maxWidth: extraWide ? 960 : wide ? 720 : 460',
    'extraWide bumps maxWidth to 960',
  );
  contains(modal, 'extraWide', 'PlayerProfileModal uses extraWide');

  console.log('\n' + '='.repeat(60));
  console.log(`MiniEquipmentFrame gauntlet: ${passes} passes / ${failures} failures`);
  console.log('='.repeat(60));
  if (failures > 0) {
    console.log('\nFAILURES:');
    for (const f of failureLog) console.log('  ' + f);
    process.exit(1);
  }
}

main();
