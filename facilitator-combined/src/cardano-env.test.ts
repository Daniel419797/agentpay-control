import { describe, expect, it } from "vitest";
import { parseCardanoEnv } from "./cardano.js";

const PREPROD_PAYER = "addr_test1qzjeazrvkpc3twtg9xu7na0dw5zshqwwh354gmh0626gv4r9vh67k4754l9ugvw5uex30x4u6lyfvr0a34vynjmk2nzq7hqhjn";
const MAINNET_PAYER = "addr1qxjeazrvkpc3twtg9xu7na0dw5zshqwwh354gmh0626gv4r9vh67k4754l9ugvw5uex30x4u6lyfvr0a34vynjmk2nzqapah7v";

function preprod(overrides: Record<string, string> = {}) {
  return {
    APP_ENV: "production",
    CARDANO_NETWORK: "preprod",
    CARDANO_PAYER_ADDRESS: PREPROD_PAYER,
    CARDANO_BLOCKFROST_URL: "https://cardano-preprod.blockfrost.io/api/v0",
    CARDANO_BLOCKFROST_PROJECT_ID: "preprod-project-id-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SIGNER_URL: "https://cardano-signer.example/sign",
    CARDANO_SIGNER_API_KEY: "signer-secret-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SETTLEMENT_STORE_URL: "https://agentpay.example/api/v1/internal/cardano-settlement-claims",
    CARDANO_SETTLEMENT_STORE_API_KEY: "store-secret-abcdefghijklmnopqrstuvwxyz",
    MANAGED_SIGNING_API_KEY: "managed-secret-abcdefghijklmnopqrstuvwxyz",
    SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
    ...overrides,
  };
}

describe("Cardano facilitator environment", () => {
  it("accepts a fully isolated HTTPS Preprod configuration", () => {
    const env = parseCardanoEnv(preprod());
    expect(env.CARDANO_NETWORK).toBe("preprod");
    expect(env.CARDANO_PAYER_ADDRESS).toBe(PREPROD_PAYER);
  });

  it("rejects wrong-network payer addresses", () => {
    expect(() => parseCardanoEnv(preprod({ CARDANO_PAYER_ADDRESS: MAINNET_PAYER }))).toThrow(/ADDRESS_NETWORK_MISMATCH/);
  });

  it("requires HTTPS and distinct custody/control secrets in production", () => {
    expect(() => parseCardanoEnv(preprod({ CARDANO_SIGNER_URL: "http://signer.internal/sign" }))).toThrow(/must use HTTPS/);
    const duplicate = "duplicate-secret-abcdefghijklmnopqrstuvwxyz";
    expect(() => parseCardanoEnv(preprod({ CARDANO_SIGNER_API_KEY: duplicate, SETTLEMENT_API_KEY: duplicate }))).toThrow(/must be distinct/);
  });

  it("prohibits Mainnet outside production", () => {
    expect(() => parseCardanoEnv({ ...preprod(), APP_ENV: "test", CARDANO_NETWORK: "mainnet", CARDANO_PAYER_ADDRESS: MAINNET_PAYER })).toThrow(/Mainnet is prohibited outside production/);
  });
});