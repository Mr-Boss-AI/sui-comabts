/**
 * Landing page gauntlet — pins the wallet-disconnected hero
 * composition against
 * `design_v2/screenshopts/landing_page_target.png`.
 *
 *   $ cd server && npx tsx ../scripts/qa-landing.ts
 *
 * Static structural pins:
 *   [1] landing-page.tsx exports the LandingPage function
 *   [2] Hero left column has TESTNET·LIVE pill + hero Wordmark +
 *       tagline + 95/5 line + Connect/Watch buttons + badge row
 *   [3] Hero right column has three floating NFT cards from the
 *       deployment catalog
 *   [4] Three Steps tile row in canonical order (01 parchment / 02
 *       bronze / 03 blood-red) with the spec'd copy
 *   [5] Footer carries the small Wordmark + tech credit string
 *   [6] game-screen.tsx mounts the LandingPage at the wallet-
 *       disconnected branch (no more "A blockchain PvP arena" stub)
 *   [7] CONNECT WALLET CTA clicks the dapp-kit web component
 *   [8] Featured NFT data references the real testnet deployment
 *       image URLs (Pendant of Wrath / Dancer's Aegis /
 *       Whisperwind Amulet)
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
function readSrc(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function main(): void {
  // ===========================================================================
  // [1] LandingPage export
  // ===========================================================================
  console.log('\n[1] landing-page.tsx — public surface');
  const land = readSrc('frontend/src/components/landing/landing-page.tsx');
  contains(land, 'export function LandingPage', 'LandingPage exported');
  // Single-source-of-truth: only one default landing surface.
  if ((land.match(/export function LandingPage/g) ?? []).length === 1) {
    ok('only one LandingPage export');
  } else {
    fail('export uniqueness', 'multiple LandingPage exports detected');
  }

  // ===========================================================================
  // [2] Hero left column wiring
  // ===========================================================================
  console.log('\n[2] hero left column — pill + wordmark + tagline + CTAs');
  contains(land, 'Testnet · Live', 'TESTNET · LIVE pill copy present');
  contains(land, '<Wordmark size="hero"', 'hero variant of Wordmark used');
  contains(
    land,
    'Mint a fighter. Gear up with NFTs. Lock real SUI on the line and',
    'tagline line 1 verbatim',
  );
  contains(land, 'brawl through a 5-zone arena.', 'tagline line 2 verbatim');
  contains(land, '95/5', '95/5 split copy present');
  contains(land, 'split on every wager.', '95/5 split tail');
  contains(land, '<DangerButton size="lg"', 'Connect Wallet primary danger button');
  contains(land, 'Connect Wallet', 'Connect Wallet label');
  contains(land, '<GhostButton', 'Watch a Fight ghost button');
  contains(land, 'size="lg"', 'Watch a Fight ghost button is lg-sized');
  contains(land, 'Watch a Fight ▾', 'Watch a Fight label + chevron');
  // Bug 2 fix (2026-05-18) — button must drive the guest-spectator
  // flag, not the pre-fix `sc:nav` custom event that nothing listened
  // for. Pinning the literal dispatch wording keeps a future refactor
  // from silently regressing the disconnected-button case.
  contains(
    land,
    'type: "SET_SPECTATOR_MODE", enabled: true',
    'Watch a Fight onClick dispatches SET_SPECTATOR_MODE',
  );
  // Bottom badge row
  contains(land, 'Walrus · Decentralized', 'Walrus badge');
  contains(land, 'Open Source · MIT', 'Open Source · MIT badge');
  contains(land, 'Move v5 Contracts', 'Move v5 badge');

  // ===========================================================================
  // [3] Floating NFT cards
  // ===========================================================================
  console.log('\n[3] hero right column — floating NFT cards');
  contains(land, 'FloatingNftCard', 'FloatingNftCard component declared');
  contains(land, 'const FEATURED', 'FEATURED catalog declared');
  // 3 cards with distinct rotates / offsets / zIndexes
  const rotateMatches = land.match(/rotate: -?\d/g) ?? [];
  if (rotateMatches.length >= 3) {
    ok(`at least 3 rotated cards (${rotateMatches.length} found)`);
  } else {
    fail('floating card count', `expected ≥3 rotated cards, got ${rotateMatches.length}`);
  }
  // Hover lifts the card
  contains(land, 'translateY(-4px)', 'cards lift on hover');

  // ===========================================================================
  // [4] Three Steps tile row
  // ===========================================================================
  console.log('\n[4] three-steps tile row');
  contains(land, 'Three steps. Then chaos.', 'section title');
  contains(land, 'const STEPS', 'STEPS array declared');
  contains(land, '"01"', 'step 01 number');
  contains(land, '"02"', 'step 02 number');
  contains(land, '"03"', 'step 03 number');
  contains(land, 'Mint your fighter', 'step 01 title');
  contains(land, 'Gear up', 'step 02 title');
  contains(land, 'Lock in, brawl', 'step 03 title');
  contains(land, 'One-click character mint', 'step 01 body');
  contains(land, 'kiosk marketplace', 'step 02 body');
  contains(land, '20s turn timer, 5 zones', 'step 03 body');
  // Tile palettes
  contains(land, 'bg: "var(--sc-parchment)"', 'step 01 parchment fill');
  contains(land, 'bg: "var(--sc-bronze)"', 'step 02 bronze fill');
  contains(land, 'bg: "var(--sc-blood)"', 'step 03 blood-red fill');

  // ===========================================================================
  // [5] Footer
  // ===========================================================================
  console.log('\n[5] footer — small Wordmark + tech credits');
  contains(land, '<Wordmark size="footer"', 'footer Wordmark size');
  contains(land, 'Built on Sui', 'tech credit prefix');
  contains(land, '35/35 Move tests', 'Move test count');
  contains(land, 'MIT licensed', 'MIT licensed string');

  // ===========================================================================
  // [6] game-screen wires the Landing page at !account
  // ===========================================================================
  console.log('\n[6] game-screen mounts LandingPage at wallet-disconnected branch');
  const gs = readSrc('frontend/src/components/layout/game-screen.tsx');
  contains(
    gs,
    'import { LandingPage } from "@/components/landing/landing-page"',
    'LandingPage imported',
  );
  contains(gs, '<LandingPage />', 'LandingPage rendered in tree');
  // Old stub copy is gone.
  if (!gs.includes("A blockchain PvP arena — connect your wallet")) {
    ok('old v1 landing stub removed');
  } else {
    fail('landing cleanup', 'old "A blockchain PvP arena" stub still present');
  }

  // ===========================================================================
  // [7] CONNECT WALLET CTA wiring
  // ===========================================================================
  console.log('\n[7] Connect-Wallet CTA wired to dapp-kit modal');
  contains(land, 'clickNavbarConnect', 'helper to fire navbar connect modal');
  contains(land, 'mysten-dapp-kit-connect-button', 'queries the dapp-kit web component');

  // ===========================================================================
  // [8] Featured NFT data references real catalog
  // ===========================================================================
  console.log('\n[8] Featured NFT data references real testnet catalog');
  contains(land, 'Pendant of Wrath', 'Pendant of Wrath referenced');
  contains(land, "Dancer's Aegis", "Dancer's Aegis referenced");
  contains(land, 'Whisperwind Amulet', 'Whisperwind Amulet referenced');
  contains(
    land,
    'bafybeihrlw3jdq6ws2m3bjrjoyisvyyvtsp6mb2wnd6lps5hjtgatbwh3i',
    'Pinata folder CID matches deployment.testnet-v5.json catalog',
  );

  // ===========================================================================
  // [9] Responsive breakpoints exercised
  // ===========================================================================
  console.log('\n[9] responsive breakpoint usage');
  contains(land, "useBreakpoint", 'uses useBreakpoint');
  contains(land, "bpGte(\"lg\", bp)", 'gates hero side-by-side on lg');
  contains(land, "!bpGte(\"md\", bp)", 'stacks steps below md');

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n' + '='.repeat(60));
  console.log(`Landing page gauntlet: ${passes} passes / ${failures} failures`);
  console.log('='.repeat(60));
  if (failures > 0) {
    console.log('\nFAILURES:');
    for (const f of failureLog) console.log('  ' + f);
    process.exit(1);
  }
}

main();
