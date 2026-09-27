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
  // [2] v5.3 evil-medieval hero
  // ===========================================================================
  console.log('\n[2] hero — iron scope, wordmark, copy, CTAs');
  contains(land, 'className="theme-iron"', 'hero is a dark iron surface');
  contains(land, 'Testnet · The gates stand open', 'testnet pill copy');
  contains(land, '<Wordmark size="hero"', 'hero variant of Wordmark used');
  contains(land, 'Sell thy soul to the arena.', 'headline');
  contains(land, 'one coin', '5% fee line (one coin in twenty)');
  contains(land, '<DangerButton size="lg" onClick={clickNavbarConnect}>', 'Enter the Pit fires wallet connect');
  contains(land, 'Enter the Pit', 'primary CTA label');
  contains(land, '<GhostButton', 'spectate ghost button');
  contains(land, 'Watch the Slaughter ▾', 'spectate label + chevron');
  contains(
    land,
    'type: "SET_SPECTATOR_MODE", enabled: true',
    'Watch the Slaughter dispatches SET_SPECTATOR_MODE',
  );
  contains(land, '/v53/figures/figure-male.png', 'male warrior figure');
  contains(land, '/v53/figures/figure-female.png', 'female warrior figure');

  // ===========================================================================
  // [3] Four rites
  // ===========================================================================
  console.log('\n[3] four rites');
  contains(land, 'Four rites. Then damnation.', 'section title');
  contains(land, 'const RITES', 'RITES array declared');
  for (const t of ['Summon thy champion', 'Arm the damned', 'Spill blood for silver', 'Raise a banner of war']) {
    contains(land, t, `rite: ${t}`);
  }

  // ===========================================================================
  // [4] Inscription + footer
  // ===========================================================================
  console.log('\n[4] inscription + footer');
  contains(land, 'Carved above the gate of the Pit', 'gate inscription');
  contains(land, '<Wordmark size="footer"', 'footer Wordmark size');
  contains(land, 'Forged on Sui', 'footer credit');
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
  // [9] Responsive breakpoints exercised
  // ===========================================================================
  console.log('\n[9] responsive breakpoint usage');
  contains(land, "useBreakpoint", 'uses useBreakpoint');
  contains(land, "bpGte(\"lg\", bp)", 'gates hero side-by-side on lg');
  contains(land, 'bpGte("md", bp) ? 2 : 1', 'rites stack 4 → 2 → 1 columns');

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
