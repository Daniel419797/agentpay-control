import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createHederaApp, parseHederaEnv } from "@agentpay/hedera-facilitator/app";
import { createArcApp, parseArcEnv } from "@agentpay/arc-facilitator/app";
import { createCardanoNativeApp, parseCardanoNativeEnv } from "./cardano-native.js";
import { networkEnv, parseCombinedEnv } from "./env.js";

const env = parseCombinedEnv();

const hedera = createHederaApp(parseHederaEnv(networkEnv(process.env, env, "hedera")));
const arc = createArcApp(parseArcEnv(networkEnv(process.env, env, "arc")));
const cardano = createCardanoNativeApp(parseCardanoNativeEnv(networkEnv(process.env, env, "cardano")));

const app = new Hono();

const targets = {
  hedera,
  arc,
  cardano,
};

function targetForNetwork(network: string | undefined) {
  if (network === hedera.network) return hedera;
  if (network === arc.network) return arc;
  if (network === cardano.network) return cardano;
  return null;
}

async function requestNetwork(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 256 * 1024) throw new Error("REQUEST_BODY_TOO_LARGE");
  const text = await request.clone().text();
  if (Buffer.byteLength(text, "utf8") > 256 * 1024) throw new Error("REQUEST_BODY_TOO_LARGE");
  const body = JSON.parse(text) as { paymentRequirements?: { network?: unknown }; paymentPayload?: { accepted?: { network?: unknown } } };
  const requirementNetwork = typeof body.paymentRequirements?.network === "string" ? body.paymentRequirements.network : undefined;
  const acceptedNetwork = typeof body.paymentPayload?.accepted?.network === "string" ? body.paymentPayload.accepted.network : undefined;
  if (!requirementNetwork || !acceptedNetwork || requirementNetwork !== acceptedNetwork) throw new Error("NETWORK_BINDING_REQUIRED");
  return requirementNetwork;
}

async function dispatchPayment(request: Request) {
  try {
    const network = await requestNetwork(request);
    const target = targetForNetwork(network);
    if (!target) return new Response(JSON.stringify({ code: "NETWORK_UNSUPPORTED", message: "The requested payment network is not served by this facilitator." }), { status: 422, headers: { "content-type": "application/json" } });
    return target.app.fetch(request);
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_REQUEST";
    const status = code === "REQUEST_BODY_TOO_LARGE" ? 413 : 400;
    return new Response(JSON.stringify({ code, message: "A bounded request with matching payment requirement and payload networks is required." }), { status, headers: { "content-type": "application/json" } });
  }
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

app.route(env.HEDERA_BASE_PATH, hedera.app);
app.route(env.ARC_BASE_PATH, arc.app);
app.route(env.CARDANO_BASE_PATH, cardano.app);

serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay combined facilitator listening on ${env.PORT} (root dispatcher + ${env.HEDERA_BASE_PATH}, ${env.ARC_BASE_PATH}, ${env.CARDANO_BASE_PATH})`);
