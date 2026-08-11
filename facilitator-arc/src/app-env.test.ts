import { describe, expect, it } from "vitest";
import { parseArcEnv } from "./app.js";

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    ARC_PAYER_PRIVATE_KEY: "1".repeat(64),
    ARC_RPC_URL: "https://rpc.testnet.arc.network",
    ARC_PROVIDER_ADDRESS: "0x1111111111111111111111111111111111111111",
    MANAGED_SIGNING_API_KEY: "signing-secret-abcdefghijklmnopqrstuvwxyz-123",
    SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
    CONTRACT_EXECUTION_API_KEY: "contract-secret-abcdefghijklmnopqrstuvwxyz-12",
    ...overrides,
  };
}

describe("Arc facilitator production environment", () => {
  it("accepts independent capability credentials", () => {
    expect(parseArcEnv(productionEnv()).APP_ENV).toBe("production");
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
});
