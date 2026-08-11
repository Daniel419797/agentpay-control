const CARDANO_ASSET_UNIT = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;

export type CardanoAssetConfig = {
  preprodUsdcxAssetId?: string;
  mainnetUsdcxAssetId?: string;
};

function optionalAssetUnit(name: string, value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!CARDANO_ASSET_UNIT.test(normalized)) throw new Error(`${name}_INVALID`);
  return normalized;
}

export function cardanoAssetConfigFromEnv(env: NodeJS.ProcessEnv = process.env): CardanoAssetConfig {
  return {
    preprodUsdcxAssetId: optionalAssetUnit("CARDANO_PREPROD_USDCX_ASSET_ID", env.CARDANO_PREPROD_USDCX_ASSET_ID),
    mainnetUsdcxAssetId: optionalAssetUnit("CARDANO_MAINNET_USDCX_ASSET_ID", env.CARDANO_MAINNET_USDCX_ASSET_ID),
  };
}

export function cardanoAssetIdentifier(
  asset: { type: string; symbol: string },
  network: string,
  config: CardanoAssetConfig = cardanoAssetConfigFromEnv(),
): string {
  if (network !== "cardano:preprod" && network !== "cardano:mainnet") throw new Error("CARDANO_NETWORK_UNSUPPORTED");
  const symbol = asset.symbol.toUpperCase();
  if (asset.type === "NATIVE" && symbol === "ADA") return "lovelace";
  if (asset.type === "TOKEN" && (symbol === "USDCX" || symbol === "USDC")) {
    const assetId = network === "cardano:mainnet" ? config.mainnetUsdcxAssetId : config.preprodUsdcxAssetId;
    if (!assetId) throw new Error(network === "cardano:mainnet" ? "CARDANO_MAINNET_USDCX_ASSET_ID_REQUIRED" : "CARDANO_PREPROD_USDCX_ASSET_ID_REQUIRED");
    return assetId;
  }
  throw new Error("CARDANO_ASSET_UNSUPPORTED");
}

export function cardanoAssetReadinessErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  const errors: string[] = [];
  try {
    const config = cardanoAssetConfigFromEnv(env);
    if (env.CARDANO_USDCX_ENABLED === "true") {
      if (env.CARDANO_PREPROD_ENABLED === "true" && !config.preprodUsdcxAssetId) errors.push("CARDANO_PREPROD_USDCX_ASSET_ID");
      if (env.CARDANO_MAINNET_ENABLED === "true" && !config.mainnetUsdcxAssetId) errors.push("CARDANO_MAINNET_USDCX_ASSET_ID");
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "CARDANO_ASSET_CONFIG_INVALID");
  }
  return errors;
}

export function isCardanoAssetUnit(value: string): boolean {
  return CARDANO_ASSET_UNIT.test(value.toLowerCase());
}
