import { getConfig } from "@/lib/config";

export type NetworkRoute = {
  facilitatorUrl: string;
  facilitatorApiKey: string | undefined;
  explorerUrl: string;
  nativeAsset: string;
};

export interface NetworkRouter {
  getRoute(network: string): NetworkRoute;
  supportsNetwork(network: string): boolean;
  supportedNetworks(): string[];
}

class DefaultNetworkRouter implements NetworkRouter {
  private readonly routes: Record<string, NetworkRoute> = {};

  constructor() {
    const config = getConfig();
    const allowLocalFallback = config.APP_ENV !== "production";

    this.routes["hedera:testnet"] = {
      facilitatorUrl: config.FACILITATOR_URL ?? "http://localhost:8787",
      facilitatorApiKey: config.FACILITATOR_SIGNING_API_KEY ?? config.FACILITATOR_API_KEY,
      explorerUrl: "https://hashscan.io/testnet/transaction",
      nativeAsset: "0.0.0",
    };

    if (config.HEDERA_MAINNET_FACILITATOR_URL || allowLocalFallback) {
      this.routes["hedera:mainnet"] = {
        facilitatorUrl: config.HEDERA_MAINNET_FACILITATOR_URL ?? "http://localhost:8787",
        facilitatorApiKey: config.HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY ?? config.HEDERA_MAINNET_FACILITATOR_API_KEY,
        explorerUrl: "https://hashscan.io/mainnet/transaction",
        nativeAsset: "0.0.0",
      };
    }

    this.routes["eip155:5042002"] = {
      facilitatorUrl: config.ARC_FACILITATOR_URL ?? "http://localhost:8788",
      facilitatorApiKey: config.ARC_FACILITATOR_SIGNING_API_KEY ?? config.ARC_FACILITATOR_API_KEY,
      explorerUrl: "https://testnet.arcscan.app/tx",
      nativeAsset: "0x3600000000000000000000000000000000000000",
    };
  }

  getRoute(network: string): NetworkRoute {
    const route = this.routes[network];
    if (!route) throw new Error(`NETWORK_UNSUPPORTED: ${network}`);
    return route;
  }

  supportsNetwork(network: string): boolean {
    return network in this.routes;
  }

  supportedNetworks(): string[] {
    return Object.keys(this.routes);
  }
}

let instance: NetworkRouter | undefined;

export function getNetworkRouter(): NetworkRouter {
  if (!instance) {
    instance = new DefaultNetworkRouter();
  }
  return instance;
}

export function resetNetworkRouter(): void {
  instance = undefined;
}
