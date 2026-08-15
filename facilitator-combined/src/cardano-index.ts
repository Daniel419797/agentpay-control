import { serve } from "@hono/node-server";
import { createCardanoNativeApp, parseCardanoNativeEnv } from "./cardano-native.js";

const env = parseCardanoNativeEnv();
const { app, network } = createCardanoNativeApp(env);
const port = Number(process.env.PORT ?? 8789);

serve({ fetch: app.fetch, port });
console.log(`AgentPay Cardano facilitator listening on ${port} (${network})`);
