import { timingSafeEqual } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createHederaApp, parseHederaEnv } from "@agentpay/hedera-facilitator/app";
import { createArcApp, parseArcEnv } from "@agentpay/arc-facilitator/app";
import { createCardanoNativeApp, parseCardanoNativeEnv } from "./cardano-native.js";
import { networkEnv, parseCombinedEnv } from "./env.js";
import { boundedRequestText, paymentNetworkFromJson, targetForNetwork } from "./root-dispatch.js";

const env = parseCombinedEnv();

const hedera = createHederaApp(parseHederaEnv(networkEnv(process.env, env, "hedera")));
const arc = createArcApp(parseArcEnv(networkEnv(process.env, env, "arc")));
const cardanoEnv = parseCardanoNativeEnv(networkEnv(process.env, env, "cardano"));
const cardano = createCardanoNativeApp(cardanoEnv);

const app = new Hono();
const targets = { hedera, arc, cardano };
const networks = { hedera: hedera.network, arc: arc.network, cardano: cardano.network };

function boundedFailure(error: unknown, message: string) {
  const code = error instanceof Error ? error.message : "INVALID_REQUEST";
  const status = code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400;
  return new Response(JSON.stringify({ code, message }), { status, headers: { "content-type": "application/json" } });
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
    const targetName = targetForNetwork(network, networks);
    if (!targetName) return new Response(JSON.stringify({ code: "NETWORK_UNSUPPORTED", message: "The requested payment network is not served by this facilitator." }), { status: 422, headers: { "content-type": "application/json" } });
    return targets[targetName].app.fetch(request);
  } catch (error) {
    return boundedFailure(error, "A bounded request with matching payment requirement and payload networks is required.");
  }
}

async function boundedJson(request: Request, maximum = 128 * 1024) {
  return JSON.parse(await boundedRequestText(request, maximum)) as Record<string, unknown>;
}

async function cardanoSigner(path: string, body: Record<string, unknown>) {
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

app.get("/health", (c) =>
  c.json({
    status: "ok",
    services: {
      hedera: { status: "ok", network: hedera.network, basePath: env.HEDERA_BASE_PATH },
      arc: { status: "ok", network: arc.network, basePath: env.ARC_BASE_PATH },
      cardano: { status: "ok", network: cardano.network, basePath: env.CARDANO_BASE_PATH },
    },
  }),
);

app.get("/supported", async (c) => {
  const responses = await Promise.all(Object.values(targets).map(async (target) => {
    const response = await target.app.fetch(new Request("http://agentpay.internal/supported"));
    if (!response.ok) throw new Error(`SUPPORTED_${target.network}_UNAVAILABLE`);
    const body = await response.json() as { kinds?: unknown[] };
    return Array.isArray(body.kinds) ? body.kinds : [];
  }));
  return c.json({ kinds: responses.flat() });
});

app.post("/verify", (c) => dispatchPayment(c.req.raw));
app.post("/settle", (c) => dispatchPayment(c.req.raw));

// Cardano managed agents use a unique deterministic testnet key/address per
// agent. The generic Cardano child remains unsigned-only and is used for
// independent transaction verification and settlement.
app.post(`${env.CARDANO_BASE_PATH}/managed-identity`, async (c) => {
  if (!secretMatches(cardanoEnv.MANAGED_SIGNING_API_KEY ?? cardanoEnv.FACILITATOR_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
  if (cardano.network !== "cardano:preprod") return c.json({ code: "CARDANO_MANAGED_AGENT_SIGNING_TESTNET_ONLY" }, 403);
  try {
    const body = await boundedJson(c.req.raw);
    if (body.network !== cardano.network || typeof body.agentId !== "string") return c.json({ code: "CARDANO_NETWORK_MISMATCH" }, 422);
    const identity = await cardanoSigner("/managed-identity", { agentId: body.agentId, network: cardano.network });
    return c.json(identity);
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : "CARDANO_MANAGED_IDENTITY_FAILED";
    return c.json({ code }, code.includes("PROVIDER_") || code.includes("SIGNER_") ? 502 : 422);
  }
});

app.post(`${env.CARDANO_BASE_PATH}/managed-agent-sign`, async (c) => {
  if (!secretMatches(cardanoEnv.MANAGED_SIGNING_API_KEY ?? cardanoEnv.FACILITATOR_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
  if (cardano.network !== "cardano:preprod") return c.json({ code: "CARDANO_MANAGED_AGENT_SIGNING_TESTNET_ONLY" }, 403);
  try {
    const body = await boundedJson(c.req.raw);
    const agentId = typeof body.agentId === "string" ? body.agentId : "";
    const payerAccountId = typeof body.payerAccountId === "string" ? body.payerAccountId : "";
    const paymentRequirements = body.paymentRequirements as Record<string, unknown> | undefined;
    if (!agentId || !payerAccountId || !paymentRequirements || paymentRequirements.network !== cardano.network) return c.json({ code: "CARDANO_MANAGED_SIGN_REQUEST_INVALID" }, 422);

    const signed = await cardanoSigner("/managed-agent-sign", {
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

app.post(`${env.CARDANO_BASE_PATH}/managed-sign`, (c) => c.json({ code: "CARDANO_SHARED_MANAGED_SIGNING_DISABLED" }, 410));

// Cardano's current child parser enforces 128 KiB after decoding. Enforce the
// same ceiling while streaming at the public combined-service boundary so the
// namespaced route cannot buffer an unbounded chunked request first.
app.use(`${env.CARDANO_BASE_PATH}/*`, async (c, next) => {
  if (c.req.method !== "POST") return next();
  try {
    await boundedRequestText(c.req.raw.clone(), 128 * 1024);
    return next();
  } catch (error) {
    return boundedFailure(error, "A bounded Cardano facilitator request is required.");
  }
});

app.route(env.HEDERA_BASE_PATH, hedera.app);
app.route(env.ARC_BASE_PATH, arc.app);
app.route(env.CARDANO_BASE_PATH, cardano.app);

serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay combined facilitator listening on ${env.PORT} (root dispatcher + ${env.HEDERA_BASE_PATH}, ${env.ARC_BASE_PATH}, ${env.CARDANO_BASE_PATH})`);
