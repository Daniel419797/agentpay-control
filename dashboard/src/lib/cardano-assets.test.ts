import { describe, expect, it } from "vitest";

import {
  CARDANO_MAINNET_USDCX_ASSET_ID,
  cardanoAssetConfigFromEnv,
  cardanoAssetIdentifier,
  isCardanoAssetUnit,
} from "@/lib/cardano-assets";

const PREPROD_TEST_STABLE_UNIT = `${"ab".repeat(28)}5553444378`;
const TEST_ENV = { NODE_ENV: "test" as const };

describe("Cardano asset whitelist", () => {
  it("accepts ADA and only explicitly configured stablecoin assets", () => {
    const config = { preprodUsdcxAssetId: PREPROD_TEST_STABLE_UNIT, mainnetUsdcxAssetId: CARDANO_MAINNET_USDCX_ASSET_ID };
    expect(cardanoAssetIdentifier({ type: "NATIVE", symbol: "ADA" }, "cardano:preprod", config)).toBe("lovelace");
    expect(cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDCX" }, "cardano:mainnet", config)).toBe(CARDANO_MAINNET_USDCX_ASSET_ID);
    expect(() => cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDM" }, "cardano:mainnet", config)).toThrow("CARDANO_ASSET_UNSUPPORTED");
    expect(() => cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDC" }, "cardano:mainnet", config)).toThrow("CARDANO_ASSET_UNSUPPORTED");
  });

  it("validates the Cardano policy-id plus asset-name unit", () => {
    expect(isCardanoAssetUnit(PREPROD_TEST_STABLE_UNIT)).toBe(true);
    expect(isCardanoAssetUnit("ab".repeat(27))).toBe(false);
    expect(() => cardanoAssetConfigFromEnv({ ...TEST_ENV, CARDANO_MAINNET_USDCX_ASSET_ID: "not-an-asset" })).toThrow("CARDANO_MAINNET_USDCX_ASSET_ID_INVALID");
  });

  it("pins Mainnet USDCx to Circle xReserve's canonical Cardano asset", () => {
    expect(cardanoAssetConfigFromEnv({ ...TEST_ENV, CARDANO_MAINNET_USDCX_ASSET_ID: CARDANO_MAINNET_USDCX_ASSET_ID }).mainnetUsdcxAssetId).toBe(CARDANO_MAINNET_USDCX_ASSET_ID);
    expect(() => cardanoAssetConfigFromEnv({ ...TEST_ENV, CARDANO_MAINNET_USDCX_ASSET_ID: PREPROD_TEST_STABLE_UNIT })).toThrow("CARDANO_MAINNET_USDCX_ASSET_ID_MISMATCH");
    expect(() => cardanoAssetIdentifier(
      { type: "TOKEN", symbol: "USDCX" },
      "cardano:mainnet",
      { mainnetUsdcxAssetId: PREPROD_TEST_STABLE_UNIT },
    )).toThrow("CARDANO_MAINNET_USDCX_ASSET_ID_MISMATCH");
  });

  it("fails closed when USDCx is not configured", () => {
    expect(() => cardanoAssetIdentifier({ type: "TOKEN", symbol: "USDCX" }, "cardano:mainnet", {})).toThrow("CARDANO_MAINNET_USDCX_ASSET_ID_REQUIRED");
  });
});
