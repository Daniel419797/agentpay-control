import { timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createHederaApp, parseHederaEnv } from "@agentpay/hedera-facilitator/app";
import { createArcApp, parseArcEnv } from "@agentpay/arc-facilitator/app";
import { createCardanoNativeApp, parseCardanoNativeEnv, type CardanoNativeEnv } from "./cardano-native.js";
import { networkEnv, parseCombinedEnv } from "./env.js";
import { boundedRequestText, paymentNetworkFromJson, targetForNetwork, type CombinedNetworkMap, type CombinedTarget } from "./root-dispatch.js";

const env = parseCombinedEnv();

const hederaTestnet = createHederaApp(parseHederaEnv(networkEnv(process.env, env, "hederaTestnet")));
const hederaMainnet = createHederaApp(parseHederaEnv(networkEnv(process.env, env, "hederaMainnet")));
const arcTestnet = createArcApp(parseArcEnv(networkEnv(process.env, env, "arcTestnet")));
const cardanoPreprodEnv = parseCardanoNativeEnv(networkEnv(process.env, env, "cardanoPreprod"));
const cardanoMainnetEnv = parseCardanoNativeEnv(networkEnv(process.env, env, "cardanoMainnet"));
const cardanoPreprod = createCardanoNativeApp(cardanoPreprodEnv);
const cardanoMainnet = createCardanoNativeApp(cardanoMainnetEnv);

const app = new Hono();
const targets = {
  hederaTestnet,
  hederaMainnet,
  arcTestnet,
  cardanoPreprod,
  cardanoMainnet,
} satisfies Record<CombinedTarget, { app: Hono; network: string }>;

const networkTargets: CombinedNetworkMap = {
  "hedera:testnet": "hederaTestnet",
  "hedera:mainnet": "hederaMainnet",
  "eip155:5042002": "arcTestnet",
  "cardano:preprod": "cardanoPreprod",
  "cardano:mainnet": "cardanoMainnet",
};

const paths: Record<CombinedTarget, string> = {
  hederaTestnet: `${env.HEDERA_BASE_PATH}/testnet`,
  hederaMainnet: `${env.HEDERA_BASE_PATH}/mainnet`,
  arcTestnet: `${env.ARC_BASE_PATH}/testnet`,
  cardanoPreprod: `${env.CARDANO_BASE_PATH}/preprod`,
  cardanoMainnet: `${env.CARDANO_BASE_PATH}/mainnet`,
};

function boundedFailure(error: unknown, message: string) {
  const code = error instanceof Error ? error.message : "INVALID_REQUEST";
  const status = code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400;
  return new Response(JSON.stringify({ code, message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

function secretMatches(expected: string | undefined, authorization: string | undefined) {
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(authorization.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

async function requestNetwork(request: Request) {
  const text = await boundedRequestText(request.clone());
  return paymentNetworkFromJson(text);
}

async function dispatchPayment(request: Request) {
  try {
    const network = await requestNetwork(request);
    const targetName = targetForNetwork(network, networkTargets);
    if (!targetName) {
      return new Response(JSON.stringify({ code: "NETWORK_UNSUPPORTED", message: "The requested payment network is not served by this facilitator." }), {
        status: 422,
        headers: { "content-type": "application/json", "cache-control": "no-store" },
      });
    }
    return targets[targetName].app.fetch(request);
  } catch (error) {
    return boundedFailure(error, "A bounded request with matching payment requirement and payload networks is required.");
  }
}

async function boundedJson(request: Request, maximum = 128 * 1024) {
  return JSON.parse(await boundedRequestText(request, maximum)) as Record<string, unknown>;
}

async function cardanoSigner(cardanoEnv: CardanoNativeEnv, path: string, body: Record<string, unknown>) {
  const response = await fetch(`${cardanoEnv.CARDANO_SIGNER_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${cardanoEnv.CARDANO_SIGNER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.code === "string" ? payload.code : `CARDANO_SIGNER_${response.status}`);
  return payload;
}

async function childSupported(target: { app: Hono; network: string }) {
  const response = await target.app.fetch(new Request("http://agentpay.internal/supported"));
  if (!response.ok) throw new Error(`SUPPORTED_${target.network}_UNAVAILABLE`);
  const body = await response.json() as { kinds?: unknown[] };
  return Array.isArray(body.kinds) ? body.kinds : [];
}

async function signerHealth() {
  if (!env.CARDANO_SIGNER_ORIGIN) return null;
  try {
    const response = await fetch(`${env.CARDANO_SIGNER_ORIGIN.replace(/\/$/, "")}/health`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

app.get("/health", (c) => c.json({
  status: "ok",
  service: "agentpay-facilitator",
  networks: Object.fromEntries(Object.entries(networkTargets).map(([network, target]) => [network, { status: "loaded", path: paths[target] }])),
  arcMainnet: { status: "not-public", note: "Arc public mainnet is intentionally not enabled before official launch." },
}));

app.get("/ready", async (c) => {
  try {
    const [supported, signer] = await Promise.all([
      Promise.all(Object.values(targets).map(childSupported)),
      signerHealth(),
    ]);
    if (!signer) return c.json({ status: "not-ready", code: "CARDANO_SIGNER_UNAVAILABLE" }, 503);
    return c.json({ status: "ready", networks: supported.flat(), cardanoSigner: signer });
  } catch (error) {
    return c.json({ status: "not-ready", code: error instanceof Error ? error.message.slice(0, 120) : "READINESS_FAILED" }, 503);
  }
});

app.get("/supported", async (c) => {
  const responses = await Promise.all(Object.values(targets).map(childSupported));
  return c.json({ kinds: responses.flat() });
});

app.post("/verify", (c) => dispatchPayment(c.req.raw));
app.post("/settle", (c) => dispatchPayment(c.req.raw));

function registerCardanoManagedRoutes(basePath: string, cardano: { app: Hono; network: string }, cardanoEnv: CardanoNativeEnv, managedAgentsEnabled: boolean) {
  app.post(`${basePath}/managed-identity`, async (c) => {
    if (!managedAgentsEnabled) return c.json({ code: "CARDANO_MANAGED_AGENT_SIGNING_TESTNET_ONLY" }, 403);
    if (!secretMatches(cardanoEnv.MANAGED_SIGNING_API_KEY ?? cardanoEnv.FACILITATOR_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const body = await boundedJson(c.req.raw);
      if (body.network !== cardano.network || typeof body.agentId !== "string") return c.json({ code: "CARDANO_NETWORK_MISMATCH" }, 422);
      const identity = await cardanoSigner(cardanoEnv, "/managed-identity", { agentId: body.agentId, network: cardano.network });
      return c.json(identity);
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "CARDANO_MANAGED_IDENTITY_FAILED";
      return c.json({ code }, code.includes("PROVIDER_") || code.includes("SIGNER_") ? 502 : 422);
    }
  });

  app.post(`${basePath}/managed-agent-sign`, async (c) => {
    if (!managedAgentsEnabled) return c.json({ code: "CARDANO_MANAGED_AGENT_SIGNING_TESTNET_ONLY" }, 403);
    if (!secretMatches(cardanoEnv.MANAGED_SIGNING_API_KEY ?? cardanoEnv.FACILITATOR_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const body = await boundedJson(c.req.raw);
      const agentId = typeof body.agentId === "string" ? body.agentId : "";
      const payerAccountId = typeof body.payerAccountId === "string" ? body.payerAccountId : "";
      const paymentRequirements = body.paymentRequirements as Record<string, unknown> | undefined;
      if (!agentId || !payerAccountId || !paymentRequirements || paymentRequirements.network !== cardano.network) return c.json({ code: "CARDANO_MANAGED_SIGN_REQUEST_INVALID" }, 422);

      const signed = await cardanoSigner(cardanoEnv, "/managed-agent-sign", {
        agentId,
        payerAddress: payerAccountId,
        network: cardano.network,
        paymentRequirements,
        submissionMode: "server",
      });
      if (typeof signed.transaction !== "string" || typeof signed.nonce !== "string" || typeof signed.transactionId !== "string") throw new Error("CARDANO_SIGNER_RESPONSE_INVALID");

      const paymentPayload = {
        x402Version: 2,
        accepted: paymentRequirements,
        payload: { transaction: signed.transaction, nonce: signed.nonce, payerAddress: payerAccountId, submissionMode: "server" },
      };
      const settlementKey = cardanoEnv.SETTLEMENT_API_KEY ?? cardanoEnv.FACILITATOR_API_KEY;
      if (!settlementKey) throw new Error("CARDANO_SETTLEMENT_CAPABILITY_REQUIRED");
      const verifiedResponse = await cardano.app.fetch(new Request("http://agentpay.internal/verify", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${settlementKey}` },
        body: JSON.stringify({ paymentPayload, paymentRequirements }),
      }));
      const verified = await verifiedResponse.json() as { isValid?: boolean; payer?: string };
      if (!verifiedResponse.ok || !verified.isValid || verified.payer !== payerAccountId) throw new Error("CARDANO_MANAGED_AGENT_TRANSACTION_INVALID");
      return c.json({ paymentPayload, transactionId: signed.transactionId });
    } catch (error) {
      const code = error instanceof Error ? error.message.slice(0, 120) : "CARDANO_MANAGED_SIGNING_FAILED";
      return c.json({ code }, code.includes("PROVIDER_") || code.includes("SIGNER_") ? 502 : 422);
    }
  });

  app.post(`${basePath}/managed-sign`, (c) => c.json({ code: "CARDANO_SHARED_MANAGED_SIGNING_DISABLED" }, 410));
}

registerCardanoManagedRoutes(paths.cardanoPreprod, cardanoPreprod, cardanoPreprodEnv, true);
registerCardanoManagedRoutes(paths.cardanoMainnet, cardanoMainnet, cardanoMainnetEnv, false);

for (const basePath of [paths.cardanoPreprod, paths.cardanoMainnet]) {
  app.use(`${basePath}/*`, async (c, next) => {
    if (c.req.method !== "POST") return next();
    try {
      await boundedRequestText(c.req.raw.clone(), 128 * 1024);
      return next();
    } catch (error) {
      return boundedFailure(error, "A bounded Cardano facilitator request is required.");
    }
  });
}

app.route(paths.hederaTestnet, hederaTestnet.app);
app.route(paths.hederaMainnet, hederaMainnet.app);
app.route(paths.arcTestnet, arcTestnet.app);
app.route(paths.cardanoPreprod, cardanoPreprod.app);
app.route(paths.cardanoMainnet, cardanoMainnet.app);

serve({ fetch: app.fetch, port: env.PORT });
console.log(JSON.stringify({
  event: "agentpay_unified_facilitator_started",
  port: env.PORT,
  networks: Object.keys(networkTargets),
  paths,
}));
