import { describe, expect, it } from "vitest";
import { parseArcEnv } from "./app.js";

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    ARC_PAYER_PRIVATE_KEY: "1".repeat(64),
    ARC_RELAYER_PRIVATE_KEY: "2".repeat(64),
    ARC_CONTRACT_EXECUTION_PRIVATE_KEY: "3".repeat(64),
    ARC_RPC_URL: "https://rpc.testnet.arc.network",
    ARC_PROVIDER_ADDRESS: "0x1111111111111111111111111111111111111111",
    MANAGED_SIGNING_API_KEY: "signing-secret-abcdefghijklmnopqrstuvwxyz-123",
    SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
    CONTRACT_EXECUTION_API_KEY: "contract-secret-abcdefghijklmnopqrstuvwxyz-12",
    ...overrides,
  };
}

describe("Arc facilitator production environment", () => {
  it("accepts independent capability and chain credentials", () => {
    expect(parseArcEnv(productionEnv()).APP_ENV).toBe("production");
  });

  it("allows blank optional role keys in local development so payer fallback can apply", () => {
    const parsed = parseArcEnv({
      APP_ENV: "development",
      ARC_PAYER_PRIVATE_KEY: "1".repeat(64),
      ARC_RELAYER_PRIVATE_KEY: "",
      ARC_CONTRACT_EXECUTION_PRIVATE_KEY: "",
      ARC_PROVIDER_ADDRESS: "0x1111111111111111111111111111111111111111",
    });
    expect(parsed.ARC_RELAYER_PRIVATE_KEY).toBeUndefined();
    expect(parsed.ARC_CONTRACT_EXECUTION_PRIVATE_KEY).toBeUndefined();
  });

  it("rejects missing capability-specific credentials", () => {
    const env = productionEnv();
    delete (env as Record<string, string>).CONTRACT_EXECUTION_API_KEY;
    expect(() => parseArcEnv(env)).toThrow(/capability-specific facilitator API keys are required/);
  });

  it("rejects capability-key reuse", () => {
    const duplicate = "duplicate-capability-secret-abcdefghijklmnopqrstuvwxyz";
    expect(() => parseArcEnv(productionEnv({
      MANAGED_SIGNING_API_KEY: duplicate,
      SETTLEMENT_API_KEY: duplicate,
    }))).toThrow(/must be distinct/);
  });

  it("rejects missing relayer or contract-execution private keys", () => {
    const env = productionEnv();
    delete (env as Record<string, string>).ARC_RELAYER_PRIVATE_KEY;
    expect(() => parseArcEnv(env)).toThrow(/relayer and contract-execution private keys are required/);
  });

  it("rejects blank relayer or contract-execution private keys in production", () => {
    expect(() => parseArcEnv(productionEnv({ ARC_RELAYER_PRIVATE_KEY: "" }))).toThrow(/relayer and contract-execution private keys are required/);
  });

  it("rejects private-key reuse across payer relayer and contract execution", () => {
    expect(() => parseArcEnv(productionEnv({
      ARC_RELAYER_PRIVATE_KEY: "1".repeat(64),
    }))).toThrow(/private keys must be distinct/);
  });
});
