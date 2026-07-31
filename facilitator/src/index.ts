import { serve } from "@hono/node-server";
import { createHederaApp, parseHederaEnv } from "./app.js";

const env = parseHederaEnv();
const { app } = createHederaApp(env);
serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay facilitator listening on ${env.PORT}`);
