#!/usr/bin/env node
import readline from "node:readline";

const baseUrl = (process.env.AGENTPAY_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const agentId = process.env.AGENTPAY_AGENT_ID;
const apiKey = process.env.AGENTPAY_API_KEY;

if (!agentId) {
  process.stderr.write("AGENTPAY_AGENT_ID environment variable is required\n");
  process.exit(1);
}
if (!apiKey) {
  process.stderr.write("AGENTPAY_API_KEY environment variable is required\n");
  process.exit(1);
}

const endpoint = `${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/mcp`;

function rpcError(id, message, data) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code: -32000, message, ...(data === undefined ? {} : { data }) },
  };
}

async function forward(message) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 202 || response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) {
    let detail = `AgentPay MCP endpoint returned HTTP ${response.status}.`;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.detail ?? parsed.error?.message ?? detail;
    } catch {
      // Never echo arbitrary upstream HTML or proxy pages into the MCP client.
    }
    return rpcError(message?.id, detail);
  }

  try {
    return JSON.parse(text);
  } catch {
    return rpcError(message?.id, "AgentPay MCP endpoint returned an invalid JSON response.");
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let chain = Promise.resolve();

lines.on("line", (line) => {
  if (!line.trim()) return;
  chain = chain.then(async () => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      process.stdout.write(JSON.stringify(rpcError(null, "Invalid JSON-RPC input.")) + "\n");
      return;
    }

    try {
      const result = await forward(message);
      if (result !== null) process.stdout.write(JSON.stringify(result) + "\n");
    } catch (error) {
      const messageText = error instanceof Error && error.name === "TimeoutError"
        ? "AgentPay MCP endpoint timed out."
        : "AgentPay MCP endpoint is unavailable.";
      if (message?.id !== undefined) process.stdout.write(JSON.stringify(rpcError(message.id, messageText)) + "\n");
    }
  });
});
