import assert from "node:assert/strict";
import test from "node:test";
import { configFromEnv } from "./server.mjs";

const MAINNET_ADDRESS = "addr1qxj8e3xsl4pk6k5hsdtsd0zahfcfsqjq0x6c25pcrsr7gpwvmfgfdlwkq3mkwqdqw569ghrrhyacd56u9lekvxrdujlqxgta38";
const MANAGED_AGENT_MASTER_KEY = Buffer.alloc(32, 6).toString("base64url");
const MANAGED_ENV_KEYS = [
  "CARDANO_ED25519_SIGNER_URL",
  "CARDANO_ED25519_SIGNER_API_KEY",
  "CARDANO_PAYMENT_PUBLIC_KEY_HEX",
  "CARDANO_SIGNING_SEED_HEX",
  "CARDANO_MANAGED_AGENT_MASTER_KEY",
];

function withProductionEnv(overrides, callback) {
  const keys = [
    "APP_ENV",
    "CARDANO_NETWORK",
    "CARDANO_SIGNING_MODE",
    "CARDANO_PAYER_ADDRESS",
    "CARDANO_BLOCKFROST_URL",
    "CARDANO_BLOCKFROST_PROJECT_ID",
    "CARDANO_SIGNER_API_KEY",
    ...MANAGED_ENV_KEYS,
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    APP_ENV: "production",
    CARDANO_NETWORK: "mainnet",
    CARDANO_SIGNING_MODE: "unsigned-only",
    CARDANO_PAYER_ADDRESS: MAINNET_ADDRESS,
    CARDANO_BLOCKFROST_URL: "https://cardano-mainnet.blockfrost.io/api/v0",
    CARDANO_BLOCKFROST_PROJECT_ID: "mainnet-project-id-for-test",
    CARDANO_SIGNER_API_KEY: "gateway-capability-secret-1234567890",
    ...overrides,
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
  }
  for (const key of MANAGED_ENV_KEYS) {
    if (!(key in overrides)) delete process.env[key];
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production mainnet unsigned-only mode requires no private or remote signing key", () => {
  const config = withProductionEnv({ CARDANO_PAYER_ADDRESS: undefined }, () => configFromEnv());
  assert.equal(config.signingMode, "unsigned-only");
  assert.equal(config.network, "cardano:mainnet");
  assert.equal(config.payerAddress, undefined);
  assert.equal(config.remoteSignerUrl, undefined);
  assert.equal(config.agentMasterKey, undefined);
});

test("production preprod requires an isolated per-agent master key", () => {
  assert.throws(
    () => withProductionEnv({
      CARDANO_NETWORK: "preprod",
      CARDANO_SIGNING_MODE: "unsigned-only",
      CARDANO_BLOCKFROST_URL: "https://cardano-preprod.blockfrost.io/api/v0",
      CARDANO_PAYER_ADDRESS: undefined,
    }, () => configFromEnv()),
    /CARDANO_MANAGED_AGENT_MASTER_KEY_REQUIRED/,
  );

  const config = withProductionEnv({
    CARDANO_NETWORK: "preprod",
    CARDANO_SIGNING_MODE: "unsigned-only",
    CARDANO_BLOCKFROST_URL: "https://cardano-preprod.blockfrost.io/api/v0",
    CARDANO_PAYER_ADDRESS: undefined,
    CARDANO_MANAGED_AGENT_MASTER_KEY: MANAGED_AGENT_MASTER_KEY,
  }, () => configFromEnv());
  assert.equal(config.network, "cardano:preprod");
  assert.equal(config.agentMasterKey.length, 32);
});

test("mainnet rejects deterministic managed-agent master keys", () => {
  assert.throws(
    () => withProductionEnv({ CARDANO_MANAGED_AGENT_MASTER_KEY: MANAGED_AGENT_MASTER_KEY }, () => configFromEnv()),
    /CARDANO_MANAGED_AGENT_MASTER_KEY_TESTNET_ONLY/,
  );
});

test("legacy production managed mode still requires an isolated remote signer", () => {
  assert.throws(
    () => withProductionEnv({ CARDANO_SIGNING_MODE: "managed" }, () => configFromEnv()),
    /CARDANO_REMOTE_ED25519_SIGNER_REQUIRED/,
  );
});

test("production unsigned-only mode still prohibits raw signing seeds", () => {
  assert.throws(
    () => withProductionEnv({ CARDANO_SIGNING_SEED_HEX: "11".repeat(32) }, () => configFromEnv()),
    /CARDANO_RAW_SIGNING_SEED_PROHIBITED_IN_PRODUCTION/,
  );
});
