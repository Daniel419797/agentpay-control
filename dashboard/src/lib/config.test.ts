import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/config";

const CARDANO_PREPROD_PROVIDER = "addr_test1vr8nl3s7rk0tqn4rd9u49s0k52f9sezrt98rs4cnpfj47wggeuy4d";
const CARDANO_MAINNET_PROVIDER = "addr1v9x7y0l7m8k3cq4k8w8n6wsysr7t9u3kz3q4j5t6u7v8w9x0y2z3a";

function productionEnv(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://app.agentpay.example",
    AUTH_SECRET: "auth-secret-abcdefghijklmnopqrstuvwxyz-123456",
    CRON_SECRET: "cron-secret-abcdefghijklmnopqrstuvwxyz-123456",
    AGENTPAY_FACILITATOR_ORIGIN: "https://facilitator.agentpay.example",
    FACILITATOR_SIGNING_API_KEY: "signing-secret-abcdefghijklmnopqrstuvwxyz-123",
    FACILITATOR_SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
    FACILITATOR_CONTRACT_API_KEY: "contract-secret-abcdefghijklmnopqrstuvwxyz-12",
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

function cardanoPreprodEnv(overrides: Record<string, string> = {}) {
  return productionEnv({
    CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: "cardano-preprod-signing-abcdefghijklmnopqrstuvwxyz",
    CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY: "cardano-preprod-settlement-abcdefghijklmnopqrstuvwxyz",
    CARDANO_PREPROD_PROVIDER_ADDRESS: CARDANO_PREPROD_PROVIDER,
    CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: "preprod-project-id-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SETTLEMENT_STORE_API_KEY: "cardano-store-secret-abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  });
}

describe("production configuration", () => {
  it("accepts one unified facilitator origin instead of per-network URLs", () => {
    const env = parseEnv(productionEnv());
    expect(env.APP_ENV).toBe("production");
    expect(env.AGENTPAY_FACILITATOR_ORIGIN).toBe("https://facilitator.agentpay.example");
    expect(env.FACILITATOR_URL).toBeUndefined();
    expect(env.ARC_FACILITATOR_URL).toBeUndefined();
  });

  it("fails closed on an invalid explicit APP_ENV instead of using development defaults", () => {
    expect(() => parseEnv({ APP_ENV: "prodution", AUTH_SECRET: "short" })).toThrow(/Invalid APP_ENV: prodution/);
  });

  it("fails closed on schema-invalid production values", () => {
    expect(() => parseEnv(productionEnv({ AUTH_SECRET: "short" }))).toThrow("Invalid production environment");
  });

  it("requires either the unified origin or the legacy Hedera testnet URL", () => {
    const input = productionEnv();
    delete (input as Record<string, string>).AGENTPAY_FACILITATOR_ORIGIN;
    expect(() => parseEnv(input)).toThrow(/FACILITATOR_URL or AGENTPAY_FACILITATOR_ORIGIN/);
    expect(parseEnv({ ...input, FACILITATOR_URL: "https://facilitator.agentpay.example/hedera/testnet", ARC_FACILITATOR_URL: "https://facilitator.agentpay.example/arc/testnet" }).APP_ENV).toBe("production");
  });

  it("does not require deployment-wide agent payer identities", () => {
    const env = parseEnv(productionEnv());
    expect(env.ARC_PAYER_ADDRESS).toBeUndefined();
    expect(env.CARDANO_PREPROD_PAYER_ADDRESS).toBeUndefined();
    expect(env.CARDANO_MAINNET_PAYER_ADDRESS).toBeUndefined();
  });

  it("requires HTTPS for the unified production origin", () => {
    expect(() => parseEnv(productionEnv({ AGENTPAY_FACILITATOR_ORIGIN: "http://facilitator.example" }))).toThrow(/AGENTPAY_FACILITATOR_ORIGIN must use HTTPS/);
  });

  it("rejects capability-secret reuse within and across networks", () => {
    const duplicate = "duplicate-capability-secret-abcdefghijklmnopqrstuvwxyz";
    expect(() => parseEnv(productionEnv({ FACILITATOR_SIGNING_API_KEY: duplicate, FACILITATOR_SETTLEMENT_API_KEY: duplicate }))).toThrow(/must use distinct secrets/);
    expect(() => parseEnv(productionEnv({ FACILITATOR_SIGNING_API_KEY: duplicate, ARC_FACILITATOR_SIGNING_API_KEY: duplicate }))).toThrow(/must use distinct secrets/);
    expect(() => parseEnv(cardanoPreprodEnv({ CARDANO_SETTLEMENT_STORE_API_KEY: duplicate, CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY: duplicate }))).toThrow(/must use distinct secrets/);
  });

  it("requires canonical unpadded base64url for the 32-byte encryption key", () => {
    expect(() => parseEnv(productionEnv({ KEY_ENCRYPTION_MASTER_KEY: "A".repeat(42) + "+" }))).toThrow(/unpadded base64url/);
    expect(() => parseEnv(productionEnv({ KEY_ENCRYPTION_MASTER_KEY: Buffer.alloc(31, 7).toString("base64url") }))).toThrow(/unpadded base64url/);
  });

  it("does not require a managed Hedera mainnet signing identity", () => {
    const env = parseEnv(productionEnv({
      HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY: "hedera-mainnet-contract-abcdefghijklmnopqrstuvwxyz",
      HEDERA_MAINNET_PAYER_ACCOUNT_ID: "0.0.54321",
    }));
    expect(env.HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY).toBeUndefined();
  });

  it("requires every Cardano Preprod capability, payee, evidence, and durable replay dependency once requested", () => {
    expect(() => parseEnv(productionEnv({ CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: "cardano-preprod-signing-abcdefghijklmnopqrstuvwxyz" }))).toThrow(/Cardano Preprod/);
    const withoutStore = cardanoPreprodEnv();
    delete (withoutStore as Record<string, string>).CARDANO_SETTLEMENT_STORE_API_KEY;
    expect(() => parseEnv(withoutStore)).toThrow(/CARDANO_SETTLEMENT_STORE_API_KEY/);
    expect(parseEnv(cardanoPreprodEnv()).CARDANO_PREPROD_PAYER_ADDRESS).toBeUndefined();
  });

  it("requires HTTPS for Cardano Blockfrost endpoints", () => {
    expect(() => parseEnv(cardanoPreprodEnv({ CARDANO_PREPROD_BLOCKFROST_URL: "http://cardano-preprod.blockfrost.io/api/v0" }))).toThrow(/CARDANO_PREPROD_BLOCKFROST_URL must use HTTPS/);
  });

  it("accepts a Cardano Mainnet self-custody rail without a platform payer", () => {
    const env = parseEnv(productionEnv({
      CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY: "cardano-mainnet-prepare-abcdefghijklmnopqrstuvwxyz",
      CARDANO_MAINNET_FACILITATOR_SETTLEMENT_API_KEY: "cardano-mainnet-settlement-abcdefghijklmnopqrstuvwxyz",
      CARDANO_MAINNET_PROVIDER_ADDRESS: CARDANO_MAINNET_PROVIDER,
      CARDANO_MAINNET_BLOCKFROST_PROJECT_ID: "mainnet-project-id-abcdefghijklmnopqrstuvwxyz",
      CARDANO_SETTLEMENT_STORE_API_KEY: "cardano-store-secret-abcdefghijklmnopqrstuvwxyz",
    }));
    expect(env.CARDANO_MAINNET_PAYER_ADDRESS).toBeUndefined();
    expect(env.AGENTPAY_FACILITATOR_ORIGIN).toBe("https://facilitator.agentpay.example");
  });
});
