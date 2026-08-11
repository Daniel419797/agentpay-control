import { describe, expect, it } from "vitest";
import { parseHederaEnv } from "./app.js";

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    HEDERA_NETWORK: "testnet",
    HEDERA_OPERATOR_ID: "0.0.1001",
    HEDERA_OPERATOR_KEY: "operator-private-key",
    HEDERA_PAYER_ID: "0.0.1002",
    HEDERA_PAYER_KEY: "payer-private-key",
    MANAGED_SIGNING_API_KEY: "signing-secret-abcdefghijklmnopqrstuvwxyz-123",
    SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
    CONTRACT_EXECUTION_API_KEY: "contract-secret-abcdefghijklmnopqrstuvwxyz-12",
    ...overrides,
  };
}

describe("Hedera facilitator production environment", () => {
  it("accepts independent capability and chain keys", () => {
    expect(parseHederaEnv(productionEnv()).APP_ENV).toBe("production");
  });

  it("rejects missing capability-specific credentials", () => {
    const env = productionEnv();
    delete (env as Record<string, string>).SETTLEMENT_API_KEY;
    expect(() => parseHederaEnv(env)).toThrow(/capability-specific facilitator API keys are required/);
  });

  it("rejects capability-key reuse", () => {
    const duplicate = "duplicate-capability-secret-abcdefghijklmnopqrstuvwxyz";
    expect(() => parseHederaEnv(productionEnv({
      MANAGED_SIGNING_API_KEY: duplicate,
      SETTLEMENT_API_KEY: duplicate,
    }))).toThrow(/must be distinct/);
  });

  it("rejects reuse of the x402 operator key as the managed payer key", () => {
    expect(() => parseHederaEnv(productionEnv({
      HEDERA_OPERATOR_KEY: "same-chain-private-key",
      HEDERA_PAYER_KEY: "same-chain-private-key",
    }))).toThrow(/settlement and managed payer keys must be distinct/);
  });

  it("requires an explicit algorithm for raw 64-hex private keys", () => {
    const key = "a".repeat(64);
    expect(() => parseHederaEnv(productionEnv({ HEDERA_OPERATOR_KEY: key }))).toThrow(/HEDERA_OPERATOR_KEY_TYPE is required/);
    expect(parseHederaEnv(productionEnv({ HEDERA_OPERATOR_KEY: key, HEDERA_OPERATOR_KEY_TYPE: "ED25519" })).HEDERA_OPERATOR_KEY_TYPE).toBe("ED25519");
  });

  it("rejects equivalent raw chain keys with different serialized prefixes", () => {
    const key = "a".repeat(64);
    expect(() => parseHederaEnv(productionEnv({
      HEDERA_OPERATOR_KEY: `0x${key}`,
      HEDERA_OPERATOR_KEY_TYPE: "ECDSA",
      HEDERA_PAYER_KEY: key,
      HEDERA_PAYER_KEY_TYPE: "ECDSA",
    }))).toThrow(/settlement and managed payer keys must be distinct/);
  });
});
