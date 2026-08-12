import { describe, expect, it } from "vitest";

import { parseEnv } from "@/lib/config";

const CARDANO_PREPROD_PAYER = "addr_test1qzjeazrvkpc3twtg9xu7na0dw5zshqwwh354gmh0626gv4r9vh67k4754l9ugvw5uex30x4u6lyfvr0a34vynjmk2nzq7hqhjn";
const CARDANO_PREPROD_PROVIDER = "addr_test1vr8nl3s7rk0tqn4rd9u49s0k52f9sezrt98rs4cnpfj47wggeuy4d";

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
    ARC_PAYER_ADDRESS: "0x2222222222222222222222222222222222222222",
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
    CARDANO_PREPROD_FACILITATOR_URL: "https://facilitator.agentpay.example/cardano",
    CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: "cardano-preprod-signing-abcdefghijklmnopqrstuvwxyz",
    CARDANO_PREPROD_FACILITATOR_SETTLEMENT_API_KEY: "cardano-preprod-settlement-abcdefghijklmnopqrstuvwxyz",
    CARDANO_PREPROD_PAYER_ADDRESS: CARDANO_PREPROD_PAYER,
    CARDANO_PREPROD_PROVIDER_ADDRESS: CARDANO_PREPROD_PROVIDER,
    CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: "preprod-project-id-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SETTLEMENT_STORE_API_KEY: "cardano-store-secret-abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  });
}

describe("production configuration", () => {
  it("accepts a complete production configuration", () => {
    expect(parseEnv(productionEnv()).APP_ENV).toBe("production");
  });

  it("fails closed on an invalid explicit APP_ENV instead of using development defaults", () => {
    expect(() => parseEnv({ APP_ENV: "prodution", AUTH_SECRET: "short" })).toThrow(/Invalid APP_ENV: prodution/);
  });

  it("fails closed on schema-invalid production values", () => {
    expect(() => parseEnv(productionEnv({ AUTH_SECRET: "short" }))).toThrow("Invalid production environment");
  });

  it("fails when required production dependencies are missing", () => {
    const input = productionEnv();
    delete (input as Record<string, string>).FACILITATOR_URL;
    expect(() => parseEnv(input)).toThrow(/FACILITATOR_URL/);
  });

  it("requires a managed Arc payer identity in production", () => {
    const input = productionEnv();
    delete (input as Record<string, string>).ARC_PAYER_ADDRESS;
    expect(() => parseEnv(input)).toThrow(/ARC_PAYER_ADDRESS/);
  });

  it("requires HTTPS for production service endpoints", () => {
    expect(() => parseEnv(productionEnv({ FACILITATOR_URL: "http://facilitator.example/hedera" }))).toThrow(/FACILITATOR_URL must use HTTPS/);
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

  it("requires a mainnet signing credential when mainnet is configured", () => {
    expect(() => parseEnv(productionEnv({ HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.agentpay.example/hedera" }))).toThrow(/HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY/);
    expect(parseEnv(productionEnv({ HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.agentpay.example/hedera", HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY: "mainnet-signing-secret-abcdefghijklmnopqrstuvwxyz" })).HEDERA_MAINNET_FACILITATOR_URL).toContain("mainnet-facilitator");
  });

  it("keeps Cardano disabled when no Cardano rail is requested", () => {
    const env = parseEnv(productionEnv());
    expect(env.CARDANO_PREPROD_FACILITATOR_URL).toBeUndefined();
    expect(env.CARDANO_MAINNET_FACILITATOR_URL).toBeUndefined();
  });

  it("requires every Cardano Preprod signer, payee, evidence, and durable replay dependency once requested", () => {
    expect(() => parseEnv(productionEnv({ CARDANO_PREPROD_FACILITATOR_URL: "https://facilitator.agentpay.example/cardano" }))).toThrow(/Cardano Preprod/);
    const withoutStore = cardanoPreprodEnv();
    delete (withoutStore as Record<string, string>).CARDANO_SETTLEMENT_STORE_API_KEY;
    expect(() => parseEnv(withoutStore)).toThrow(/CARDANO_SETTLEMENT_STORE_API_KEY/);
    expect(parseEnv(cardanoPreprodEnv()).CARDANO_PREPROD_PAYER_ADDRESS).toBe(CARDANO_PREPROD_PAYER);
  });

  it("requires HTTPS for Cardano production facilitator and Blockfrost endpoints", () => {
    expect(() => parseEnv(cardanoPreprodEnv({ CARDANO_PREPROD_FACILITATOR_URL: "http://facilitator.agentpay.example/cardano" }))).toThrow(/CARDANO_PREPROD_FACILITATOR_URL must use HTTPS/);
    expect(() => parseEnv(cardanoPreprodEnv({ CARDANO_PREPROD_BLOCKFROST_URL: "http://cardano-preprod.blockfrost.io/api/v0" }))).toThrow(/CARDANO_PREPROD_BLOCKFROST_URL must use HTTPS/);
  });
});
