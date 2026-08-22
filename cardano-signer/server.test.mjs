import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { publicKeyFromSeed, signHashWithSeed } from "./cardano.mjs";
import { configFromEnv, createSignerServer } from "./server.mjs";

const MAINNET_ADDRESS = "addr1qxj8e3xsl4pk6k5hsdtsd0zahfcfsqjq0x6c25pcrsr7gpwvmfgfdlwkq3mkwqdqw569ghrrhyacd56u9lekvxrdujlqxgta38";
const MANAGED_AGENT_MASTER_KEY = Buffer.alloc(32, 6).toString("base64url");
const MANAGED_ENV_KEYS = [
  "CARDANO_ED25519_SIGNER_URL",
  "CARDANO_ED25519_SIGNER_API_KEY",
  "CARDANO_PAYMENT_PUBLIC_KEY_HEX",
  "CARDANO_SIGNING_SEED_HEX",
  "CARDANO_MANAGED_AGENT_MASTER_KEY",
  "CARDANO_AGENT_CUSTODY_URL",
  "CARDANO_AGENT_CUSTODY_API_KEY",
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

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function reply(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

test("production mainnet unsigned-only mode requires no private or remote signing key", () => {
  const config = withProductionEnv({ CARDANO_PAYER_ADDRESS: undefined }, () => configFromEnv());
  assert.equal(config.signingMode, "unsigned-only");
  assert.equal(config.network, "cardano:mainnet");
  assert.equal(config.payerAddress, undefined);
  assert.equal(config.remoteSignerUrl, undefined);
  assert.equal(config.agentMasterKey, undefined);
  assert.equal(config.agentCustodyUrl, undefined);
});

test("production mainnet accepts isolated per-agent external custody", () => {
  const config = withProductionEnv({
    CARDANO_PAYER_ADDRESS: undefined,
    CARDANO_AGENT_CUSTODY_URL: "https://custody.example.com/cardano",
    CARDANO_AGENT_CUSTODY_API_KEY: "agent-custody-capability-secret-1234567890",
  }, () => configFromEnv());
  assert.equal(config.network, "cardano:mainnet");
  assert.equal(config.agentMasterKey, undefined);
  assert.equal(config.agentCustodyUrl, "https://custody.example.com/cardano");
  assert.equal(config.agentCustodyApiKey, "agent-custody-capability-secret-1234567890");
});

test("production mainnet rejects incomplete external custody configuration", () => {
  assert.throws(
    () => withProductionEnv({ CARDANO_AGENT_CUSTODY_URL: "https://custody.example.com/cardano" }, () => configFromEnv()),
    /CARDANO_AGENT_CUSTODY_CONFIG_INCOMPLETE/,
  );
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

test("mainnet managed agent resolves an external identity and signs through that exact signer", { timeout: 10_000 }, async () => {
  const agentId = "123e4567-e89b-42d3-a456-426614174000";
  const custodySeed = "22".repeat(32);
  const custodyPublicKey = publicKeyFromSeed(custodySeed);
  const custodyApiKey = "custody-capability-secret-123456789012345";
  const signerApiKey = "signer-capability-secret-1234567890123456";
  const signerRef = `kms:cardano:${agentId}`;
  const custodyCalls = [];

  const custody = createServer(async (request, response) => {
    const body = await readJson(request);
    custodyCalls.push({ path: request.url, body });
    if (request.headers.authorization !== `Bearer ${custodyApiKey}`) return reply(response, 401, { code: "UNAUTHORIZED" });
    if (request.url === "/identity") {
      assert.equal(body.network, "cardano:mainnet");
      assert.equal(body.agentId, agentId);
      return reply(response, 200, { publicKeyHex: custodyPublicKey.toString("hex"), signerRef });
    }
    if (request.url === "/sign") {
      assert.equal(body.network, "cardano:mainnet");
      assert.equal(body.agentId, agentId);
      assert.equal(body.signerRef, signerRef);
      assert.match(body.messageHex, /^[0-9a-f]{64}$/);
      const signature = signHashWithSeed(custodySeed, Buffer.from(body.messageHex, "hex"));
      return reply(response, 200, { signatureHex: signature.toString("hex"), signerRef, publicKeyHex: custodyPublicKey.toString("hex") });
    }
    return reply(response, 404, { code: "NOT_FOUND" });
  });

  let payerAddress = "";
  const blockfrost = createServer((request, response) => {
    const url = new URL(request.url, "http://blockfrost.test");
    if (url.pathname === "/blocks/latest") return reply(response, 200, { slot: 10_000_000 });
    if (url.pathname === "/epochs/latest/parameters") return reply(response, 200, { min_fee_a: 44, min_fee_b: 155381 });
    if (url.pathname.startsWith("/addresses/") && url.pathname.endsWith("/utxos")) {
      assert.equal(decodeURIComponent(url.pathname.slice("/addresses/".length, -"/utxos".length)), payerAddress);
      return reply(response, 200, [{
        tx_hash: "ab".repeat(32),
        output_index: 0,
        amount: [{ unit: "lovelace", quantity: "10000000" }],
      }]);
    }
    return reply(response, 404, { code: "NOT_FOUND" });
  });

  const custodyOrigin = await listen(custody);
  const blockfrostOrigin = await listen(blockfrost);
  const signer = createSignerServer({
    appEnv: "test",
    network: "cardano:mainnet",
    signingMode: "unsigned-only",
    payerAddress: undefined,
    agentMasterKey: undefined,
    agentCustodyUrl: custodyOrigin,
    agentCustodyApiKey: custodyApiKey,
    blockfrostUrl: blockfrostOrigin,
    blockfrostProjectId: "test-project",
    apiKey: signerApiKey,
    port: 0,
    minOutput: 1_000_000n,
    minTokenOutput: 2_000_000n,
    minChange: 2_000_000n,
    maxInputs: 20,
    usdcxAssetId: undefined,
    remoteSignerUrl: undefined,
    remoteSignerApiKey: undefined,
    publicKeyHex: undefined,
    seedHex: undefined,
  });
  const signerOrigin = await listen(signer);

  try {
    const identityResponse = await fetch(`${signerOrigin}/managed-identity`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${signerApiKey}` },
      body: JSON.stringify({ agentId, network: "cardano:mainnet" }),
    });
    assert.equal(identityResponse.status, 200);
    const identity = await identityResponse.json();
    assert.match(identity.accountId, /^addr1/);
    assert.equal(identity.publicKey, custodyPublicKey.toString("hex"));
    assert.equal(identity.signerRef, signerRef);
    payerAddress = identity.accountId;

    const signResponse = await fetch(`${signerOrigin}/managed-agent-sign`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${signerApiKey}` },
      body: JSON.stringify({
        agentId,
        payerAddress,
        network: "cardano:mainnet",
        submissionMode: "server",
        paymentRequirements: {
          x402Version: 2,
          scheme: "exact",
          network: "cardano:mainnet",
          asset: "lovelace",
          amount: "1000000",
          payTo: payerAddress,
          maxTimeoutSeconds: 60,
        },
      }),
    });
    assert.equal(signResponse.status, 200, JSON.stringify(await signResponse.clone().json()));
    const signed = await signResponse.json();
    assert.match(signed.transaction, /^[A-Za-z0-9+/]+=*$/);
    assert.match(signed.transactionId, /^[0-9a-f]{64}$/);
    assert.equal(signed.asset, "lovelace");
    assert.equal(signed.amount, "1000000");
    assert.equal(custodyCalls.filter((call) => call.path === "/identity").length, 2);
    assert.equal(custodyCalls.filter((call) => call.path === "/sign").length, 1);
  } finally {
    await Promise.all([close(signer), close(blockfrost), close(custody)]);
  }
});
