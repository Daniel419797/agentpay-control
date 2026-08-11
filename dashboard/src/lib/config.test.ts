import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/config";

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.agentpay.example",
    AUTH_SECRET: "auth-secret-abcdefghijklmnopqrstuvwxyz-123456",
    CRON_SECRET: "cron-secret-abcdefghijklmnopqrstuvwxyz-123456",
    FACILITATOR_URL: "https://facilitator.agentpay.example/hedera",
    FACILITATOR_SIGNING_API_KEY: "signing-secret-abcdefghijklmnopqrstuvwxyz-123",
    FACILITATOR_SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
    FACILITATOR_CONTRACT_API_KEY: "contract-secret-abcdefghijklmnopqrstuvwxyz-12",
    ARC_FACILITATOR_URL: "https://facilitator.agentpay.example/arc",
    ARC_FACILITATOR_SIGNING_API_KEY: "arc-signing-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_FACILITATOR_CONTRACT_API_KEY: "arc-contract-secret-abcdefghijklmnopqrstuvwxyz",
    ARC_RPC_URL: "https://rpc.testnet.arc.network",
    ARC_PROVIDER_ADDRESS: "0x1111111111111111111111111111111111111111",
    HEDERA_PAYER_ACCOUNT_ID: "0.0.12345",
    KEY_ENCRYPTION_MASTER_KEY: Buffer.alloc(32, 7).toString("base64url"),
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    VIRTUAL_CARDS_ENABLED: "false",
    CARD_PROVIDER: "SANDBOX",
    ...overrides,
  };
}

describe("production configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(parseEnv(productionEnv()).APP_ENV).toBe("production");
  });

  it("fails closed on schema-invalid production values", () => {
    expect(() => parseEnv(productionEnv({ AUTH_SECRET: "short" }))).toThrow("Invalid production environment");
  });

  it("fails when required production dependencies are missing", () => {
    const input = productionEnv();
    delete (input as Record<string, string>).FACILITATOR_URL;
    expect(() => parseEnv(input)).toThrow(/FACILITATOR_URL/);
  });

  it("requires HTTPS for production service endpoints", () => {
    expect(() => parseEnv(productionEnv({ FACILITATOR_URL: "http://facilitator.example/hedera" }))).toThrow(/FACILITATOR_URL must use HTTPS/);
  });

  it("rejects capability-secret reuse within and across networks", () => {
    const duplicate = "duplicate-capability-secret-abcdefghijklmnopqrstuvwxyz";
    expect(() => parseEnv(productionEnv({
      FACILITATOR_SIGNING_API_KEY: duplicate,
      FACILITATOR_SETTLEMENT_API_KEY: duplicate,
    }))).toThrow(/must use distinct secrets/);

    expect(() => parseEnv(productionEnv({
      FACILITATOR_SIGNING_API_KEY: duplicate,
      ARC_FACILITATOR_SIGNING_API_KEY: duplicate,
    }))).toThrow(/must use distinct secrets/);
  });

  it("requires canonical unpadded base64url for the 32-byte encryption key", () => {
    expect(() => parseEnv(productionEnv({ KEY_ENCRYPTION_MASTER_KEY: "A".repeat(42) + "+" }))).toThrow(/unpadded base64url/);
    expect(() => parseEnv(productionEnv({ KEY_ENCRYPTION_MASTER_KEY: Buffer.alloc(31, 7).toString("base64url") }))).toThrow(/unpadded base64url/);
  });

  it("requires a mainnet signing credential when mainnet is configured", () => {
    expect(() => parseEnv(productionEnv({
      HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.agentpay.example/hedera",
    }))).toThrow(/HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY/);

    expect(parseEnv(productionEnv({
      HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.agentpay.example/hedera",
      HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY: "mainnet-signing-secret-abcdefghijklmnopqrstuvwxyz",
    })).HEDERA_MAINNET_FACILITATOR_URL).toContain("mainnet-facilitator");
  });
});
