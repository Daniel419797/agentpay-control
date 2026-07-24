#!/usr/bin/env node
import readline from "node:readline";
const baseUrl = process.env.AGENTPAY_BASE_URL ?? "http://localhost:3000";
const agentId = process.env.AGENTPAY_AGENT_ID;
const apiKey = process.env.AGENTPAY_API_KEY;

if (!apiKey) {
  process.stderr.write("AGENTPAY_API_KEY environment variable is required\n");
  process.exit(1);
}

const tools = [
  {
    name: "agentpay_list_resources",
    description: "List purchasable x402-protected resources (market data, files, AI inference, web research)",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "agentpay_purchase_resource",
    description: "Purchase a resource under the agent's published Hedera spending policy. Returns the payment intent with settlement status.",
    inputSchema: {
      type: "object",
      properties: {
        resourceUrl: { type: "string", description: "URL of the resource to purchase (e.g., http://localhost:3200/v1/market-data/ETH)" },
        purpose: { type: "string", description: "Reason for the purchase" },
        maxAmountAtomic: { type: "string", description: "Maximum amount in tinybars to spend" },
      },
      required: ["resourceUrl"],
    },
  },
  {
    name: "agentpay_get_payment_status",
    description: "Check the status of a payment intent by ID",
    inputSchema: {
      type: "object",
      properties: {
        intentId: { type: "string", description: "Payment intent UUID" },
      },
      required: ["intentId"],
    },
  },
  {
    name: "agentpay_list_agents",
    description: "List agents configured for this API key",
    inputSchema: { type: "object", properties: {} },
  },
];

async function request(path: string, init?: RequestInit) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  return response.json();
}

async function handle(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "agentpay-control", version: "0.1.0" },
    };
  }
  if (message.method === "tools/list") {
    return { tools };
  }
  if (message.method === "tools/call") {
    const { name, arguments: args = {} } = message.params;
    switch (name) {
      case "agentpay_list_resources":
        return { content: [{ type: "text", text: JSON.stringify(await request("/api/v1/resources"), null, 2) }] };
      case "agentpay_purchase_resource": {
        if (!agentId) throw new Error("AGENTPAY_AGENT_ID environment variable is required");
        const result = await request(`/api/v1/agents/${agentId}/paid-requests`, {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify(args),
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      case "agentpay_get_payment_status":
        return { content: [{ type: "text", text: JSON.stringify(await request(`/api/v1/payment-intents/${args.intentId}`), null, 2) }] };
      case "agentpay_list_agents":
        return { content: [{ type: "text", text: JSON.stringify(await request("/api/v1/agents"), null, 2) }] };
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }
  return {};
}

const lines = readline.createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  try {
    const message = JSON.parse(line);
    const result = await handle(message);
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
      }) + "\n"
    );
  }
});