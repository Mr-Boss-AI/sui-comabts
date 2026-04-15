import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

const GRPC_URLS: Record<string, string> = {
  testnet: "https://fullnode.testnet.sui.io:443",
  mainnet: "https://fullnode.mainnet.sui.io:443",
};

export const dAppKit = createDAppKit({
  networks: ["testnet", "mainnet"] as const,
  defaultNetwork: "testnet",
  enableBurnerWallet: process.env.NODE_ENV === "development",
  createClient(network) {
    return new SuiGrpcClient({
      network,
      baseUrl: GRPC_URLS[network],
    });
  },
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
