/**
 * v2 layout primitives gauntlet (Phase 2 layout sweep, 2026-05-13).
 *
 *   $ cd server && npx tsx ../scripts/qa-layout-primitives.ts
 *
 * Static structural pins for the new layout primitives + per-screen
 * Claude Design compositions:
 *
 *   [1] bpGte — breakpoint comparator (pure)
 *   [2] PodiumBlock tier configuration (rank 1/2/3 heights + tones)
 *   [3] ListingCard rarity tint map covers all 5 tiers
 *   [4] layout.tsx exports the full primitive surface
 *   [5] TopBanner tone+pill combinations declared
 *   [6] Hot-path screens reach for the new primitives via @/components/v2/layout
 *   [7] Character — exact pixel-spec equipment frame is wired (BIG=216,
 *       CENTER=462, RING=64, BELT=102)
 *   [8] Character — slot mapping flip preserved (left col[2] = Bracers
 *       v5.1, right col post-rings = canonical Gloves)
 *   [9] Arena — 3-up fight type row in tone-coded palettes
 *   [10] Market — uses ListingCard primitive + ThreeColumn
 *   [11] Tavern — 3-column (DMRow + ChatPanel + OnlineRow)
 *   [12] Hall of Fame — PodiumBlock × 3 + Ladder table
 *   [13] game-screen — AreaContent flattened (each screen owns its layout)
 *   [14] Backward-compat — every existing screen-level handler is
 *        wired through the new layout shells (Save Loadout, Cancel
 *        Queue, Wager Create, Open Profile, Open DM)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { bpGte, type Breakpoint } from '../frontend/src/components/v2/layout';

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
function eq<T>(actual: T, expected: T, label: string): void {
  if (Object.is(actual, expected)) ok(label);
  else
    fail(
      label,
      `actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`,
    );
}
function contains(haystack: string, needle: string, label: string): void {
  if (haystack.includes(needle)) ok(label);
  else fail(label, `missing substring: ${needle}`);
}

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function main(): void {
  // ===========================================================================
  // [1] bpGte — pure breakpoint comparator
  // ===========================================================================
  console.log('\n[1] bpGte — pure breakpoint comparator');
  const order: Breakpoint[] = ['sm', 'md', 'lg', 'xl'];
  // Every target ≤ current returns true
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) {
      const expected = j >= i;
      const actual = bpGte(order[i], order[j]);
      eq(actual, expected, `bpGte("${order[i]}", "${order[j]}") = ${expected}`);
    }
  }

  // ===========================================================================
  // [2] PodiumBlock tier config — heights + rank labels
  // ===========================================================================
  console.log('\n[2] PodiumBlock — tier configuration');
  const layout = readSrc('frontend/src/components/v2/layout.tsx');
  // Heights
  contains(layout, '1: 240, 2: 180, 3: 140', 'PODIUM_HEIGHTS — 1=240 / 2=180 / 3=140');
  // Number font sizes
  contains(layout, '1: 88, 2: 64, 3: 52', 'PODIUM_NUMBER_SIZE — 1=88 / 2=64 / 3=52');
  // Background tones
  contains(layout, '1: "var(--sc-bronze)"', 'rank 1 → bronze');
  contains(layout, '2: "var(--sc-parchment)"', 'rank 2 → parchment');
  contains(layout, '3: "var(--sc-blood)"', 'rank 3 → blood');
  // Rank labels
  contains(layout, "1: \"1st\"", 'rank 1 label = "1st"');
  contains(layout, "2: \"2nd\"", 'rank 2 label = "2nd"');
  contains(layout, "3: \"3rd\"", 'rank 3 label = "3rd"');

  // ===========================================================================
  // [3] ListingCard rarity tint covers all 5 tiers
  // ===========================================================================
  console.log('\n[3] ListingCard — rarity tint map');
  for (let r = 1; r <= 5; r++) {
    contains(layout, `${r}: { fg:`, `RARITY_TINT[${r}] declared`);
  }
  contains(layout, 'var(--rarity-common)', 'tint uses --rarity-common');
  contains(layout, 'var(--rarity-uncommon)', 'tint uses --rarity-uncommon');
  contains(layout, 'var(--rarity-rare)', 'tint uses --rarity-rare');
  contains(layout, 'var(--rarity-epic)', 'tint uses --rarity-epic');
  contains(layout, 'var(--rarity-legendary)', 'tint uses --rarity-legendary');

  // ===========================================================================
  // [4] layout.tsx exports
  // ===========================================================================
  console.log('\n[4] layout.tsx — exports complete');
  const EXPORTS = [
    'export function useBreakpoint',
    'export function bpGte',
    'export function ScreenLayout',
    'export function TopBanner',
    'export function ThreeColumn',
    'export function PodiumBlock',
    'export function ListingCard',
    'export function DMRow',
    'export function OnlineRow',
    'export function SectionHeader',
  ];
  for (const x of EXPORTS) contains(layout, x, x);

  // ===========================================================================
  // [5] TopBanner tone + pill combinations
  // ===========================================================================
  console.log('\n[5] TopBanner — tones + pills declared');
  contains(layout, 'BannerTone = "bronze" | "blood" | "gunmetal"', 'BannerTone union');
  contains(layout, 'PillKind = "onChain" | "testnet" | null', 'PillKind union');
  contains(layout, 'BANNER_BG: Record<BannerTone', 'BANNER_BG map');
  contains(layout, 'BANNER_TEXT: Record<BannerTone', 'BANNER_TEXT map');
  contains(layout, "kind === \"onChain\"", 'pill onChain branch present');

  // ===========================================================================
  // [6] Hot-path screens reach for the new primitives
  // ===========================================================================
  console.log('\n[6] hot-path screens import from @/components/v2/layout');
  const screens: Array<[string, string]> = [
    ['Character', 'frontend/src/components/character/character-profile.tsx'],
    ['Arena', 'frontend/src/components/fight/matchmaking-queue.tsx'],
    ['Market', 'frontend/src/components/marketplace/marketplace-browser.tsx'],
    ['Tavern', 'frontend/src/components/social/tavern-room.tsx'],
    ['Hall of Fame', 'frontend/src/components/social/leaderboard.tsx'],
  ];
  for (const [label, path] of screens) {
    const src = readSrc(path);
    contains(src, '@/components/v2/layout', `${label} imports @/components/v2/layout`);
    contains(src, '<TopBanner', `${label} renders <TopBanner`);
    contains(src, '<ScreenLayout', `${label} renders <ScreenLayout`);
  }

  // ===========================================================================
  // [7] Character — extracted-spec equipment frame
  // ===========================================================================
  // Pin re-anchored to the extracted Equipment Frame spec at
  //   design_v2/specs/character_equipment_frame_extracted.md
  // — values come from App.jsx TWEAK_DEFAULTS in the live design source.
  console.log('\n[7] Character — extracted-spec equipment frame');
  const char = readSrc('frontend/src/components/character/character-profile.tsx');
  // TWEAK_DEFAULTS constants — bigSlotW 96, bigSlotH 108, ringSlotSize 44,
  // beltSlotH 56, colGap 8, slotGap 6, framePad 12, statRowPad 4.
  contains(char, 'bigSlotW: 96', 'TWEAK_DEFAULTS.bigSlotW = 96');
  contains(char, 'bigSlotH: 108', 'TWEAK_DEFAULTS.bigSlotH = 108');
  contains(char, 'ringSlotSize: 44', 'TWEAK_DEFAULTS.ringSlotSize = 44');
  contains(char, 'beltSlotH: 56', 'TWEAK_DEFAULTS.beltSlotH = 56');
  contains(char, 'colGap: 8', 'TWEAK_DEFAULTS.colGap = 8');
  contains(char, 'slotGap: 6', 'TWEAK_DEFAULTS.slotGap = 6');
  contains(char, 'framePad: 12', 'TWEAK_DEFAULTS.framePad = 12');
  // Critical: grid template uses 1fr for the center column so the
  // portrait + ornament stretch. Fixed-pixel CENTER was the root cause
  // of the previous misalignment.
  contains(
    char,
    '`${bigSlotW}px ${colGap}px 1fr ${colGap}px ${bigSlotW}px`',
    'grid-template-columns = 96px 8px 1fr 8px 96px (center is 1fr)',
  );
  // No legacy CENTER constant — it would re-introduce the fixed-width regression.
  if (!/const CENTER = round\(462\)/.test(char)) {
    ok('legacy CENTER = round(462) removed — center column is 1fr');
  } else {
    fail('center column', 'CENTER = round(462) re-introduced; center must stay 1fr');
  }
  // HP bar height 22 per extracted spec.
  contains(char, 'height = 22', 'HpBar height = 22');
  // Ornament height 56 per extracted spec.
  contains(char, '<TribalOrnament height={56} />', 'Ornament height = 56');

  // -------------------------------------------------------------------------
  // [7b] SlotTile — extracted shadow + image recipe
  // -------------------------------------------------------------------------
  // Per spec: contained image, padding 4, drop-shadow filter; empty
  // shadow recipe pins the chunky inset look from the design source.
  console.log('\n[7b] Character — SlotTile recipe pinned to extracted spec');
  contains(char, 'objectFit: "contain"', 'slot img objectFit = contain (extracted spec)');
  contains(char, 'padding: 4,', 'slot img padding 4');
  contains(
    char,
    'inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 0 rgba(0,0,0,.55), 1px 1px 0 rgba(0,0,0,.6)',
    'empty SlotTile shadow recipe pinned',
  );
  contains(
    char,
    '"0 0 0 1px var(--sc-bronze)"',
    'dirty/equipped SlotTile shadow = 0 0 0 1px var(--sc-bronze)',
  );

  // -------------------------------------------------------------------------
  // [7c] PortraitFrame — flex:1 inside center column
  // -------------------------------------------------------------------------
  console.log('\n[7c] Character — PortraitFrame stretches inside center column');
  contains(char, 'flex: 1,', 'PortraitFrame uses flex: 1 (no fixed height)');
  contains(char, 'minHeight: 0,', 'PortraitFrame min-height: 0 so flex can shrink');
  // No aspectRatio 3/4 lock — the portrait now stretches to fill the
  // center column; spec says width:100% + flex:1.
  if (!/aspectRatio:\s*"3 \/ 4"/.test(char)) {
    ok('aspectRatio 3/4 lock removed — portrait stretches via flex');
  } else {
    fail('portrait sizing', 'aspectRatio 3/4 still pinned; should be flex:1');
  }

  // ===========================================================================
  // [8] Character — extracted slot order (left + right column)
  // ===========================================================================
  console.log('\n[8] Character — slot mapping per extracted column layout');
  // Left: Helmet · Shoulders* · Weapon · Chest · Belt(56)
  const helmetIdx = char.indexOf('slot="helmet"');
  const shouldersIdx = char.indexOf('futureLabel="Shoulders"');
  const weaponIdx = char.indexOf('slot="weapon"');
  if (
    helmetIdx > 0 &&
    shouldersIdx > helmetIdx &&
    weaponIdx > shouldersIdx
  ) {
    ok('left col: helmet → shoulders* → weapon (extracted order)');
  } else {
    fail(
      'left col order',
      `helmet=${helmetIdx}, shoulders=${shouldersIdx}, weapon=${weaponIdx}`,
    );
  }
  // Right: Necklace · [Ring1 Ring2 Ring3*] · Gloves · Off-hand · Pants* · Boots
  const necklaceIdx = char.indexOf('slot="necklace"');
  const glovesIdx = char.indexOf('slot="gloves"');
  const offhandIdx = char.indexOf('slot="offhand"');
  const pantsIdx = char.indexOf('futureLabel="Pants"');
  const bootsIdx = char.indexOf('slot="boots"');
  if (
    necklaceIdx > 0 &&
    glovesIdx > necklaceIdx &&
    offhandIdx > glovesIdx &&
    pantsIdx > offhandIdx &&
    bootsIdx > pantsIdx
  ) {
    ok('right col: necklace → rings → gloves → offhand → pants* → boots');
  } else {
    fail(
      'right col order',
      `necklace=${necklaceIdx}, gloves=${glovesIdx}, offhand=${offhandIdx}, pants=${pantsIdx}, boots=${bootsIdx}`,
    );
  }
  // Belt sized w:bigSlotW, h:beltSlotH per extracted spec.
  contains(
    char,
    '{ w: bigSlotW, h: beltSlotH }',
    'Belt sized bigSlotW × beltSlotH (96 × 56)',
  );

  // ===========================================================================
  // [9] Arena — 3-up fight tile row tone-coded
  // ===========================================================================
  console.log('\n[9] Arena — 3-up tone-coded tile row');
  const arena = readSrc('frontend/src/components/fight/matchmaking-queue.tsx');
  contains(arena, 'gridTemplateColumns: "repeat(3, 1fr)"', 'fight type row is 3-col grid');
  contains(arena, 'minHeight: 260', 'fight type tiles ≥ 260px tall');
  // Tone palettes per fight type
  contains(arena, 'bg: "var(--sc-parchment)"', 'friendly tile = parchment fill');
  contains(arena, 'bg: "var(--sc-bronze)"', 'ranked tile = bronze fill');
  contains(arena, 'bg: "var(--sc-blood)"', 'wager tile = blood-red fill');
  // CTAs per tile
  contains(arena, 'Find a sparring partner', 'friendly CTA');
  contains(arena, 'Enter Queue ▾', 'ranked CTA');
  contains(arena, 'Create Wager ▾', 'wager CTA');
  // Queue panel with frog mascot
  contains(arena, '"Looking for fighter…"', 'queue panel Slackey headline');
  contains(arena, '🐸', 'queue panel mascot');
  contains(arena, 'Widen ELO Range', 'queue panel widen button');

  // ===========================================================================
  // [10] Market — ListingCard + ThreeColumn
  // ===========================================================================
  console.log('\n[10] Market — ListingCard + ThreeColumn composition');
  const market = readSrc('frontend/src/components/marketplace/marketplace-browser.tsx');
  contains(market, 'ListingCard', 'Market uses ListingCard primitive');
  contains(market, '<ThreeColumn', 'Market uses ThreeColumn');
  contains(market, 'Maul, ring, hood…', 'Market search placeholder');
  contains(market, 'Low to High', 'Market sort: Low to High');
  contains(market, 'Recent', 'Market sort: Recent');
  contains(market, 'twoHanded={', 'Market passes 2H flag to ListingCard');

  // ===========================================================================
  // [11] Tavern — DMRow + ChatPanel + OnlineRow
  // ===========================================================================
  console.log('\n[11] Tavern — 3-column composition');
  const tavern = readSrc('frontend/src/components/social/tavern-room.tsx');
  contains(tavern, '<DMRow', 'Tavern renders DMRow');
  contains(tavern, '<OnlineRow', 'Tavern renders OnlineRow');
  contains(tavern, '<ChatPanel', 'Tavern renders ChatPanel');
  contains(tavern, 'Direct Messages', 'DM sidebar header');
  contains(tavern, 'Online ·', 'Online sidebar header');
  contains(tavern, 'The Tavern', 'Center chat header');

  // ===========================================================================
  // [12] Hall of Fame — PodiumBlock × 3 + Ladder
  // ===========================================================================
  console.log('\n[12] Hall of Fame — podium + ladder');
  const hof = readSrc('frontend/src/components/social/leaderboard.tsx');
  contains(hof, '<PodiumBlock', 'HoF renders PodiumBlock');
  contains(hof, 'rank={1}', 'HoF renders rank-1 podium');
  contains(hof, 'rank={2}', 'HoF renders rank-2 podium');
  contains(hof, 'rank={3}', 'HoF renders rank-3 podium');
  contains(hof, 'By ELO · 7-Day', 'Ladder right-side stamp');
  // Order: 2 / 1 / 3 in the grid
  const r2Idx = hof.indexOf('rank={2}');
  const r1Idx = hof.indexOf('rank={1}');
  const r3Idx = hof.indexOf('rank={3}');
  if (r2Idx > 0 && r1Idx > r2Idx && r3Idx > r1Idx) {
    ok('podium grid order: 2 → 1 → 3');
  } else {
    fail('podium order', `r2=${r2Idx} r1=${r1Idx} r3=${r3Idx}`);
  }
  // Current user row highlight
  contains(hof, 'isMe', 'LadderRow highlights current user');
  contains(hof, '· you', 'current-user "· you" suffix');

  // ===========================================================================
  // [13] game-screen — AreaContent flattened
  // ===========================================================================
  console.log('\n[13] game-screen — AreaContent flattened');
  const gameScreen = readSrc('frontend/src/components/layout/game-screen.tsx');
  // The old per-screen grid wrappers (grid-cols-1 lg:grid-cols-3) are gone
  // from AreaContent's switch — each screen owns its own layout now.
  const areaContentIdx = gameScreen.indexOf('function AreaContent');
  const areaContentBlock = gameScreen.slice(areaContentIdx, areaContentIdx + 1200);
  if (!areaContentBlock.includes('lg:grid-cols-3')) {
    ok('AreaContent does NOT wrap screens in lg:grid-cols-3 anymore');
  } else {
    fail('AreaContent flattening', 'still wrapping in lg:grid-cols-3');
  }
  contains(gameScreen, '<CharacterProfile character={character}', 'Character routed flat');
  contains(gameScreen, '<MatchmakingQueue />', 'Arena routed flat');
  contains(gameScreen, '<MarketplaceBrowser />', 'Market routed flat');
  contains(gameScreen, '<TavernRoom />', 'Tavern routed flat');
  contains(gameScreen, '<Leaderboard />', 'HoF routed flat');

  // ===========================================================================
  // [14] Backward-compat — handlers preserved
  // ===========================================================================
  console.log('\n[14] handlers + WS dispatches preserved');
  // Character — Save Loadout / Discard / NFT picker / Stat allocate
  contains(char, 'saveLoadout', 'Character: saveLoadout handler wired');
  contains(char, 'stageDiscard', 'Character: stageDiscard handler wired');
  contains(char, 'commitPortrait', 'Character: portrait commit handler wired');
  contains(char, 'StatAllocateModal', 'Character: StatAllocateModal mounted');
  contains(char, 'NftPortraitPicker', 'Character: NftPortraitPicker mounted');
  // Arena — accept/cancel/create wager
  contains(arena, 'handleQueue', 'Arena: handleQueue handler wired');
  contains(arena, 'handleCancel', 'Arena: handleCancel handler wired');
  contains(arena, 'handleAcceptWager', 'Arena: handleAcceptWager handler wired');
  // Market — BuyListingModal
  contains(market, 'BuyListingModal', 'Market: BuyListingModal mounted');
  contains(market, 'MyKioskPanel', 'Market: MyKioskPanel embedded');
  // Tavern — OPEN_DM + OPEN_PROFILE dispatches
  contains(tavern, 'OPEN_DM', 'Tavern: OPEN_DM dispatch wired');
  contains(tavern, 'OPEN_PROFILE', 'Tavern: OPEN_PROFILE dispatch wired');
  // HoF — OPEN_PROFILE on podium + ladder
  contains(hof, 'OPEN_PROFILE', 'HoF: OPEN_PROFILE dispatch wired');

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n' + '='.repeat(60));
  console.log(`v2 layout primitives gauntlet: ${passes} passes / ${failures} failures`);
  console.log('='.repeat(60));
  if (failures > 0) {
    console.log('\nFAILURES:');
    for (const f of failureLog) console.log('  ' + f);
    process.exit(1);
  }
}

main();
