import { createPaidRequest } from "@/domain/payment-service";
import { authorizeAgentRequest, boundedJson, handleApiError, problem } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MCP_PROTOCOL_VERSION = "2025-06-18";

type JsonRpcId = string | number | null;
type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

const tools = [
  {
    name: "agentpay_get_connection_status",
    description: "Check whether this AgentPay payment identity is active and has a published spending policy.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      title: "Check AgentPay connection",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "agentpay_list_resources",
    description: "List AgentPay resources this agent can discover, including public verified resources and resources owned by its organization.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      title: "List purchasable AgentPay resources",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "agentpay_purchase_resource",
    description: "Request purchase of an x402-protected resource under the agent's published AgentPay spending policy. AgentPay may allow, deny, or require human approval before settlement.",
    inputSchema: {
      type: "object",
      properties: {
        resourceUrl: { type: "string", format: "uri", description: "Exact HTTPS resource URL to purchase." },
        purpose: { type: "string", maxLength: 300, description: "Why the agent needs the purchase." },
        maxAmountAtomic: { type: "string", pattern: "^[0-9]+$", description: "Optional maximum spend in the selected asset's atomic denomination." },
        idempotencyKey: { type: "string", minLength: 8, maxLength: 100, description: "Stable unique key for this intended purchase. Reuse the same key when retrying the same purchase." },
      },
      required: ["resourceUrl", "idempotencyKey"],
      additionalProperties: false,
    },
    annotations: {
      title: "Purchase resource with AgentPay",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "agentpay_get_payment_status",
    description: "Read the latest status and settlement evidence for a payment intent created by this agent.",
    inputSchema: {
      type: "object",
      properties: { intentId: { type: "string", format: "uuid", description: "AgentPay payment intent ID." } },
      required: ["intentId"],
      additionalProperties: false,
    },
    annotations: {
      title: "Read AgentPay payment status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
];

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

function textToolResult(value: unknown, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

async function authorize(request: Request, agentId: string, scope: string) {
  return authorizeAgentRequest(request, agentId, scope);
}

async function connectionStatus(agentId: string) {
  const agent = await db.agent.findUnique({
    where: { id: agentId },
    include: {
      organization: { select: { status: true, killSwitchEnabled: true } },
      defaultAsset: { select: { symbol: true, decimals: true, network: true } },
      accounts: { orderBy: { createdAt: "asc" }, take: 1, select: { accountId: true, network: true, custodyType: true, signingMode: true, status: true } },
      effectivePolicy: { include: { asset: { select: { symbol: true, decimals: true } } } },
    },
  });
  if (!agent) return null;
  const account = agent.accounts[0] ?? null;
  const policy = agent.effectivePolicy;
  const blockingReasons: string[] = [];
  if (agent.organization.status !== "ACTIVE") blockingReasons.push("ORGANIZATION_NOT_ACTIVE");
  if (agent.organization.killSwitchEnabled) blockingReasons.push("ORGANIZATION_KILL_SWITCH_ENABLED");
  if (agent.status !== "ACTIVE") blockingReasons.push("AGENT_NOT_ACTIVE");
  if (!account || account.status !== "ACTIVE") blockingReasons.push("PAYMENT_ACCOUNT_NOT_ACTIVE");
  if (!policy || policy.status !== "PUBLISHED") blockingReasons.push("POLICY_NOT_PUBLISHED");
  return {
    ready: blockingReasons.length === 0,
    blockingReasons,
    agent: { id: agent.id, name: agent.name, status: agent.status, network: agent.network, defaultAsset: agent.defaultAsset },
    account,
    policy: policy ? {
      id: policy.id,
      version: policy.version,
      asset: policy.asset,
      perTransactionLimitAtomic: policy.perTransactionLimitAtomic.toString(),
      hourlyLimitAtomic: policy.hourlyLimitAtomic?.toString() ?? null,
      dailyLimitAtomic: policy.dailyLimitAtomic.toString(),
      monthlyLimitAtomic: policy.monthlyLimitAtomic?.toString() ?? null,
      overLimitAction: policy.overLimitAction,
      merchantMode: policy.merchantMode,
      allowedHosts: policy.allowedHosts,
      deniedHosts: policy.deniedHosts,
      allowedMerchantCategories: policy.allowedMerchantCategories,
      maxTransactionsPerHour: policy.maxTransactionsPerHour,
      cooldownSeconds: policy.cooldownSeconds,
    } : null,
  };
}

async function listResources(agentId: string) {
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { organizationId: true } });
  if (!agent) return null;
  const rows = await db.resourceListing.findMany({
    where: {
      OR: [
        { public: true, status: "ACTIVE", provider: { status: "ACTIVE", verificationStatus: "VERIFIED" } },
        { status: "ACTIVE", provider: { organizationId: agent.organizationId, status: "ACTIVE" } },
      ],
    },
    include: {
      provider: { select: { id: true, name: true, publicSlug: true, websiteUrl: true, verifiedAt: true } },
      prices: { include: { asset: true } },
    },
    orderBy: { name: "asc" },
    take: 100,
  });
  return rows.map((resource) => ({
    ...resource,
    prices: resource.prices.map((price) => ({ ...price, atomicAmount: price.atomicAmount.toString() })),
  }));
}

async function paymentStatus(agentId: string, intentId: string) {
  const row = await db.paymentIntent.findFirst({
    where: { id: intentId, agentId },
    include: {
      quote: { include: { asset: true } },
      approval: true,
      fulfillment: true,
      attempts: { include: { settlement: true }, orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    resourceUrl: row.resourceUrl,
    merchantHost: row.merchantHost,
    purpose: row.purpose,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    quote: row.quote ? { ...row.quote, amountAtomic: row.quote.amountAtomic.toString() } : null,
    approval: row.approval,
    fulfillment: row.fulfillment,
    attempts: row.attempts.map((attempt) => ({
      ...attempt,
      settlement: attempt.settlement ? { ...attempt.settlement, amountAtomic: attempt.settlement.amountAtomic.toString() } : null,
    })),
  };
}

async function handleMessage(request: Request, agentId: string, message: JsonRpcMessage) {
  const id = message.id ?? null;
  if (message.jsonrpc !== "2.0" || !message.method) return jsonRpcError(id, -32600, "Invalid JSON-RPC request.");

  if (message.method === "initialize") {
    if (!(await authorize(request, agentId, "resources:read"))) return jsonRpcError(id, -32001, "Unauthorized AgentPay connection.");
    return jsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "agentpay-control", version: "0.2.0" },
      instructions: "Use AgentPay tools for paid resources. Every purchase is enforced by the server-side AgentPay policy; never assume a payment is allowed until the returned status confirms it.",
    });
  }
  if (message.method === "notifications/initialized") return null;
  if (message.method === "ping") {
    if (!(await authorize(request, agentId, "resources:read"))) return jsonRpcError(id, -32001, "Unauthorized AgentPay connection.");
    return jsonRpcResult(id, {});
  }

  if (message.method === "tools/list") {
    if (!(await authorize(request, agentId, "resources:read"))) return jsonRpcError(id, -32001, "Unauthorized AgentPay connection.");
    return jsonRpcResult(id, { tools });
  }

  if (message.method !== "tools/call") return jsonRpcError(id, -32601, `Method not found: ${message.method}`);
  const params = message.params ?? {};
  const name = typeof params.name === "string" ? params.name : "";
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments as Record<string, unknown> : {};

  try {
    if (name === "agentpay_get_connection_status") {
      if (!(await authorize(request, agentId, "resources:read"))) return jsonRpcError(id, -32001, "Unauthorized AgentPay connection.");
      const status = await connectionStatus(agentId);
      return jsonRpcResult(id, textToolResult(status ?? { code: "AGENT_NOT_FOUND" }, !status));
    }

    if (name === "agentpay_list_resources") {
      if (!(await authorize(request, agentId, "resources:read"))) return jsonRpcError(id, -32001, "Unauthorized AgentPay connection.");
      const resources = await listResources(agentId);
      return jsonRpcResult(id, textToolResult(resources ?? { code: "AGENT_NOT_FOUND" }, !resources));
    }

    if (name === "agentpay_purchase_resource") {
      if (!(await authorize(request, agentId, "payments:create"))) return jsonRpcError(id, -32001, "Unauthorized AgentPay connection.");
      const resourceUrl = typeof args.resourceUrl === "string" ? args.resourceUrl : "";
      const idempotencyKey = typeof args.idempotencyKey === "string" ? args.idempotencyKey : "";
      const purpose = typeof args.purpose === "string" ? args.purpose : undefined;
      const maxAmountAtomic = typeof args.maxAmountAtomic === "string" ? args.maxAmountAtomic : undefined;
      if (!resourceUrl || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
        return jsonRpcResult(id, textToolResult({ code: "INVALID_ARGUMENTS", detail: "resourceUrl and an idempotencyKey between 8 and 100 characters are required." }, true));
      }
      const result = await createPaidRequest(agentId, idempotencyKey, { resourceUrl, purpose, maxAmountAtomic });
      return jsonRpcResult(id, textToolResult(result));
    }

    if (name === "agentpay_get_payment_status") {
      if (!(await authorize(request, agentId, "payments:read"))) return jsonRpcError(id, -32001, "Unauthorized AgentPay connection.");
      const intentId = typeof args.intentId === "string" ? args.intentId : "";
      if (!intentId) return jsonRpcResult(id, textToolResult({ code: "INVALID_ARGUMENTS", detail: "intentId is required." }, true));
      const status = await paymentStatus(agentId, intentId);
      return jsonRpcResult(id, textToolResult(status ?? { code: "PAYMENT_INTENT_NOT_FOUND" }, !status));
    }

    return jsonRpcResult(id, textToolResult({ code: "UNKNOWN_TOOL", detail: `Unknown AgentPay tool: ${name}` }, true));
  } catch (error) {
    const code = error instanceof Error ? error.message : "AGENTPAY_TOOL_FAILED";
    return jsonRpcResult(id, textToolResult({ code, detail: "AgentPay rejected or could not complete the requested tool action." }, true));
  }
}

function responseJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
      return problem(403, "MCP_ORIGIN_REJECTED", "Cross-origin browser access to the AgentPay MCP endpoint is not allowed.");
    }
    const { agentId } = await params;
    const payload = await boundedJson(request, 128 * 1024);
    if (Array.isArray(payload)) {
      if (payload.length === 0 || payload.length > 50) return responseJson(jsonRpcError(null, -32600, "Invalid JSON-RPC batch."), 400);
      const results = (await Promise.all(payload.map((message) => handleMessage(request, agentId, message as JsonRpcMessage)))).filter((value) => value !== null);
      return results.length ? responseJson(results) : new Response(null, { status: 202, headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION } });
    }
    if (!payload || typeof payload !== "object") return responseJson(jsonRpcError(null, -32600, "Invalid JSON-RPC request."), 400);
    const result = await handleMessage(request, agentId, payload as JsonRpcMessage);
    return result === null ? new Response(null, { status: 202, headers: { "mcp-protocol-version": MCP_PROTOCOL_VERSION } }) : responseJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
}

export async function DELETE() {
  return new Response(null, { status: 405, headers: { allow: "POST", "cache-control": "no-store" } });
}
