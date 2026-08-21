import { getConfig, type AppConfig } from "@/lib/config";
import { cardanoAssetIdentifier } from "@/lib/cardano-assets";

type PaymentAsset = {
  type: string;
  symbol: string;
  hederaTokenId?: string | null;
};

type PaymentAccountLike = {
  network: string;
  accountId: string;
  status: string;
};

type ResourceProviderLike = {
  organizationId: string | null;
  status: string;
  verificationStatus: string;
  settlementAccountId: string;
  settlementAccountVerified: boolean;
};

function required(value: string | undefined, code: string): string {
  if (!value) throw new Error(code);
  return value;
}

export function x402AssetIdentifier(asset: PaymentAsset, network: string, config: AppConfig = getConfig()): string {
  if (network === "eip155:5042002") {
    if (asset.symbol !== "USDC") throw new Error("ARC_ASSET_UNSUPPORTED");
    return config.ARC_USDC_ADDRESS.toLowerCase();
  }
  if (network.startsWith("eip155:")) throw new Error("EVM_ASSET_NETWORK_UNSUPPORTED");
  if (network === "hedera:testnet" || network === "hedera:mainnet") {
    if (asset.type === "NATIVE") return "0.0.0";
    return required(asset.hederaTokenId ?? undefined, "HEDERA_TOKEN_ID_REQUIRED");
  }
  if (network === "cardano:preprod" || network === "cardano:mainnet") {
    return cardanoAssetIdentifier(asset, network);
  }
  throw new Error("PAYMENT_NETWORK_UNSUPPORTED");
}

export function paymentAccountForNetwork<T extends PaymentAccountLike>(accounts: T[], network: string): T {
  const account = accounts.find((candidate) => candidate.status === "ACTIVE" && candidate.network === network);
  if (!account) throw new Error("PAYMENT_ACCOUNT_UNAVAILABLE");
  return account;
}

/**
 * Platform-owned bundled resources have deployment-configured payees per rail.
 * Organization-owned marketplace providers are currently verified only for
 * Hedera testnet settlement. Cardano Masumi-bound resources use the seller
 * wallet verified by the registry trust layer in payment-service instead of
 * this generic provider settlement path.
 */
export function providerPayeeForNetwork(provider: ResourceProviderLike, network: string, config: AppConfig = getConfig()): string {
  if (provider.organizationId === null) {
    if (network === "hedera:testnet") return config.HEDERA_PROVIDER_ACCOUNT_ID;
    if (network === "hedera:mainnet") return required(config.HEDERA_MAINNET_PROVIDER_ACCOUNT_ID, "PLATFORM_MAINNET_PAYEE_NOT_CONFIGURED");
    if (network === "eip155:5042002") return required(config.ARC_PROVIDER_ADDRESS, "PLATFORM_ARC_PAYEE_NOT_CONFIGURED").toLowerCase();
    if (network === "cardano:preprod") return required(config.CARDANO_PREPROD_PROVIDER_ADDRESS, "PLATFORM_CARDANO_PREPROD_PAYEE_NOT_CONFIGURED");
    if (network === "cardano:mainnet") return required(config.CARDANO_MAINNET_PROVIDER_ADDRESS, "PLATFORM_CARDANO_MAINNET_PAYEE_NOT_CONFIGURED");
    throw new Error("PLATFORM_PROVIDER_NETWORK_UNSUPPORTED");
  }

  if (provider.status !== "ACTIVE" || provider.verificationStatus !== "VERIFIED" || !provider.settlementAccountVerified) {
    throw new Error("PROVIDER_SETTLEMENT_NOT_VERIFIED");
  }
  if (network !== "hedera:testnet") throw new Error("PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED");
  return provider.settlementAccountId;
}
