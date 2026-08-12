import { getConfig, type AppConfig } from "@/lib/config";

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

export function isHederaMainnetEnabled(config: AppConfig): boolean {
  if (config.APP_ENV !== "production") return true;
  return Boolean(config.HEDERA_MAINNET_FACILITATOR_URL && config.HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY);
}

export function isManagedArcEnabled(config: AppConfig): boolean {
  const signingKey = config.ARC_FACILITATOR_SIGNING_API_KEY ?? (config.APP_ENV === "production" ? undefined : config.ARC_FACILITATOR_API_KEY);
  return Boolean(config.ARC_FACILITATOR_URL && signingKey && config.ARC_PAYER_ADDRESS);
}

export function isManagedCardanoPreprodEnabled(config: AppConfig): boolean {
  const signingKey = config.CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY ?? (config.APP_ENV === "production" ? undefined : config.CARDANO_PREPROD_FACILITATOR_API_KEY);
  return Boolean(
    config.CARDANO_PREPROD_FACILITATOR_URL &&
    signingKey &&
    config.CARDANO_PREPROD_PAYER_ADDRESS &&
    config.CARDANO_PREPROD_PROVIDER_ADDRESS &&
    config.CARDANO_PREPROD_BLOCKFROST_PROJECT_ID
  );
}

export function isManagedCardanoMainnetEnabled(config: AppConfig): boolean {
  const signingKey = config.CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY ?? (config.APP_ENV === "production" ? undefined : config.CARDANO_MAINNET_FACILITATOR_API_KEY);
  return Boolean(
    config.CARDANO_MAINNET_FACILITATOR_URL &&
    signingKey &&
    config.CARDANO_MAINNET_PAYER_ADDRESS &&
    config.CARDANO_MAINNET_PROVIDER_ADDRESS &&
    config.CARDANO_MAINNET_BLOCKFROST_PROJECT_ID
  );
}

class DefaultNetworkRouter implements NetworkRouter {
  private readonly routes: Record<string, NetworkRoute> = {};

  constructor() {
    const config = getConfig();
    const production = config.APP_ENV === "production";

    this.routes["hedera:testnet"] = {
      facilitatorUrl: config.FACILITATOR_URL ?? "http://localhost:8787",
      facilitatorApiKey: config.FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.FACILITATOR_API_KEY),
      explorerUrl: "https://hashscan.io/testnet/transaction",
      nativeAsset: "0.0.0",
    };

    if (isHederaMainnetEnabled(config)) {
      this.routes["hedera:mainnet"] = {
        facilitatorUrl: config.HEDERA_MAINNET_FACILITATOR_URL ?? "http://localhost:8787",
        facilitatorApiKey: config.HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.HEDERA_MAINNET_FACILITATOR_API_KEY),
        explorerUrl: "https://hashscan.io/mainnet/transaction",
        nativeAsset: "0.0.0",
      };
    }

    if (isManagedArcEnabled(config)) {
      this.routes["eip155:5042002"] = {
        facilitatorUrl: config.ARC_FACILITATOR_URL!,
        facilitatorApiKey: config.ARC_FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.ARC_FACILITATOR_API_KEY),
        explorerUrl: "https://testnet.arcscan.app/tx",
        nativeAsset: config.ARC_USDC_ADDRESS,
      };
    }

    if (isManagedCardanoPreprodEnabled(config)) {
      this.routes["cardano:preprod"] = {
        facilitatorUrl: config.CARDANO_PREPROD_FACILITATOR_URL!,
        facilitatorApiKey: config.CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.CARDANO_PREPROD_FACILITATOR_API_KEY),
        explorerUrl: "https://preprod.cardanoscan.io/transaction",
        nativeAsset: "lovelace",
      };
    }

    if (isManagedCardanoMainnetEnabled(config)) {
      this.routes["cardano:mainnet"] = {
        facilitatorUrl: config.CARDANO_MAINNET_FACILITATOR_URL!,
        facilitatorApiKey: config.CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.CARDANO_MAINNET_FACILITATOR_API_KEY),
        explorerUrl: "https://cardanoscan.io/transaction",
        nativeAsset: "lovelace",
      };
    }
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
