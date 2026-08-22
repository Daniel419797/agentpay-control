import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const PORT = 19091;
const PREPROD_PORT = 19092;
const MAINNET_PORT = 19093;
const PREPROD_KEY = "p".repeat(40);
const MAINNET_KEY = "m".repeat(40);
const MASTER = Buffer.alloc(32, 9).toString("base64url");
const AGENT_ID = "123e4567-e89b-42d3-a456-426614174000";

async function waitForHealth(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

test("unified signer keeps Preprod and Mainnet workers isolated", { timeout: 30_000 }, async () => {
  const child = spawn(process.execPath, [new URL("./unified-server.mjs", import.meta.url).pathname], {
    env: {
      ...process.env,
      APP_ENV: "production",
      NODE_ENV: "production",
      PORT: String(PORT),
      CARDANO_PREPROD_INTERNAL_PORT: String(PREPROD_PORT),
      CARDANO_MAINNET_INTERNAL_PORT: String(MAINNET_PORT),
      CARDANO_PREPROD_SIGNER_API_KEY: PREPROD_KEY,
      CARDANO_MAINNET_SIGNER_API_KEY: MAINNET_KEY,
      CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY: MASTER,
      CARDANO_PREPROD_BLOCKFROST_URL: "https://cardano-preprod.blockfrost.io/api/v0",
      CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: "preprod-project-id-for-test-only",
      CARDANO_MAINNET_BLOCKFROST_URL: "https://cardano-mainnet.blockfrost.io/api/v0",
      CARDANO_MAINNET_BLOCKFROST_PROJECT_ID: "mainnet-project-id-for-test-only",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  try {
    const health = await waitForHealth(`http://127.0.0.1:${PORT}/health`);
    const healthBody = await health.json();
    assert.equal(healthBody.status, "ok");
    assert.equal(healthBody.networks["cardano:preprod"].network, "cardano:preprod");
    assert.equal(healthBody.networks["cardano:mainnet"].network, "cardano:mainnet");
    assert.equal(healthBody.custody["cardano:mainnet"], "self-custody-unsigned-only");

    const preprodIdentity = await fetch(`http://127.0.0.1:${PORT}/preprod/managed-identity`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${PREPROD_KEY}` },
      body: JSON.stringify({ agentId: AGENT_ID, network: "cardano:preprod" }),
    });
    assert.equal(preprodIdentity.status, 200);
    const identity = await preprodIdentity.json();
    assert.match(identity.accountId, /^addr_test1/);
    assert.equal(identity.signerRef, `agent:${AGENT_ID}`);

    const mainnetManaged = await fetch(`http://127.0.0.1:${PORT}/mainnet/managed-identity`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${MAINNET_KEY}` },
      body: JSON.stringify({ agentId: AGENT_ID, network: "cardano:mainnet" }),
    });
    assert.equal(mainnetManaged.status, 502);
    assert.equal((await mainnetManaged.json()).code, "CARDANO_AGENT_CUSTODY_REQUIRED");

    const crossedCapability = await fetch(`http://127.0.0.1:${PORT}/mainnet/unsigned`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${PREPROD_KEY}` },
      body: JSON.stringify({}),
    });
    assert.equal(crossedCapability.status, 401);
  } finally {
    await stop(child);
  }

  assert.equal(child.signalCode === "SIGTERM" || child.exitCode === 0, true, stderr);
});