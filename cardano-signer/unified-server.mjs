import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

const PUBLIC_PORT = integerEnv("PORT", 8791, 1, 65535);
const PREPROD_PORT = integerEnv("CARDANO_PREPROD_INTERNAL_PORT", 8792, 1024, 65535);
const MAINNET_PORT = integerEnv("CARDANO_MAINNET_INTERNAL_PORT", 8793, 1024, 65535);
const MAX_PROXY_BODY_BYTES = 128 * 1024;
const CHILD_START_TIMEOUT_MS = 30_000;
const CHILD_HEALTH_TIMEOUT_MS = 2_000;
const NETWORKS = ["preprod", "mainnet"];

if (new Set([PUBLIC_PORT, PREPROD_PORT, MAINNET_PORT]).size !== 3) throw new Error("CARDANO_SIGNER_PORTS_MUST_BE_DISTINCT");

function integerEnv(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name}_INVALID`);
  return value;
}

function required(name, value = process.env[name]) {
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function exactBase64Url32(name, value) {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value) || Buffer.from(value, "base64url").length !== 32) throw new Error(`${name}_INVALID`);
  return value;
}

function https(name, value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error(`${name}_HTTPS_REQUIRED`);
  return value.replace(/\/$/, "");
}

function networkPrefix(network) {
  return network === "preprod" ? "CARDANO_PREPROD" : "CARDANO_MAINNET";
}

function publicConfig() {
  const appEnv = process.env.APP_ENV ?? "development";
  if (!new Set(["development", "test", "production"]).has(appEnv)) throw new Error("APP_ENV_INVALID");

  const preprodApiKey = required("CARDANO_PREPROD_SIGNER_API_KEY");
  const mainnetApiKey = required("CARDANO_MAINNET_SIGNER_API_KEY");
  if (preprodApiKey.length < 32 || mainnetApiKey.length < 32) throw new Error("CARDANO_SIGNER_API_KEY_TOO_SHORT");
  if (preprodApiKey === mainnetApiKey) throw new Error("CARDANO_NETWORK_SIGNER_API_KEYS_MUST_BE_DISTINCT");

  const preprodMasterKey = exactBase64Url32(
    "CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY",
    process.env.CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY ?? process.env.CARDANO_MANAGED_AGENT_MASTER_KEY,
  );

  const preprodBlockfrostUrl = required("CARDANO_PREPROD_BLOCKFROST_URL", process.env.CARDANO_PREPROD_BLOCKFROST_URL ?? "https://cardano-preprod.blockfrost.io/api/v0");
  const mainnetBlockfrostUrl = required("CARDANO_MAINNET_BLOCKFROST_URL", process.env.CARDANO_MAINNET_BLOCKFROST_URL ?? "https://cardano-mainnet.blockfrost.io/api/v0");
  if (appEnv === "production") {
    https("CARDANO_PREPROD_BLOCKFROST_URL", preprodBlockfrostUrl);
    https("CARDANO_MAINNET_BLOCKFROST_URL", mainnetBlockfrostUrl);
    if (process.env.CARDANO_MAINNET_MANAGED_AGENT_MASTER_KEY) throw new Error("CARDANO_MAINNET_MANAGED_AGENT_MASTER_KEY_PROHIBITED");
    if (process.env.CARDANO_SIGNING_SEED_HEX || process.env.CARDANO_PREPROD_SIGNING_SEED_HEX || process.env.CARDANO_MAINNET_SIGNING_SEED_HEX) {
      throw new Error("CARDANO_RAW_SIGNING_SEED_PROHIBITED_IN_PRODUCTION");
    }
  }

  return {
    appEnv,
    preprodApiKey,
    mainnetApiKey,
    preprodMasterKey,
    preprodBlockfrostUrl,
    mainnetBlockfrostUrl,
  };
}

export function childEnvironmentFor(network, source = process.env) {
  if (!NETWORKS.includes(network)) throw new Error("CARDANO_NETWORK_INVALID");
  const prefix = networkPrefix(network);
  const port = network === "preprod" ? PREPROD_PORT : MAINNET_PORT;
  const apiKey = source[`${prefix}_SIGNER_API_KEY`];
  const blockfrostUrl = source[`${prefix}_BLOCKFROST_URL`] ?? (network === "preprod" ? "https://cardano-preprod.blockfrost.io/api/v0" : "https://cardano-mainnet.blockfrost.io/api/v0");
  const blockfrostProjectId = source[`${prefix}_BLOCKFROST_PROJECT_ID`];
  const usdcxAssetId = source[`${prefix}_USDCX_ASSET_ID`];
  const preprodMasterKey = source.CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY ?? source.CARDANO_MANAGED_AGENT_MASTER_KEY;

  return {
    PATH: source.PATH,
    HOME: source.HOME,
    NODE_ENV: source.NODE_ENV ?? "production",
    APP_ENV: source.APP_ENV ?? "production",
    PORT: String(port),
    CARDANO_NETWORK: network,
    CARDANO_SIGNING_MODE: "unsigned-only",
    CARDANO_BLOCKFROST_URL: blockfrostUrl,
    CARDANO_BLOCKFROST_PROJECT_ID: blockfrostProjectId,
    CARDANO_SIGNER_API_KEY: apiKey,
    ...(usdcxAssetId ? { CARDANO_USDCX_ASSET_ID: usdcxAssetId } : {}),
    ...(network === "preprod" && preprodMasterKey ? { CARDANO_MANAGED_AGENT_MASTER_KEY: preprodMasterKey } : {}),
    CARDANO_MIN_OUTPUT_LOVELACE: source.CARDANO_MIN_OUTPUT_LOVELACE ?? "1000000",
    CARDANO_TOKEN_OUTPUT_LOVELACE: source.CARDANO_TOKEN_OUTPUT_LOVELACE ?? "2000000",
    CARDANO_MIN_CHANGE_LOVELACE: source.CARDANO_MIN_CHANGE_LOVELACE ?? "2000000",
    CARDANO_MAX_INPUTS: source.CARDANO_MAX_INPUTS ?? "20",
  };
}

function validateChildEnvironment(network, env) {
  required(`${networkPrefix(network)}_SIGNER_API_KEY`, env.CARDANO_SIGNER_API_KEY);
  required(`${networkPrefix(network)}_BLOCKFROST_PROJECT_ID`, env.CARDANO_BLOCKFROST_PROJECT_ID);
  const urlName = `${networkPrefix(network)}_BLOCKFROST_URL`;
  if ((process.env.APP_ENV ?? "development") === "production") https(urlName, required(urlName, env.CARDANO_BLOCKFROST_URL));
  if (network === "preprod") exactBase64Url32("CARDANO_PREPROD_MANAGED_AGENT_MASTER_KEY", env.CARDANO_MANAGED_AGENT_MASTER_KEY);
  if (network === "mainnet" && env.CARDANO_MANAGED_AGENT_MASTER_KEY) throw new Error("CARDANO_MAINNET_MANAGED_AGENT_MASTER_KEY_PROHIBITED");
}

function childPort(network) {
  return network === "preprod" ? PREPROD_PORT : MAINNET_PORT;
}

function childOrigin(network) {
  return `http://127.0.0.1:${childPort(network)}`;
}

async function boundedBody(request) {
  const declared = request.headers["content-length"];
  if (declared !== undefined) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("INVALID_CONTENT_LENGTH");
    if (size > MAX_PROXY_BODY_BYTES) throw new Error("REQUEST_BODY_TOO_LARGE");
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_PROXY_BODY_BYTES) throw new Error("REQUEST_BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function writeJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function childHealthy(network) {
  try {
    const response = await fetch(`${childOrigin(network)}/health`, {
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(CHILD_HEALTH_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function waitForChildren() {
  const deadline = Date.now() + CHILD_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const health = await Promise.all(NETWORKS.map(childHealthy));
    if (health.every(Boolean)) return health;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("CARDANO_SIGNER_CHILD_START_TIMEOUT");
}

function parseRoute(url = "/") {
  const parsed = new URL(url, "http://agentpay.internal");
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2 || !NETWORKS.includes(parts[0])) return null;
  const network = parts[0];
  const childPath = `/${parts.slice(1).join("/")}${parsed.search}`;
  return { network, childPath };
}

async function proxyToChild(request, response, route) {
  if (!new Set(["GET", "POST"]).has(request.method ?? "")) return writeJson(response, 405, { code: "METHOD_NOT_ALLOWED" });
  let body;
  try { body = request.method === "POST" ? await boundedBody(request) : undefined; }
  catch (error) { return writeJson(response, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400, { code: error instanceof Error ? error.message : "INVALID_REQUEST" }); }

  const upstream = await fetch(`${childOrigin(route.network)}${route.childPath}`, {
    method: request.method,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(35_000),
    headers: {
      ...(typeof request.headers.authorization === "string" ? { authorization: request.headers.authorization } : {}),
      ...(typeof request.headers["content-type"] === "string" ? { "content-type": request.headers["content-type"] } : {}),
      accept: "application/json",
    },
    ...(body ? { body } : {}),
  });
  const payload = Buffer.from(await upstream.arrayBuffer());
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "content-length": payload.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(payload);
}

const cfg = publicConfig();
const children = new Map();
for (const network of NETWORKS) {
  const env = childEnvironmentFor(network);
  validateChildEnvironment(network, env);
  const child = spawn(process.execPath, [new URL("./server.mjs", import.meta.url).pathname], {
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.once("exit", (code, signal) => {
    console.error(JSON.stringify({ event: "cardano_signer_worker_exit", network, code, signal }));
    if (!shuttingDown) process.exitCode = 1;
    if (!shuttingDown) process.kill(process.pid, "SIGTERM");
  });
  children.set(network, child);
}

let shuttingDown = false;
await waitForChildren();

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && (request.url === "/health" || request.url === "/ready")) {
      const [preprod, mainnet] = await Promise.all([childHealthy("preprod"), childHealthy("mainnet")]);
      const ready = Boolean(preprod && mainnet);
      return writeJson(response, ready ? 200 : 503, {
        status: ready ? "ok" : "degraded",
        service: "agentpay-cardano-signer",
        networks: {
          "cardano:preprod": preprod ?? { status: "unavailable" },
          "cardano:mainnet": mainnet ?? { status: "unavailable" },
        },
        custody: {
          "cardano:preprod": "isolated-per-agent-managed-and-self-custody",
          "cardano:mainnet": "self-custody-unsigned-only",
        },
      });
    }
    const route = parseRoute(request.url);
    if (!route) return writeJson(response, 404, { code: "NETWORK_ROUTE_REQUIRED" });
    return await proxyToChild(request, response, route);
  } catch (error) {
    console.error(JSON.stringify({ event: "cardano_signer_gateway_error", error: error instanceof Error ? error.message.slice(0, 160) : "UNKNOWN" }));
    return writeJson(response, 502, { code: "SIGNER_GATEWAY_UNAVAILABLE" });
  }
});

server.listen(PUBLIC_PORT, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "cardano_signer_gateway_started", port: PUBLIC_PORT, networks: ["cardano:preprod", "cardano:mainnet"], appEnv: cfg.appEnv }));
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ event: "cardano_signer_gateway_shutdown", signal }));
  server.close();
  for (const child of children.values()) child.kill("SIGTERM");
  await Promise.race([
    Promise.all([...children.values()].map((child) => child.exitCode === null ? once(child, "exit") : Promise.resolve())),
    new Promise((resolve) => setTimeout(resolve, 8_000)),
  ]);
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
process.on("SIGINT", () => { void shutdown("SIGINT"); });
