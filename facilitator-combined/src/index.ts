import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createHederaApp, parseHederaEnv } from "@agentpay/hedera-facilitator/app";
import { createArcApp, parseArcEnv } from "@agentpay/arc-facilitator/app";
import { networkEnv, parseCombinedEnv } from "./env.js";

const env = parseCombinedEnv();

const hedera = createHederaApp(parseHederaEnv(networkEnv(process.env, env, "hedera")));
const arc = createArcApp(parseArcEnv(networkEnv(process.env, env, "arc")));

const app = new Hono();

app.get("/health", (c) =>
  c.json({
    status: "ok",
    services: {
      hedera: { status: "ok", network: hedera.network, basePath: env.HEDERA_BASE_PATH },
      arc: { status: "ok", network: arc.network, basePath: env.ARC_BASE_PATH },
    },
  }),
);

app.route(env.HEDERA_BASE_PATH, hedera.app);
app.route(env.ARC_BASE_PATH, arc.app);

serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay combined facilitator listening on ${env.PORT} (${env.HEDERA_BASE_PATH}, ${env.ARC_BASE_PATH})`);
