import assert from "node:assert/strict";
import test from "node:test";
import { productionPreflightErrors } from "./production-preflight.js";

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    ENABLED_NETWORKS: "hedera:testnet,eip155:5042002",
    FACILITATOR_URL: "https://facilitator.agentpay.example/hedera",
    PROVIDER_ACCOUNT_ID: "0.0.12345",
    USDC_TOKEN_ID: "0.0.45678",
    FACILITATOR_SETTLEMENT_API_KEY: "hedera-settlement-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_FACILITATOR_URL: "https://facilitator.agentpay.example/arc",
    ARC_PROVIDER_ADDRESS: "0x1111111111111111111111111111111111111111",
    ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
    ARC_FACILITATOR_SETTLEMENT_API_KEY: "arc-settlement-secret-abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  };
}

test("accepts complete production configuration for enabled networks", () => {
  assert.deepEqual(productionPreflightErrors(productionEnv()), []);
});

test("fails closed on localhost or HTTP facilitator configuration", () => {
  const errors = productionPreflightErrors(productionEnv({
    FACILITATOR_URL: "http://localhost:8787/hedera",
  }));
  assert.equal(errors.some((error) => error.includes("FACILITATOR_URL must use HTTPS")), true);
});

test("requires explicit Arc settlement destination and token", () => {
  const env = productionEnv();
  delete (env as Record<string, string>).ARC_PROVIDER_ADDRESS;
  delete (env as Record<string, string>).ARC_USDC_ADDRESS;
  const errors = productionPreflightErrors(env);
  assert.equal(errors.includes("ARC_PROVIDER_ADDRESS"), true);
  assert.equal(errors.includes("ARC_USDC_ADDRESS"), true);
});

test("requires independent mainnet settlement configuration when mainnet is enabled", () => {
  const errors = productionPreflightErrors(productionEnv({
    ENABLED_NETWORKS: "hedera:mainnet",
  }));
  assert.equal(errors.includes("HEDERA_MAINNET_FACILITATOR_URL"), true);
  assert.equal(errors.includes("HEDERA_MAINNET_PROVIDER_ACCOUNT_ID"), true);
  assert.equal(errors.includes("HEDERA_MAINNET_USDC_TOKEN_ID"), true);
  assert.equal(errors.includes("HEDERA_MAINNET_FACILITATOR_SETTLEMENT_API_KEY"), true);
});
