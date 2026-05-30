/**
 * Enoki zkLogin configuration — Phase A, 2026-05-17.
 *
 * Reads env vars and exposes a strongly-typed `enokiProviderConfig`
 * consumed by `frontend/src/config/dapp-kit.ts` when it calls
 * `registerEnokiWallets`. Pure config module — no side effects, no
 * network calls, safe to import at module-load time.
 *
 * ── Provider matrix ─────────────────────────────────────────────
 *
 *   Google  ✓  shipped — universal, every player has a Google account.
 *   Twitch  ✓  shipped — gaming-native audience, strongest signal for
 *                           a SUI Combats player profile.
 *   Apple   ⏳ pending  — Enoki 1.0.8's `AuthProvider` union
 *                           (`'google' | 'facebook' | 'twitch' | 'onefc'
 *                           | 'playtron'`) does not yet include Apple.
 *                           When the SDK ships Apple support, surface it
 *                           by adding `apple` to PROVIDERS_TO_WIRE below
 *                           and uncommenting the apple block in the env
 *                           example. Apple Developer Program enrollment
 *                           ($99/year) and Apple Services ID required.
 *
 *   Facebook    Skipped per user preference (2026-05-16 plan).
 *   onefc       Skipped — partner-specific (OneFC integration only).
 *   playtron    Skipped — SuiPlay0X1 handheld OS integration only.
 *
 * ── Env vars ────────────────────────────────────────────────────
 *
 *   NEXT_PUBLIC_ENOKI_API_KEY        Enoki application API key from
 *                                    https://portal.enoki.mystenlabs.com/
 *   NEXT_PUBLIC_GOOGLE_CLIENT_ID     OAuth 2.0 Web client ID from
 *                                    https://console.cloud.google.com/
 *   NEXT_PUBLIC_TWITCH_CLIENT_ID     Twitch application client ID from
 *                                    https://dev.twitch.tv/console
 *
 * Each provider entry returns null when its client ID is missing so
 * the dApp Kit connect modal cleanly omits the unconfigured option
 * instead of throwing at registration time. The registration site in
 * `dapp-kit.ts` filters nulls before passing to `registerEnokiWallets`.
 *
 * Note: Apple support was requested by the user in the 2026-05-17
 * Phase A scope. It is *not* wired here because Enoki 1.0.8 does not
 * yet support it. The plan + handoff docs surface this gap.
 */

import type { AuthProvider } from "@mysten/enoki";

export interface EnokiProviderEntry {
  provider: AuthProvider;
  clientId: string;
}

/**
 * Read all configured Enoki provider entries. Returns only the providers
 * whose env vars are populated; the rest are silently omitted from the
 * connect modal. The Enoki API key is returned separately because it's
 * a top-level option in `registerEnokiWallets`, not per-provider.
 */
export interface EnokiConfigSnapshot {
  apiKey: string | null;
  providers: EnokiProviderEntry[];
}

export function readEnokiConfig(): EnokiConfigSnapshot {
  // Note: Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so
  // these reads happen at module-load. Missing values surface as `undefined`
  // → coerced to null below for a single, well-typed absence sentinel.
  const apiKey = process.env.NEXT_PUBLIC_ENOKI_API_KEY ?? null;

  const candidates: ReadonlyArray<{ provider: AuthProvider; clientId: string | undefined }> = [
    { provider: "google", clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID },
    { provider: "twitch", clientId: process.env.NEXT_PUBLIC_TWITCH_CLIENT_ID },
    // Apple deferred — see header. When Enoki ships `'apple'` in its
    // AuthProvider union, add a line here:
    //   { provider: "apple", clientId: process.env.NEXT_PUBLIC_APPLE_CLIENT_ID },
  ];

  const providers = candidates
    .filter((c): c is EnokiProviderEntry =>
      typeof c.clientId === "string" && c.clientId.length > 0,
    )
    .map((c) => ({ provider: c.provider, clientId: c.clientId }));

  return { apiKey, providers };
}

/**
 * Module-load snapshot. Re-reading on every render is unnecessary because
 * `process.env.NEXT_PUBLIC_*` is build-time-inlined and never changes at
 * runtime. The snapshot is consumed exactly once by `config/dapp-kit.ts`.
 */
export const ENOKI_CONFIG: EnokiConfigSnapshot = readEnokiConfig();

/**
 * True when the Enoki API key + at least one provider client ID are
 * present. The dApp Kit registration site uses this as a single guard;
 * when false, the Enoki wallets are simply not registered and the
 * existing browser-injected wallet discovery is the only sign-in path.
 *
 * This is the explicit "fail loudly" behaviour: missing env in dev
 * surfaces as "no Enoki wallets in the connect modal" rather than a
 * runtime throw, which keeps the dev server bootable without zkLogin
 * configured. The QA gauntlet pins that the registration call is wired
 * correctly even when ENOKI_READY is false.
 */
export const ENOKI_READY: boolean =
  ENOKI_CONFIG.apiKey !== null && ENOKI_CONFIG.providers.length > 0;
