import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { enokiWalletsInitializer } from "@mysten/enoki";
import { ENOKI_CONFIG, ENOKI_READY } from "./enoki";

const GRPC_URLS: Record<string, string> = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
};

/**
 * MVR (Move Version Resolution) named-package overrides shared with
 * the dapp-kit SuiGrpcClient.
 *
 * The Sui Stack Messaging SDK uses named placeholders (e.g.
 * `@local-pkg/sui-stack-messaging`) inside its contract bindings and
 * relies on the SuiClient's MVR layer to substitute the real package
 * id at tx-build time. The dapp-kit signer
 * (`CurrentAccountSigner.signAndExecuteTransaction`) routes
 * transactions through THIS client's `resolveTransactionPlugin`
 * during serialization — so even though `lib/messaging.ts` builds
 * its own SuiClient with overrides, the SIGN path lives in dapp-kit
 * land and needs the same overrides applied here.
 *
 * Without these, the first DM send fails with
 * `Failed to resolve package: @local-pkg/sui-stack-messaging`
 * inside `node_modules/@mysten/sui/src/client/mvr.ts`.
 *
 * See `TAVERN_DESIGN.md` § "MVR (Move Version Resolution) wiring"
 * for the full architecture and version matrix.
 */
const TESTNET_MVR_OVERRIDES: Record<string, string> = {
  // From `@mysten/messaging/dist/cjs/constants.js::FALLBACK_PACKAGE_ID`.
  "@local-pkg/sui-stack-messaging":
    "0x984960ebddd75c15c6d38355ac462621db0ffc7d6647214c802cd3b685e1af3d",
};

const MVR_OVERRIDES_BY_NETWORK: Record<string, Record<string, string>> = {
  testnet: TESTNET_MVR_OVERRIDES,
  // Mainnet messaging support is gated on the SDK reaching beta — leave
  // empty for now so a future mainnet rebuild fails loudly when it tries
  // to resolve the package without an explicit mapping.
  mainnet: {},
};

// =============================================================================
// Phase A — Enoki zkLogin wallet initializer  (2026-05-17)
// =============================================================================
//
// We register Enoki through the dApp Kit's `walletInitializers` slot
// rather than calling `registerEnokiWallets` directly. The initializer
// pattern lets dApp Kit hand Enoki the correct per-network clients
// automatically (the ones returned by `createClient(network)` below)
// instead of us constructing separate gRPC clients just for Enoki.
//
// Currently shipping Google + Twitch. Apple is *not* wired because
// Enoki 1.0.8's `AuthProvider` union does not yet include `'apple'`;
// see `frontend/src/config/enoki.ts` header for the provider matrix
// and the pending-Apple-support note.
//
// When `ENOKI_READY` is false (no env vars configured), `walletInitializers`
// receives an empty array — the dApp Kit still boots cleanly with
// browser-injected wallets + the default Slush web wallet. The QA
// gauntlet (`scripts/qa-zklogin-wallet-registration.ts`) pins this
// wiring so a future refactor that drops the initializer is caught
// at static-analysis time.
//
// Slush web wallet is registered automatically by dapp-kit-core's
// default `slushWalletConfig` (see `dapp-kit-core/dist/index.mjs` —
// when `slushWalletConfig !== null`, the kit calls
// `slushWebWalletInitializer(slushWalletConfig)` itself). We
// intentionally do *not* pass an explicit `registerSlushWallet` call
// here to avoid a double-registration.
//
// `redirectUrl` is pinned to `<origin>/auth/callback` rather than left
// to Enoki's default (`window.location.href.split("#")[0]`). The default
// sends whatever URL the user happens to be on — root, profile, fight
// room — and any of those would need a separate registration in every
// OAuth provider console (Google, Twitch). Pinning a single canonical
// path means one entry per provider matches dev + prod, and the
// matching landing page at `src/app/auth/callback/page.tsx` keeps the
// popup from rendering a 404 if Enoki's polling loop closes it late.
// This module is client-only (loaded via the `ssr: false` dynamic
// import in `src/app/page.tsx`), so `window` is always defined here.

const ENOKI_REDIRECT_URL =
  typeof window !== "undefined"
    ? new URL("/auth/callback", window.location.origin).toString()
    : undefined;

const ENOKI_INITIALIZER =
  ENOKI_READY && ENOKI_CONFIG.apiKey
    ? enokiWalletsInitializer({
        apiKey: ENOKI_CONFIG.apiKey,
        providers: Object.fromEntries(
          ENOKI_CONFIG.providers.map((p) => [
            p.provider,
            { clientId: p.clientId, redirectUrl: ENOKI_REDIRECT_URL },
          ]),
        ),
      })
    : null;

export const dAppKit = createDAppKit({
  networks: ["testnet", "mainnet"] as const,
  defaultNetwork: "testnet",
  enableBurnerWallet: process.env.NODE_ENV === "development",
  walletInitializers: ENOKI_INITIALIZER ? [ENOKI_INITIALIZER] : [],
  createClient(network) {
    return new SuiGrpcClient({
      network,
      baseUrl: GRPC_URLS[network],
      mvr: {
        overrides: {
          packages: MVR_OVERRIDES_BY_NETWORK[network] ?? {},
        },
      },
    });
  },
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
