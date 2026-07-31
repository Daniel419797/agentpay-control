import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";
import { createHederaApp, parseHederaEnv } from "@agentpay/hedera-facilitator/app";
import { createArcApp, parseArcEnv } from "@agentpay/arc-facilitator/app";

const envSchema = z.object({
  PORT: z.coerce.number().default(8787),
  HEDERA_BASE_PATH: z.string().default("/hedera"),
  ARC_BASE_PATH: z.string().default("/arc"),
});

const env = envSchema.parse(process.env);

const hedera = createHederaApp(parseHederaEnv());
const arc = createArcApp(parseArcEnv());

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
