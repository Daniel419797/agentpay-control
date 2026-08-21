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

const unifiedPaths: Record<string, string> = {
  "hedera:testnet": "/hedera/testnet",
  "hedera:mainnet": "/hedera/mainnet",
  "eip155:5042002": "/arc/testnet",
  "cardano:preprod": "/cardano/preprod",
  "cardano:mainnet": "/cardano/mainnet",
};

function stripSlash(value: string) { return value.replace(/\/$/, ""); }

export function facilitatorUrlForNetwork(config: AppConfig, network: string): string | undefined {
  const legacy = network === "hedera:testnet" ? config.FACILITATOR_URL
    : network === "hedera:mainnet" ? config.HEDERA_MAINNET_FACILITATOR_URL
    : network === "eip155:5042002" ? config.ARC_FACILITATOR_URL
    : network === "cardano:preprod" ? config.CARDANO_PREPROD_FACILITATOR_URL
    : network === "cardano:mainnet" ? config.CARDANO_MAINNET_FACILITATOR_URL
    : undefined;
  if (legacy) return stripSlash(legacy);
  const path = unifiedPaths[network];
  if (config.AGENTPAY_FACILITATOR_ORIGIN && path) return `${stripSlash(config.AGENTPAY_FACILITATOR_ORIGIN)}${path}`;
  if (config.APP_ENV !== "production" && path) return `http://localhost:8787${path}`;
  return undefined;
}

export function isHederaMainnetEnabled(config: AppConfig): boolean {
  return Boolean(facilitatorUrlForNetwork(config, "hedera:mainnet"));
}

export function isManagedArcEnabled(config: AppConfig): boolean {
  const signingKey = config.ARC_FACILITATOR_SIGNING_API_KEY ?? (config.APP_ENV === "production" ? undefined : config.ARC_FACILITATOR_API_KEY);
  return Boolean(facilitatorUrlForNetwork(config, "eip155:5042002") && signingKey);
}

export function isManagedCardanoPreprodEnabled(config: AppConfig): boolean {
  const signingKey = config.CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY ?? (config.APP_ENV === "production" ? undefined : config.CARDANO_PREPROD_FACILITATOR_API_KEY);
  return Boolean(
    facilitatorUrlForNetwork(config, "cardano:preprod") &&
    signingKey &&
    config.CARDANO_PREPROD_PROVIDER_ADDRESS &&
    config.CARDANO_PREPROD_BLOCKFROST_PROJECT_ID
  );
}

export function isCardanoMainnetEnabled(config: AppConfig): boolean {
  const prepareKey = config.CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY ?? (config.APP_ENV === "production" ? undefined : config.CARDANO_MAINNET_FACILITATOR_API_KEY);
  return Boolean(
    facilitatorUrlForNetwork(config, "cardano:mainnet") &&
    prepareKey &&
    config.CARDANO_MAINNET_PROVIDER_ADDRESS &&
    config.CARDANO_MAINNET_BLOCKFROST_PROJECT_ID
  );
}

class DefaultNetworkRouter implements NetworkRouter {
  private readonly routes: Record<string, NetworkRoute> = {};

  constructor() {
    const config = getConfig();
    const production = config.APP_ENV === "production";
    const hederaTestnetUrl = facilitatorUrlForNetwork(config, "hedera:testnet");
    if (hederaTestnetUrl) {
      this.routes["hedera:testnet"] = {
        facilitatorUrl: hederaTestnetUrl,
        facilitatorApiKey: config.FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.FACILITATOR_API_KEY),
        explorerUrl: "https://hashscan.io/testnet/transaction",
        nativeAsset: "0.0.0",
      };
    }

    if (isHederaMainnetEnabled(config)) {
      this.routes["hedera:mainnet"] = {
        facilitatorUrl: facilitatorUrlForNetwork(config, "hedera:mainnet")!,
        facilitatorApiKey: config.HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.HEDERA_MAINNET_FACILITATOR_API_KEY),
        explorerUrl: "https://hashscan.io/mainnet/transaction",
        nativeAsset: "0.0.0",
      };
    }

    if (isManagedArcEnabled(config)) {
      this.routes["eip155:5042002"] = {
        facilitatorUrl: facilitatorUrlForNetwork(config, "eip155:5042002")!,
        facilitatorApiKey: config.ARC_FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.ARC_FACILITATOR_API_KEY),
        explorerUrl: "https://testnet.arcscan.app/tx",
        nativeAsset: config.ARC_USDC_ADDRESS,
      };
    }

    if (isManagedCardanoPreprodEnabled(config)) {
      this.routes["cardano:preprod"] = {
        facilitatorUrl: facilitatorUrlForNetwork(config, "cardano:preprod")!,
        facilitatorApiKey: config.CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY ?? (production ? undefined : config.CARDANO_PREPROD_FACILITATOR_API_KEY),
        explorerUrl: "https://preprod.cardanoscan.io/transaction",
        nativeAsset: "lovelace",
      };
    }

    if (isCardanoMainnetEnabled(config)) {
      this.routes["cardano:mainnet"] = {
        facilitatorUrl: facilitatorUrlForNetwork(config, "cardano:mainnet")!,
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
  if (!instance) instance = new DefaultNetworkRouter();
  return instance;
}

export function resetNetworkRouter(): void {
  instance = undefined;
}
