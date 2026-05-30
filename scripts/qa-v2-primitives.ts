/**
 * v2 design-system primitives gauntlet (Phase 2 sweep, 2026-05-13).
 *
 *   $ cd server && npx tsx ../scripts/qa-v2-primitives.ts
 *
 * Static structural pins for the new v2 primitives + design tokens.
 * Pure JS — reads the token CSS + primitive TSX directly and asserts
 * that the design contract holds. No JSDOM rendering — we don't need
 * a browser to enforce that:
 *
 *   1. design-tokens-v2.css declares every token consumed by the v2
 *      primitives + components/ui/*.
 *   2. Backward-compat aliases (--sc-yellow / --sc-red / --sc-paper /
 *      --sc-night) still resolve through to the new metal tokens.
 *   3. v2 primitives export every name screens import.
 *   4. components/ui/{button,card,badge,modal}.tsx — the cascade
 *      surface — no longer leak v1 visual debt (no rounded-lg, no
 *      bg-emerald-, no bg-amber-, no soft drop shadow on chrome).
 *   5. Character screen's slot-mapping flip stays applied (left col =
 *      Bracers v5.1 future, right col = canonical Gloves).
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
function absent(haystack: string, needle: string, label: string): void {
  if (!haystack.includes(needle)) ok(label);
  else fail(label, `unexpected substring present: ${needle}`);
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function main(): void {
  // ===========================================================================
  // [1] design-tokens-v2.css — every required token is declared
  // ===========================================================================
  console.log('\n[1] design-tokens-v2.css — required tokens present');
  const tokens = readSrc('frontend/src/styles/design-tokens-v2.css');
  const REQUIRED_TOKENS = [
    // Backgrounds
    '--bg-page', '--bg-surface', '--bg-surface-2', '--bg-surface-3',
    '--sc-page', '--sc-panel', '--sc-panel-2', '--sc-panel-3',
    // Foreground
    '--sc-parchment', '--fg-1', '--fg-2', '--fg-3',
    // Bronze
    '--sc-bronze', '--sc-bronze-deep', '--sc-bronze-hot', '--sc-bronze-glow',
    // Blood
    '--sc-blood', '--sc-blood-deep',
    // Steel
    '--sc-steel', '--sc-steel-deep', '--sc-steel-low',
    // Rims
    '--sc-rim', '--sc-rim-2', '--sc-ash', '--sc-ash-2',
    // Rarity
    '--rarity-common', '--rarity-uncommon', '--rarity-rare',
    '--rarity-epic', '--rarity-legendary',
    // Stats
    '--stat-hp', '--stat-str', '--stat-dex', '--stat-int', '--stat-end',
    // Radii
    '--r-sharp', '--r-sm', '--r-card', '--r-button', '--r-pill',
    // Shadows
    '--sh-plate-sm', '--sh-plate', '--sh-plate-lg', '--sh-pop',
    '--rim-top', '--rim-bottom',
    // Motion
    '--d-fast', '--d-base', '--d-slow', '--ease-out', '--ease-pop',
    // Layout
    '--container-max',
    // Typography
    '--font-display', '--font-ui', '--font-mono',
    '--ls-button', '--ls-stamp',
  ];
  for (const t of REQUIRED_TOKENS) contains(tokens, t, `${t} declared`);

  // ===========================================================================
  // [2] Hex values pinned by the design system
  // ===========================================================================
  console.log('\n[2] canonical hex values pinned');
  const PINS: Array<[string, string]> = [
    ['gunmetal page',     '#0a0d12'],
    ['surface panel',     '#15191f'],
    ['surface panel-2',   '#1a1f28'],
    ['surface panel-3',   '#222831'],
    ['parchment',         '#e8e2d4'],
    ['bronze',            '#c89a3f'],
    ['blood',             '#b53d2c'],
    ['steel',             '#6d8fa3'],
    ['steel rim',         '#2c333d'],
    ['rarity epic',       '#7d4ba5'],
  ];
  for (const [label, hex] of PINS) {
    contains(tokens.toLowerCase(), hex.toLowerCase(), `${label} ${hex}`);
  }

  // ===========================================================================
  // [3] Backward-compat aliases — v1 Ponke names still resolve
  // ===========================================================================
  console.log('\n[3] backward-compat aliases (v1 Ponke tokens)');
  contains(tokens, '--sc-yellow:', '--sc-yellow alias declared');
  contains(tokens, '--sc-red:', '--sc-red alias declared');
  contains(tokens, '--sc-paper:', '--sc-paper alias declared');
  contains(tokens, '--sc-night:', '--sc-night alias declared');
  // Aliases must point at the new metal tokens, not at hex literals.
  contains(
    tokens.replace(/\s+/g, ' '),
    '--sc-yellow: var(--sc-bronze)',
    '--sc-yellow → --sc-bronze',
  );
  contains(
    tokens.replace(/\s+/g, ' '),
    '--sc-red: var(--sc-blood)',
    '--sc-red → --sc-blood',
  );

  // ===========================================================================
  // [4] v2 primitives export every name screens import
  // ===========================================================================
  console.log('\n[4] v2 primitives — exports complete');
  const v2 = readSrc('frontend/src/components/v2/index.tsx');
  const REQUIRED_EXPORTS = [
    'export function RimFrame',
    'export function DisplayTitle',
    'export function Stamp',
    'export const BronzeButton',
    'export const DangerButton',
    'export const SteelButton',
    'export const SecondaryButton',
    'export function GhostButton',
    'export const V2Input',
    'export function V2Chip',
    'export function V2Tab',
    'export function ToneDivider',
    'export function SectionLabel',
  ];
  for (const x of REQUIRED_EXPORTS) contains(v2, x, x);

  // ===========================================================================
  // [5] Stamp tones — full palette wired
  // ===========================================================================
  console.log('\n[5] Stamp tones — full palette');
  const STAMP_TONES = [
    'default', 'bronze', 'blood', 'steel',
    'uncommon', 'rare', 'epic', 'legendary', 'common',
  ];
  for (const t of STAMP_TONES) contains(v2, `${t}: {`, `Stamp tone ${t}`);

  // ===========================================================================
  // [6] ui/* primitive rewrites — no v1 visual debt remains
  // ===========================================================================
  console.log('\n[6] ui/{button,card,badge,modal} — v1 debt purged');
  const uiButton = readSrc('frontend/src/components/ui/button.tsx');
  const uiCard = readSrc('frontend/src/components/ui/card.tsx');
  const uiBadge = readSrc('frontend/src/components/ui/badge.tsx');
  const uiModal = readSrc('frontend/src/components/ui/modal.tsx');

  // Pastel emerald/amber backgrounds are out. (We grep below the
  // licence comment so the docstring mention of "no rounded-lg" doesn't
  // count as code.)
  const uiButtonCode = uiButton.split('*/')[1] ?? uiButton;
  absent(uiButtonCode, 'bg-emerald-500', 'button: no emerald fill');
  absent(uiButtonCode, 'bg-amber-500', 'button: no amber fill');
  absent(uiButtonCode, 'rounded-lg', 'button: no rounded-lg');
  // shadow-lg shadow-* (Tailwind soft-blur drop shadow) is design-system contraband
  absent(uiButtonCode, 'shadow-lg shadow-emerald', 'button: no emerald glow shadow');
  absent(uiButtonCode, 'shadow-lg shadow-red', 'button: no red glow shadow');

  // Card now reads from CSS vars
  contains(uiCard, 'var(--sc-rim)', 'card: steel rim from token');
  contains(uiCard, 'var(--sh-plate', 'card: plate shadow from token');
  absent(uiCard, 'border-amber-900/20', 'card: no amber Tailwind border');

  // Badge no longer uses the old amber/red/green Tailwind classes
  contains(uiBadge, 'var(--sc-bronze)', 'badge: bronze from token');
  contains(uiBadge, 'var(--sc-blood)', 'badge: blood from token');
  contains(uiBadge, 'var(--rarity-uncommon)', 'badge: uncommon rarity bridge');

  // Modal: no backdrop-blur (design system mandate)
  absent(uiModal, 'backdrop-blur', 'modal: no backdrop-blur (forged-plate rule)');
  contains(uiModal, 'var(--sc-bronze)', 'modal: bronze rim');
  // Bronze rim color (2px solid)
  contains(uiModal, '2px solid var(--sc-bronze)', 'modal: 2px bronze rim');

  // ===========================================================================
  // [7] Character screen — slot mapping pinned to extracted spec
  // ===========================================================================
  // Pin re-anchored to
  //   design_v2/specs/character_equipment_frame_extracted.md
  // — values come from App.jsx TWEAK_DEFAULTS in the live design source.
  console.log('\n[7] character-profile — extracted slot mapping');
  const charProfile = readSrc('frontend/src/components/character/character-profile.tsx');
  // Left col (extracted): helmet → shoulders* → weapon → chest → belt
  const leftOrderIdx = {
    helmet:    charProfile.indexOf('slot="helmet"'),
    shoulders: charProfile.indexOf('futureLabel="Shoulders"'),
    weapon:    charProfile.indexOf('slot="weapon"'),
    chest:     charProfile.indexOf('slot="chest"'),
  };
  if (
    leftOrderIdx.helmet > 0 &&
    leftOrderIdx.shoulders > leftOrderIdx.helmet &&
    leftOrderIdx.weapon > leftOrderIdx.shoulders &&
    leftOrderIdx.chest > leftOrderIdx.weapon
  ) {
    ok('left col order: helmet → shoulders* → weapon → chest');
  } else {
    fail(
      'left col order',
      `helmet=${leftOrderIdx.helmet}, shoulders=${leftOrderIdx.shoulders}, weapon=${leftOrderIdx.weapon}, chest=${leftOrderIdx.chest}`,
    );
  }
  contains(charProfile, 'futureLabel="Shoulders"', 'left col[2] is future Shoulders (v5.1)');
  // Right col: necklace → ring row → gloves → off-hand → pants* → boots
  const ringRowIdx = charProfile.indexOf('Ring row');
  const glovesIdx = charProfile.indexOf('slot="gloves"');
  const offhandIdx = charProfile.indexOf('slot="offhand"');
  if (ringRowIdx > 0 && glovesIdx > ringRowIdx && offhandIdx > glovesIdx) {
    ok('right col: Ring row → Gloves → Off-hand');
  } else {
    fail(
      'right col gloves ordering',
      `ringRow=${ringRowIdx}, gloves=${glovesIdx}, offhand=${offhandIdx}`,
    );
  }
  // Extracted-spec pixel values from TWEAK_DEFAULTS in App.jsx — bigSlotW
  // 96, bigSlotH 108, beltSlotH 56. The center column is now 1fr, not a
  // fixed CENTER constant (which was the diagnosed root cause).
  contains(charProfile, 'bigSlotW: 96', 'TWEAK_DEFAULTS.bigSlotW = 96');
  contains(charProfile, 'bigSlotH: 108', 'TWEAK_DEFAULTS.bigSlotH = 108');
  contains(charProfile, 'beltSlotH: 56', 'TWEAK_DEFAULTS.beltSlotH = 56');

  // ===========================================================================
  // [8] Hot-paths: every screen imports v2 primitives
  // ===========================================================================
  console.log('\n[8] hot-path screens import v2 primitives');
  const screens: Array<[string, string]> = [
    ['Hall of Fame', 'frontend/src/components/social/leaderboard.tsx'],
    ['Tavern chat', 'frontend/src/components/social/chat-panel.tsx'],
    ['Tavern sidebar', 'frontend/src/components/social/player-sidebar.tsx'],
    ['Tavern room shell', 'frontend/src/components/social/tavern-room.tsx'],
    ['PlayerProfileModal', 'frontend/src/components/social/player-profile-modal.tsx'],
  ];
  for (const [label, path] of screens) {
    const src = readSrc(path);
    contains(src, '@/components/v2', `${label} imports @/components/v2`);
  }

  // ===========================================================================
  // [9] layout.tsx — next/font wired correctly
  // ===========================================================================
  console.log('\n[9] layout.tsx — Slackey + Poppins + JetBrains_Mono');
  const layout = readSrc('frontend/src/app/layout.tsx');
  contains(layout, 'Slackey', 'Slackey display font imported');
  contains(layout, 'Poppins', 'Poppins UI font imported');
  contains(layout, 'JetBrains_Mono', 'JetBrains Mono imported');
  contains(layout, '--font-display-src', 'display CSS var emitted');
  contains(layout, '--font-ui-src', 'ui CSS var emitted');
  contains(layout, '--font-mono-src', 'mono CSS var emitted');
  contains(layout, 'var(--bg-page)', 'body bg = gunmetal page');
  contains(layout, 'var(--sc-parchment)', 'body text = parchment');

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n' + '='.repeat(60));
  console.log(`v2 primitives gauntlet: ${passes} passes / ${failures} failures`);
  console.log('='.repeat(60));
  if (failures > 0) {
    console.log('\nFAILURES:');
    for (const f of failureLog) console.log('  ' + f);
    process.exit(1);
  }
}

main();
