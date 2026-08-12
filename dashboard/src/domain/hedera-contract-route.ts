import { getConfig } from "@/lib/config";

type HederaContractRoutingConfig = {
  APP_ENV?: "development" | "test" | "production";
  FACILITATOR_URL?: string;
  FACILITATOR_API_KEY?: string;
  FACILITATOR_CONTRACT_API_KEY?: string;
  HEDERA_PAYER_ACCOUNT_ID?: string;
  HEDERA_MIRROR_NODE_URL?: string;
  HEDERA_MAINNET_FACILITATOR_URL?: string;
  HEDERA_MAINNET_FACILITATOR_API_KEY?: string;
  HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY?: string;
  HEDERA_MAINNET_PAYER_ACCOUNT_ID?: string;
  HEDERA_MAINNET_MIRROR_NODE_URL?: string;
};

export type HederaContractRoute = {
  networkId: "hedera:testnet" | "hedera:mainnet";
  facilitatorUrl: string;
  contractApiKey: string;
  payerAccountId: string;
  mirrorNodeUrl: string;
};

function requireRouteValue(value: string | undefined, errorCode: string): string {
  if (!value) throw new Error(errorCode);
  return value;
}

function contractCapability(
  config: HederaContractRoutingConfig,
  scopedKey: string | undefined,
  legacyKey: string | undefined,
  errorCode: string,
): string {
  const value = scopedKey ?? (config.APP_ENV === "production" ? undefined : legacyKey);
  return requireRouteValue(value, errorCode);
}

/**
 * Resolve every security-sensitive Hedera contract dependency from the exact
 * allowlisted network. Production accepts only capability-specific API keys;
 * legacy all-purpose facilitator keys remain a local-development fallback.
 */
export function hederaContractRoute(
  networkId: string,
  config: HederaContractRoutingConfig = getConfig(),
): HederaContractRoute {
  if (networkId === "hedera:testnet") {
    return {
      networkId,
      facilitatorUrl: requireRouteValue(config.FACILITATOR_URL, "CONTRACT_TESTNET_FACILITATOR_NOT_CONFIGURED"),
      contractApiKey: contractCapability(config, config.FACILITATOR_CONTRACT_API_KEY, config.FACILITATOR_API_KEY, "CONTRACT_TESTNET_CAPABILITY_NOT_CONFIGURED"),
      payerAccountId: requireRouteValue(config.HEDERA_PAYER_ACCOUNT_ID, "CONTRACT_TESTNET_PAYER_NOT_CONFIGURED"),
      mirrorNodeUrl: requireRouteValue(config.HEDERA_MIRROR_NODE_URL, "CONTRACT_TESTNET_MIRROR_NOT_CONFIGURED"),
    };
  }

  if (networkId === "hedera:mainnet") {
    return {
      networkId,
      facilitatorUrl: requireRouteValue(config.HEDERA_MAINNET_FACILITATOR_URL, "CONTRACT_MAINNET_FACILITATOR_NOT_CONFIGURED"),
      contractApiKey: contractCapability(config, config.HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY, config.HEDERA_MAINNET_FACILITATOR_API_KEY, "CONTRACT_MAINNET_CAPABILITY_NOT_CONFIGURED"),
      payerAccountId: requireRouteValue(config.HEDERA_MAINNET_PAYER_ACCOUNT_ID, "CONTRACT_MAINNET_PAYER_NOT_CONFIGURED"),
      mirrorNodeUrl: requireRouteValue(config.HEDERA_MAINNET_MIRROR_NODE_URL, "CONTRACT_MAINNET_MIRROR_NOT_CONFIGURED"),
    };
  }

  throw new Error("CONTRACT_HEDERA_NETWORK_UNSUPPORTED");
}
