import { serve } from "@hono/node-server";
import { createArcApp, parseArcEnv } from "./app.js";

const env = parseArcEnv();
const { app } = createArcApp(env);
serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay Arc facilitator listening on ${env.PORT}`);
