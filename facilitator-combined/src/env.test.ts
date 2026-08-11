import { describe, expect, it } from "vitest";
import { networkEnv, parseCombinedEnv } from "./env.js";

const PAYER = "1".repeat(64);
const RELAYER = "2".repeat(64);
const CONTRACT = "3".repeat(64);

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: "production",
    HEDERA_MANAGED_SIGNING_API_KEY: "h-signing-secret-abcdefghijklmnopqrstuvwxyz",
    HEDERA_SETTLEMENT_API_KEY: "h-settlement-secret-abcdefghijklmnopqrstuvwxyz",
    HEDERA_CONTRACT_EXECUTION_API_KEY: "h-contract-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_MANAGED_SIGNING_API_KEY: "a-signing-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_SETTLEMENT_API_KEY: "a-settlement-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_CONTRACT_EXECUTION_API_KEY: "a-contract-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_PAYER_PRIVATE_KEY: PAYER,
    ARC_RELAYER_PRIVATE_KEY: RELAYER,
    ARC_CONTRACT_EXECUTION_PRIVATE_KEY: CONTRACT,
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

  it("requires independent Arc payer, relayer, and contract keys", () => {
    const missing = productionEnv();
    delete missing.ARC_RELAYER_PRIVATE_KEY;
    expect(() => parseCombinedEnv(missing)).toThrow(/requires Arc payer, relayer, and contract-execution private keys/);
    expect(() => parseCombinedEnv(productionEnv({ ARC_RELAYER_PRIVATE_KEY: `0x${PAYER}` }))).toThrow(/private keys must be distinct/);
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
