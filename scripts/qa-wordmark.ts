/**
 * Wordmark gauntlet — pins the chunky red+yellow comic outline
 * "SUI COMBATS" primitive against the Claude Design target
 * screenshot at `design_v2/screenshopts/landing_page_target.png`.
 *
 *   $ cd server && npx tsx ../scripts/qa-wordmark.ts
 *
 * Static structural pins:
 *   [1] design-tokens-v2.css declares --wordmark-{red,yellow,ink}
 *   [2] Hex values match the design spec
 *   [3] wordmark.tsx exports the right shape + size variants
 *   [4] Each variant has the expected font-size / stroke / shadow
 *   [5] "SUI" uses the red fill + ink stroke
 *   [6] "COMBATS" uses yellow fill + ink stroke + red drop-shadow
 *   [7] Navbar replaced its old wordmark with the primitive
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
  // [1] Token declarations
  // ===========================================================================
  console.log('\n[1] design-tokens-v2.css — wordmark vars present');
  const tokens = readSrc('frontend/src/styles/design-tokens-v2.css');
  contains(tokens, '--wordmark-red:', '--wordmark-red declared');
  contains(tokens, '--wordmark-yellow:', '--wordmark-yellow declared');
  contains(tokens, '--wordmark-ink:', '--wordmark-ink declared');

  // ===========================================================================
  // [2] Hex values pinned
  // ===========================================================================
  console.log('\n[2] hex values pinned');
  contains(tokens.toLowerCase(), '#d63b2e', 'wordmark-red = #d63b2e (hot blood)');
  contains(tokens.toLowerCase(), '#e0b03a', 'wordmark-yellow = #e0b03a (punchy bronze)');
  contains(tokens.toLowerCase(), '#08080a', 'wordmark-ink = #08080a (near-black)');

  // ===========================================================================
  // [3] Component exports
  // ===========================================================================
  console.log('\n[3] wordmark.tsx — public surface');
  const wm = readSrc('frontend/src/components/v2/wordmark.tsx');
  contains(wm, 'export function Wordmark', 'Wordmark function exported');
  contains(wm, 'export type WordmarkSize', 'WordmarkSize type exported');
  contains(wm, '"navbar" | "hero" | "footer"', 'all three size variants in the type');

  // ===========================================================================
  // [4] Variant config
  // ===========================================================================
  console.log('\n[4] variant config — size + stroke + shadow per variant');
  contains(wm, 'navbar: {', 'navbar variant declared');
  contains(wm, 'hero: {', 'hero variant declared');
  contains(wm, 'footer: {', 'footer variant declared');
  // Hero is the biggest size — at least 132px on the COMBATS half
  contains(wm, 'suiSize: 168', 'hero "SUI" size = 168px');
  contains(wm, 'combatsSize: 132', 'hero "COMBATS" size = 132px');
  // Hero stacked layout
  contains(wm, 'layout: "stacked"', 'hero layout = stacked');
  contains(wm, 'layout: "inline"', 'navbar/footer layout = inline');
  // Stroke thickness scales with size
  contains(wm, 'strokeWidth: 5', 'hero stroke = 5px');
  contains(wm, 'strokeWidth: 1.5', 'navbar stroke = 1.5px');

  // ===========================================================================
  // [5] "SUI" half — red fill + ink stroke
  // ===========================================================================
  console.log('\n[5] "SUI" half wiring');
  contains(wm, 'color: "var(--wordmark-red)"', '"SUI" fill = wordmark-red');
  contains(
    wm,
    'WebkitTextStroke: `${v.strokeWidth}px var(--wordmark-ink)`',
    '"SUI" stroke uses --wordmark-ink',
  );
  contains(wm, '<span style={sui}>SUI</span>', '"SUI" rendered as the first half');

  // ===========================================================================
  // [6] "COMBATS" half — yellow fill + ink stroke + red shadow
  // ===========================================================================
  console.log('\n[6] "COMBATS" half wiring');
  contains(wm, 'color: "var(--wordmark-yellow)"', '"COMBATS" fill = wordmark-yellow');
  contains(
    wm,
    'textShadow: `${v.shadowOffset}px ${v.shadowOffset}px 0 var(--wordmark-red)',
    '"COMBATS" drop-shadow uses --wordmark-red',
  );
  contains(wm, '<span style={combats}>COMBATS</span>', '"COMBATS" rendered as the second half');

  // ===========================================================================
  // [7] Comic-outline guarantees — no soft glow, paint order correct
  // ===========================================================================
  console.log('\n[7] comic-outline guarantees');
  contains(wm, 'paintOrder: "stroke fill"', 'paint order stroke→fill (stroke renders behind fill)');
  // Forbid soft glow — wordmark must be hard edges only.
  if (!wm.includes('filter: blur') && !wm.includes('boxShadow')) {
    ok('no blur / no box-shadow on wordmark chrome');
  } else {
    fail('hard-edges rule', 'found blur or boxShadow somewhere');
  }
  // No gradient on wordmark text fill — solid colour from token only.
  if (!/text\s*:\s*['"]?linear-gradient/i.test(wm)) {
    ok('no gradient on wordmark text fill');
  } else {
    fail('no-gradient rule', 'gradient fill detected on wordmark text');
  }

  // ===========================================================================
  // [8] Navbar wired to the new primitive
  // ===========================================================================
  console.log('\n[8] Navbar uses the Wordmark primitive');
  const navbar = readSrc('frontend/src/components/layout/navbar.tsx');
  contains(
    navbar,
    'import { Wordmark } from "@/components/v2/wordmark"',
    'Navbar imports Wordmark',
  );
  contains(navbar, '<Wordmark size="navbar"', 'Navbar renders the navbar variant');
  // Old hand-rolled wordmark span removed.
  if (!navbar.includes('SUI<span style={{ color: "var(--sc-bronze)" }}>Combats</span>')) {
    ok('old hand-rolled wordmark span removed from Navbar');
  } else {
    fail('navbar cleanup', 'old wordmark span still present');
  }

  // ===========================================================================
  // Summary
  // ===========================================================================
  console.log('\n' + '='.repeat(60));
  console.log(`Wordmark gauntlet: ${passes} passes / ${failures} failures`);
  console.log('='.repeat(60));
  if (failures > 0) {
    console.log('\nFAILURES:');
    for (const f of failureLog) console.log('  ' + f);
    process.exit(1);
  }
}

main();
