/**
 * zkLogin wallet-registration gauntlet — Phase A, 2026-05-17.
 *
 *   $ cd server && npx tsx ../scripts/qa-zklogin-wallet-registration.ts
 *
 * Pins the structural wiring that lands zkLogin via Enoki + the
 * canonical Slush web wallet in the dApp Kit connect modal. The
 * gauntlet is grep-style — no DOM, no React render, no live OAuth
 * round-trip. Each assertion is a regression guard against a stray
 * refactor silently dropping the integration:
 *
 *   [1] frontend/src/config/enoki.ts — provider config snapshot
 *   [2] frontend/src/config/dapp-kit.ts — initializer wiring
 *   [3] frontend/.env.local.example — env vars documented
 *   [4] frontend/package.json — Enoki dep declared
 *   [5] Apple-deferred annotation preserved (Enoki 1.0.8 AuthProvider
 *       union excludes 'apple'; surfacing the gap clearly in code +
 *       env example so it isn't silently forgotten when the SDK adds
 *       Apple support)
 *   [6] Signed-challenge JWT auth surface unchanged — zkLogin-derived
 *       wallets implement Wallet Standard `signPersonalMessage`, so the
 *       existing `frontend/src/app/game-provider.tsx` flow + server
 *       `verifyPersonalMessageSignature` flow both work unmodified.
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import { readFileSync, existsSync } from 'fs';
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
  // ============================================================
  // [1] frontend/src/config/enoki.ts — provider config + ready guard
  // ============================================================
  section('[1] enoki.ts — provider config snapshot');
  const enokiPath = 'frontend/src/config/enoki.ts';
  if (!existsSync(join(ROOT, enokiPath))) {
    fail('enoki.ts exists', `expected ${enokiPath} to be present`);
  } else {
    ok('enoki.ts exists');
    const enoki = readSrc(enokiPath);
    contains(enoki, "import type { AuthProvider } from \"@mysten/enoki\"", 'imports AuthProvider type from @mysten/enoki');
    contains(enoki, 'export interface EnokiProviderEntry', 'exports EnokiProviderEntry shape');
    contains(enoki, 'export interface EnokiConfigSnapshot', 'exports EnokiConfigSnapshot shape');
    contains(enoki, 'export function readEnokiConfig', 'exports readEnokiConfig()');
    contains(enoki, 'export const ENOKI_CONFIG', 'exports module-load snapshot');
    contains(enoki, 'export const ENOKI_READY', 'exports ENOKI_READY guard');
    contains(enoki, 'process.env.NEXT_PUBLIC_ENOKI_API_KEY', 'reads NEXT_PUBLIC_ENOKI_API_KEY env');
    contains(enoki, 'process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'reads NEXT_PUBLIC_GOOGLE_CLIENT_ID env');
    contains(enoki, 'process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID', 'reads NEXT_PUBLIC_TWITCH_CLIENT_ID env');
    contains(enoki, 'provider: "google"', 'google provider candidate present');
    contains(enoki, 'provider: "twitch"', 'twitch provider candidate present');
    // Apple is deliberately commented out — see section [5]
    contains(enoki, '// Apple deferred', 'apple-deferred annotation present in code');
  }

  // ============================================================
  // [2] frontend/src/config/dapp-kit.ts — initializer wiring
  // ============================================================
  section('[2] dapp-kit.ts — Enoki initializer wired through walletInitializers');
  const dappKit = readSrc('frontend/src/config/dapp-kit.ts');
  contains(dappKit, 'import { enokiWalletsInitializer } from "@mysten/enoki"', 'imports enokiWalletsInitializer (the dapp-kit-aware path)');
  contains(dappKit, 'import { ENOKI_CONFIG, ENOKI_READY } from "./enoki"', 'imports the provider config snapshot');
  contains(dappKit, 'const ENOKI_INITIALIZER', 'declares the module-load initializer constant');
  contains(dappKit, 'ENOKI_READY && ENOKI_CONFIG.apiKey', 'gates registration on ENOKI_READY + apiKey presence');
  contains(dappKit, 'enokiWalletsInitializer({', 'invokes the initializer factory');
  contains(dappKit, 'apiKey: ENOKI_CONFIG.apiKey', 'passes the Enoki API key');
  contains(dappKit, 'providers: Object.fromEntries(', 'builds providers map from the config snapshot');
  contains(dappKit, 'walletInitializers: ENOKI_INITIALIZER ? [ENOKI_INITIALIZER] : []', 'plugs the initializer into createDAppKit');
  // Pin the redirectUrl wiring so a future refactor doesn't silently
  // revert to Enoki's window.location.href default — which sends a
  // different redirect_uri from each page the user lands on, breaking
  // OAuth provider strict-match validation. Bug originally tripped by
  // Twitch returning `redirect_mismatch` against a registered
  // `/auth/callback` while Enoki sent bare `/`.
  contains(dappKit, 'ENOKI_REDIRECT_URL', 'declares an explicit redirect URL constant');
  contains(dappKit, "new URL(\"/auth/callback\", window.location.origin)", 'pins redirect URL to <origin>/auth/callback');
  contains(dappKit, 'redirectUrl: ENOKI_REDIRECT_URL', 'passes the pinned redirect URL to every provider entry');
  // Pair the redirect URL with a landing route so the popup doesn't
  // render a 404 if the polling loop closes it late.
  const callbackPath = 'frontend/src/app/auth/callback/page.tsx';
  if (!existsSync(join(ROOT, callbackPath))) {
    fail('auth/callback route exists', `expected ${callbackPath} to be present`);
  } else {
    ok('auth/callback route exists');
    const callback = readSrc(callbackPath);
    contains(callback, '"use client"', 'callback page is a client component');
    contains(callback, 'useSearchParams', 'callback page reads OAuth error query params');
  }
  // The dapp-kit core auto-registers Slush by default when slushWalletConfig
  // is not explicitly null — pin that we did NOT pass `slushWalletConfig:
  // null` (which would disable Slush) AND that we did not double-register
  // via an explicit `registerSlushWallet(...)` call (would clash with the
  // built-in initializer).
  notContains(dappKit, 'slushWalletConfig: null', 'does NOT disable Slush web wallet');
  notContains(dappKit, 'registerSlushWallet(', 'does NOT double-register Slush (uses default initializer)');

  // ============================================================
  // [3] frontend/.env.local.example — env vars documented
  // ============================================================
  section('[3] .env.local.example — Enoki + provider env vars documented');
  const envExample = readSrc('frontend/.env.local.example');
  contains(envExample, 'NEXT_PUBLIC_ENOKI_API_KEY=', 'documents NEXT_PUBLIC_ENOKI_API_KEY');
  contains(envExample, 'NEXT_PUBLIC_GOOGLE_CLIENT_ID=', 'documents NEXT_PUBLIC_GOOGLE_CLIENT_ID');
  contains(envExample, 'NEXT_PUBLIC_TWITCH_CLIENT_ID=', 'documents NEXT_PUBLIC_TWITCH_CLIENT_ID');
  contains(envExample, 'PENDING ENOKI SDK SUPPORT', 'Apple section marked pending in env example');
  contains(envExample, '# NEXT_PUBLIC_APPLE_CLIENT_ID=', 'Apple var commented-out (not removed) for future enablement');
  contains(envExample, 'https://portal.enoki.mystenlabs.com/', 'links to Enoki portal');
  contains(envExample, 'https://console.cloud.google.com/', 'links to Google OAuth console');
  contains(envExample, 'https://dev.twitch.tv/console', 'links to Twitch dev console');

  // ============================================================
  // [4] frontend/package.json — @mysten/enoki declared
  // ============================================================
  section('[4] package.json — @mysten/enoki + @mysten/slush-wallet present');
  const pkgRaw = readSrc('frontend/package.json');
  const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string> };
  const deps = pkg.dependencies ?? {};
  if (deps['@mysten/enoki']) ok(`@mysten/enoki@${deps['@mysten/enoki']}`);
  else fail('@mysten/enoki dependency present', 'expected dependencies["@mysten/enoki"]');
  if (deps['@mysten/slush-wallet']) ok(`@mysten/slush-wallet@${deps['@mysten/slush-wallet']}`);
  else fail('@mysten/slush-wallet dependency present', 'expected dependencies["@mysten/slush-wallet"]');
  if (deps['@mysten/dapp-kit-react']) ok(`@mysten/dapp-kit-react@${deps['@mysten/dapp-kit-react']} (v2 path)`);
  else fail('@mysten/dapp-kit-react dependency present', 'expected dependencies["@mysten/dapp-kit-react"]');

  // ============================================================
  // [5] Apple-deferred annotation preserved across enoki.ts +
  //     dapp-kit.ts + env example. Apple support in Enoki 1.0.8's
  //     AuthProvider union is the single line that needs to change
  //     when the SDK adds Apple; the three annotation sites are the
  //     trail-of-breadcrumbs to follow.
  // ============================================================
  section('[5] Apple-deferred annotation breadcrumbs');
  const enokiSrc = readSrc('frontend/src/config/enoki.ts');
  contains(enokiSrc, 'Enoki 1.0.8', 'enoki.ts cites the SDK version Apple is missing from');
  contains(enokiSrc, "'google' | 'facebook' | 'twitch' | 'onefc'", 'enoki.ts documents the actual AuthProvider union');
  contains(dappKit, 'Apple is *not* wired', 'dapp-kit.ts surfaces the Apple gap inline');
  contains(envExample, "Enoki 1.0.8's AuthProvider union does NOT yet include 'apple'", 'env example surfaces the Apple gap inline');

  // ============================================================
  // [6] Signed-challenge JWT auth surface unchanged — regression guard
  // ============================================================
  section('[6] Auth surface unchanged — zkLogin slots into existing JWT handshake');
  const provider = readSrc('frontend/src/app/game-provider.tsx');
  contains(provider, 'CurrentAccountSigner', 'game-provider still uses CurrentAccountSigner');
  contains(provider, 'signer.signPersonalMessage(messageBytes)', 'signPersonalMessage call site unchanged');
  contains(provider, 'auth_challenge', 'auth_challenge -> signed-message flow unchanged');

  const serverHandler = readSrc('server/src/ws/handler.ts');
  // The auth handshake must call the SuiClient-injecting wrapper, not
  // `verifyPersonalMessageSignature` directly. zkLogin signatures need
  // `client.core.verifyZkLoginSignature(...)` to validate the on-chain
  // JWK + ZK proof; without the client the verifier throws "A Sui Client
  // (GRPC, GraphQL, or JSON RPC) is required to verify zkLogin
  // signatures". The earlier static check `contains('verifyPersonalMessageSignature')`
  // passed but the live sign-in broke for every Enoki-derived account.
  contains(serverHandler, "import { verifyAuthSignature } from '../utils/sui-verify'", 'handler imports the SuiClient-injecting wrapper, not the raw verifier');
  contains(serverHandler, 'verifyAuthSignature(messageBytes, signature, challenge.walletAddress)', 'handler calls the wrapper in the auth_signature flow');
  notContains(serverHandler, "from '@mysten/sui/verify'", 'handler no longer imports the raw verifier directly (forces SuiClient injection through the wrapper)');

  const suiVerify = readSrc('server/src/utils/sui-verify.ts');
  contains(suiVerify, 'export async function verifyAuthSignature', 'sui-verify.ts exports the wrapper');
  contains(suiVerify, 'verifyPersonalMessageSignature(message, signature, {', 'wrapper delegates to the @mysten/sui verifier');
  contains(suiVerify, 'client,', 'wrapper passes the shared SuiClient (required for zkLogin)');

  // ============================================================
  // [7] Plan + handoff alignment — the user's stated provider choice
  //     (Google + Twitch + Apple) is documented as partially-shipped
  //     (Apple deferred) so a future reader of the wrap commit sees
  //     the discrepancy without digging into the diff.
  // ============================================================
  section('[7] Provider-matrix doc commitment');
  const stateDocPath = 'STATE_OF_PROJECT_2026-05-17.md';
  if (existsSync(join(ROOT, stateDocPath))) {
    const stateDoc = readSrc(stateDocPath);
    contains(stateDoc, 'Apple deferred', 'STATE_OF_PROJECT cites the Apple deferral');
    contains(stateDoc, 'Enoki', 'STATE_OF_PROJECT covers Enoki integration');
  } else {
    // Not a hard failure during local iteration — flag at info level.
    console.log(`  \x1b[33mINFO\x1b[0m ${stateDocPath} not yet written (added by the doc wrap commit)`);
  }

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
  console.log(`\n  \x1b[32mzkLogin wallet registration pinned.\x1b[0m`);
  process.exit(0);
}

main();
