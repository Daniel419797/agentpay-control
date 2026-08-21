import { describe, expect, it } from "vitest";
import { networkEnv, parseCombinedEnv } from "./env.js";

const PAYER = "1".repeat(64);
const RELAYER = "2".repeat(64);
const CONTRACT = "3".repeat(64);
const secret = (label: string) => `${label}-${"x".repeat(Math.max(0, 40 - label.length))}`;

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    APP_ENV: "production",
    HEDERA_TESTNET_MANAGED_SIGNING_API_KEY: secret("h-test-sign"),
    HEDERA_TESTNET_SETTLEMENT_API_KEY: secret("h-test-settle"),
    HEDERA_TESTNET_CONTRACT_EXECUTION_API_KEY: secret("h-test-contract"),
    HEDERA_MAINNET_MANAGED_SIGNING_API_KEY: secret("h-main-sign"),
    HEDERA_MAINNET_SETTLEMENT_API_KEY: secret("h-main-settle"),
    HEDERA_MAINNET_CONTRACT_EXECUTION_API_KEY: secret("h-main-contract"),
    ARC_TESTNET_MANAGED_SIGNING_API_KEY: secret("arc-sign"),
    ARC_TESTNET_SETTLEMENT_API_KEY: secret("arc-settle"),
    ARC_TESTNET_CONTRACT_EXECUTION_API_KEY: secret("arc-contract"),
    ARC_TESTNET_PAYER_PRIVATE_KEY: PAYER,
    ARC_TESTNET_RELAYER_PRIVATE_KEY: RELAYER,
    ARC_TESTNET_CONTRACT_EXECUTION_PRIVATE_KEY: CONTRACT,
    CARDANO_PREPROD_MANAGED_SIGNING_API_KEY: secret("c-pre-sign"),
    CARDANO_PREPROD_SETTLEMENT_API_KEY: secret("c-pre-settle"),
    CARDANO_MAINNET_MANAGED_SIGNING_API_KEY: secret("c-main-sign"),
    CARDANO_MAINNET_SETTLEMENT_API_KEY: secret("c-main-settle"),
    CARDANO_PREPROD_SIGNER_API_KEY: secret("c-pre-signer"),
    CARDANO_MAINNET_SIGNER_API_KEY: secret("c-main-signer"),
    CARDANO_SETTLEMENT_STORE_API_KEY: secret("c-store"),
    CARDANO_SIGNER_ORIGIN: "https://agentpay-cardano-signer.example.com",
    CARDANO_SETTLEMENT_STORE_URL: "https://agentpay.example.com/api/v1/internal/cardano-settlement-claims",
    HEDERA_TESTNET_OPERATOR_ID: "0.0.1001",
    HEDERA_TESTNET_OPERATOR_KEY: "4".repeat(64),
    HEDERA_TESTNET_OPERATOR_KEY_TYPE: "ED25519",
    HEDERA_TESTNET_PAYER_ID: "0.0.1002",
    HEDERA_TESTNET_PAYER_KEY: "5".repeat(64),
    HEDERA_TESTNET_PAYER_KEY_TYPE: "ED25519",
    HEDERA_TESTNET_MANAGED_AGENT_MASTER_KEY: Buffer.alloc(32, 1).toString("base64url"),
    HEDERA_MAINNET_OPERATOR_ID: "0.0.2001",
    HEDERA_MAINNET_OPERATOR_KEY: "6".repeat(64),
    HEDERA_MAINNET_OPERATOR_KEY_TYPE: "ED25519",
    HEDERA_MAINNET_PAYER_ID: "0.0.2002",
    HEDERA_MAINNET_PAYER_KEY: "7".repeat(64),
    HEDERA_MAINNET_PAYER_KEY_TYPE: "ED25519",
    ARC_TESTNET_MANAGED_AGENT_MASTER_KEY: Buffer.alloc(32, 2).toString("base64url"),
    CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: "preprod-project-id-1234567890",
    CARDANO_MAINNET_BLOCKFROST_PROJECT_ID: "mainnet-project-id-1234567890",
    ...overrides,
  };
}

describe("unified facilitator environment", () => {
  it("requires independent production capability and signer credentials", () => {
    expect(parseCombinedEnv(productionEnv()).APP_ENV).toBe("production");
    const duplicate = secret("duplicate");
    expect(() => parseCombinedEnv(productionEnv({ HEDERA_TESTNET_SETTLEMENT_API_KEY: duplicate, CARDANO_MAINNET_SETTLEMENT_API_KEY: duplicate }))).toThrow(/must be distinct/);
    const missing = productionEnv();
    delete missing.CARDANO_MAINNET_SIGNER_API_KEY;
    expect(() => parseCombinedEnv(missing)).toThrow(/CARDANO_MAINNET_SIGNER_API_KEY/);
  });

  it("requires independent Arc testnet payer, relayer, and contract keys", () => {
    const missing = productionEnv();
    delete missing.ARC_TESTNET_RELAYER_PRIVATE_KEY;
    expect(() => parseCombinedEnv(missing)).toThrow(/ARC_TESTNET_PAYER_PRIVATE_KEY/);
    expect(() => parseCombinedEnv(productionEnv({ ARC_TESTNET_RELAYER_PRIVATE_KEY: `0x${PAYER}` }))).toThrow(/must be distinct/);
  });

  it("maps Hedera testnet and mainnet into separate child environments", () => {
    const input = productionEnv();
    const env = parseCombinedEnv(input);
    const testnet = networkEnv(input, env, "hederaTestnet");
    const mainnet = networkEnv(input, env, "hederaMainnet");
    expect(testnet.HEDERA_NETWORK).toBe("testnet");
    expect(testnet.HEDERA_OPERATOR_ID).toBe(input.HEDERA_TESTNET_OPERATOR_ID);
    expect(testnet.MANAGED_SIGNING_API_KEY).toBe(input.HEDERA_TESTNET_MANAGED_SIGNING_API_KEY);
    expect(mainnet.HEDERA_NETWORK).toBe("mainnet");
    expect(mainnet.HEDERA_OPERATOR_ID).toBe(input.HEDERA_MAINNET_OPERATOR_ID);
    expect(mainnet.HEDERA_MANAGED_AGENT_MASTER_KEY).toBeUndefined();
    expect(mainnet.SETTLEMENT_API_KEY).toBe(input.HEDERA_MAINNET_SETTLEMENT_API_KEY);
  });

  it("maps both Cardano networks to one signer origin with isolated capabilities", () => {
    const input = productionEnv();
    const env = parseCombinedEnv(input);
    const preprod = networkEnv(input, env, "cardanoPreprod");
    const mainnet = networkEnv(input, env, "cardanoMainnet");
    expect(preprod.CARDANO_NETWORK).toBe("preprod");
    expect(preprod.CARDANO_SIGNER_URL).toBe("https://agentpay-cardano-signer.example.com/preprod");
    expect(preprod.CARDANO_SIGNER_API_KEY).toBe(input.CARDANO_PREPROD_SIGNER_API_KEY);
    expect(mainnet.CARDANO_NETWORK).toBe("mainnet");
    expect(mainnet.CARDANO_SIGNER_URL).toBe("https://agentpay-cardano-signer.example.com/mainnet");
    expect(mainnet.CARDANO_SIGNER_API_KEY).toBe(input.CARDANO_MAINNET_SIGNER_API_KEY);
    expect(mainnet.CARDANO_PAYER_ADDRESS).toBeUndefined();
  });

  it("maps Arc only to the currently public testnet", () => {
    const input = productionEnv();
    const env = parseCombinedEnv(input);
    const arc = networkEnv(input, env, "arcTestnet");
    expect(arc.ARC_RPC_URL).toBe("https://rpc.testnet.arc.network");
    expect(arc.ARC_PAYER_PRIVATE_KEY).toBe(PAYER);
    expect(arc.MANAGED_SIGNING_API_KEY).toBe(input.ARC_TESTNET_MANAGED_SIGNING_API_KEY);
  });

  it("rejects overlapping top-level mount paths", () => {
    expect(() => parseCombinedEnv(productionEnv({ HEDERA_BASE_PATH: "/pay", CARDANO_BASE_PATH: "/pay" }))).toThrow(/base paths must be distinct/);
  });
});
