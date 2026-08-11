import { describe, expect, it } from "vitest";

import { cardanoAssetConfigFromEnv, cardanoAssetIdentifier, isCardanoAssetUnit } from "@/lib/cardano-assets";

const USDCX_UNIT = `${"ab".repeat(28)}5553444378`;

describe("Cardano asset whitelist", () => {
  it("accepts ADA and only explicitly configured USDCx", () => {
    const config = { preprodUsdcxAssetId: USDCX_UNIT, mainnetUsdcxAssetId: USDCX_UNIT };
    expect(cardanoAssetIdentifier({ type: "NATIVE", symbol: "ADA" }, "cardano:preprod", config)).toBe("lovelace");
    expect(cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDCX" }, "cardano:mainnet", config)).toBe(USDCX_UNIT);
    expect(() => cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDM" }, "cardano:mainnet", config)).toThrow("CARDANO_ASSET_UNSUPPORTED");
    expect(() => cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDC" }, "cardano:mainnet", config)).toThrow("CARDANO_ASSET_UNSUPPORTED");
  });

  it("validates the Cardano policy-id plus asset-name unit", () => {
    expect(isCardanoAssetUnit(USDCX_UNIT)).toBe(true);
    expect(isCardanoAssetUnit("ab".repeat(27))).toBe(false);
    expect(() => cardanoAssetConfigFromEnv({ CARDANO_MAINNET_USDCX_ASSET_ID: "not-an-asset" })).toThrow("CARDANO_MAINNET_USDCX_ASSET_ID_INVALID");
  });

  it("fails closed when USDCx is not configured", () => {
    expect(() => cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDCX" }, "cardano:mainnet", {})).toThrow("CARDANO_MAINNET_USDCX_ASSET_ID_REQUIRED");
  });
});
