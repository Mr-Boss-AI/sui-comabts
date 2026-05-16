import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

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

export const dAppKit = createDAppKit({
  networks: ["testnet", "mainnet"] as const,
  defaultNetwork: "testnet",
  enableBurnerWallet: process.env.NODE_ENV === "development",
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
