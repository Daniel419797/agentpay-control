import { describe, expect, it } from "vitest";
import { networkEnv, parseCombinedEnv } from "./env.js";

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: "production",
    HEDERA_MANAGED_SIGNING_API_KEY: "h-signing-secret-abcdefghijklmnopqrstuvwxyz",
    HEDERA_SETTLEMENT_API_KEY: "h-settlement-secret-abcdefghijklmnopqrstuvwxyz",
    HEDERA_CONTRACT_EXECUTION_API_KEY: "h-contract-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_MANAGED_SIGNING_API_KEY: "a-signing-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_SETTLEMENT_API_KEY: "a-settlement-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_CONTRACT_EXECUTION_API_KEY: "a-contract-secret-abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  };
}

describe("combined facilitator environment", () => {
  it("requires six independent production capability credentials", () => {
    expect(parseCombinedEnv(productionEnv()).APP_ENV).toBe("production");
    const duplicate = "duplicate-network-secret-abcdefghijklmnopqrstuvwxyz";
    expect(() => parseCombinedEnv(productionEnv({
      HEDERA_SETTLEMENT_API_KEY: duplicate,
      ARC_SETTLEMENT_API_KEY: duplicate,
    }))).toThrow(/must all be distinct/);
  });

  it("maps network-specific secrets to each child facilitator", () => {
    const input = productionEnv();
    const env = parseCombinedEnv(input);
    expect(networkEnv(input, env, "hedera").SETTLEMENT_API_KEY).toBe(input.HEDERA_SETTLEMENT_API_KEY);
    expect(networkEnv(input, env, "arc").SETTLEMENT_API_KEY).toBe(input.ARC_SETTLEMENT_API_KEY);
  });

  it("rejects overlapping mount paths", () => {
    expect(() => parseCombinedEnv(productionEnv({ HEDERA_BASE_PATH: "/pay", ARC_BASE_PATH: "/pay" }))).toThrow(/base paths must be distinct/);
  });
});
