import { describe, expect, it } from "vitest";
import { parseCardanoNativeEnv } from "./cardano-native.js";

const PAYER = "addr_test1vr8nl3s7rk0tqn4rd9u49s0k52f9sezrt98rs4cnpfj47wggeuy4d";
const USDCX = `${"ab".repeat(28)}5553444378`;

function production(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    CARDANO_NETWORK: "preprod",
    CARDANO_PAYER_ADDRESS: PAYER,
    CARDANO_BLOCKFROST_URL: "https://cardano-preprod.blockfrost.io/api/v0",
    CARDANO_BLOCKFROST_PROJECT_ID: "preprod-project-id-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SIGNER_URL: "https://cardano-signer.example/sign",
    CARDANO_SIGNER_API_KEY: "signer-gateway-secret-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SETTLEMENT_STORE_URL: "https://app.example/api/v1/internal/cardano-settlement-claims",
    CARDANO_SETTLEMENT_STORE_API_KEY: "claim-store-secret-abcdefghijklmnopqrstuvwxyz",
    MANAGED_SIGNING_API_KEY: "managed-signing-secret-abcdefghijklmnopqrstuvwxyz",
    SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  };
}

describe("Cardano native facilitator production config", () => {
  it("accepts ADA-only or one exact whitelisted USDCx asset", () => {
    expect(parseCardanoNativeEnv(production()).CARDANO_USDCX_ASSET_ID).toBeUndefined();
    expect(parseCardanoNativeEnv(production({ CARDANO_USDCX_ASSET_ID: USDCX })).CARDANO_USDCX_ASSET_ID).toBe(USDCX);
  });

  it("rejects malformed native-asset configuration", () => {
    expect(() => parseCardanoNativeEnv(production({ CARDANO_USDCX_ASSET_ID: "usdcx" }))).toThrow();
  });

  it("requires HTTPS for Blockfrost signer and claim store in production", () => {
    expect(() => parseCardanoNativeEnv(production({ CARDANO_SIGNER_URL: "http://signer.example/sign" }))).toThrow("CARDANO_SIGNER_URL must use HTTPS in production");
    expect(() => parseCardanoNativeEnv(production({ CARDANO_SETTLEMENT_STORE_URL: "http://app.example/claims" }))).toThrow("CARDANO_SETTLEMENT_STORE_URL must use HTTPS in production");
  });

  it("requires signing settlement signer and store capabilities to be distinct", () => {
    const shared = "shared-secret-abcdefghijklmnopqrstuvwxyz-123456";
    expect(() => parseCardanoNativeEnv(production({ CARDANO_SIGNER_API_KEY: shared, CARDANO_SETTLEMENT_STORE_API_KEY: shared }))).toThrow("must be distinct");
    expect(() => parseCardanoNativeEnv(production({ MANAGED_SIGNING_API_KEY: shared, SETTLEMENT_API_KEY: shared }))).toThrow("must be distinct");
  });

  it("never permits a Mainnet facilitator in non-production mode", () => {
    expect(() => parseCardanoNativeEnv({ ...production(), APP_ENV: "test", CARDANO_NETWORK: "mainnet" })).toThrow("Cardano Mainnet is prohibited outside production");
  });
});
