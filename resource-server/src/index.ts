import { createHash, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { boundedJson, sameRequirement } from "./security.js";

const env = z.object({
  FACILITATOR_URL: z.string().default("http://localhost:8787"),
  PORT: z.coerce.number().default(3200),
  NETWORK: z.string().default("hedera:testnet"),
  PROVIDER_ACCOUNT_ID: z.string(),
  USDC_TOKEN_ID: z.string().optional(),
  FACILITATOR_FEE_PAYER_ID: z.string().optional(),
  FACILITATOR_API_KEY: z.string().min(32).optional(),
}).parse(process.env);

type AssetPrice = { type: "NATIVE" | "TOKEN"; amount: string; hederaTokenId?: string };
const requirementSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string().min(1),
  asset: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive().max(3600),
  extra: z.record(z.string(), z.unknown()).default({}),
});
const paymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: requirementSchema,
  payload: z.record(z.string(), z.unknown()),
}).passthrough();

const prices: Record<string, AssetPrice> = {
  hbar: { type: "NATIVE", amount: "5000000" },
  usdc: { type: "TOKEN", amount: "1000000", hederaTokenId: env.USDC_TOKEN_ID },
};

function paymentRequirements(asset: "hbar" | "usdc", resourceUrl: string) {
  const p = prices[asset];
  return {
    x402Version: 2,
    accepts: [{
      scheme: "exact",
      network: env.NETWORK,
      amount: p.amount,
      payTo: env.PROVIDER_ACCOUNT_ID,
      asset: p.type === "TOKEN" ? p.hederaTokenId : "0.0.0",
      maxTimeoutSeconds: 900,
      extra: env.FACILITATOR_FEE_PAYER_ID ? { feePayer: env.FACILITATOR_FEE_PAYER_ID } : {},
    }],
    resource: {
      url: resourceUrl,
      description: "AgentPay protected resource",
      mimeType: "application/json",
      serviceName: "AgentPay Resource Server",
    },
  };
}

const catalog = {
  resources: [
    {
      id: "market-data-eth",
      category: "MARKET_DATA",
      name: "ETH/USD Price",
      description: "Latest Ethereum price with 24h change",
      endpoint: "/v1/market-data/ETH",
      prices: [
        { asset: "HBAR", atomicAmount: prices.hbar.amount, type: prices.hbar.type },
        { asset: "USDC", atomicAmount: prices.usdc.amount, type: prices.usdc.type, hederaTokenId: prices.usdc.hederaTokenId },
      ],
    },
    {
      id: "market-data-btc",
      category: "MARKET_DATA",
      name: "BTC/USD Price",
      description: "Latest Bitcoin price with 24h change",
      endpoint: "/v1/market-data/BTC",
      prices: [
        { asset: "HBAR", atomicAmount: prices.hbar.amount, type: prices.hbar.type },
        { asset: "USDC", atomicAmount: prices.usdc.amount, type: prices.usdc.type, hederaTokenId: prices.usdc.hederaTokenId },
      ],
    },
    {
      id: "files-report",
      category: "FILE",
      name: "Q2 Market Report",
      description: "Confidential Q2 market analysis report (PDF)",
      endpoint: "/v1/files/report-q2",
      prices: [
        { asset: "HBAR", atomicAmount: prices.hbar.amount, type: prices.hbar.type },
      ],
    },
    {
      id: "inference-llama",
      category: "AI_INFERENCE",
      name: "LLaMA 3.2 Inference",
      description: "Run inference on LLaMA 3.2 with custom prompt (max 1000 tokens)",
      endpoint: "/v1/inference/llama-3.2",
      prices: [
        { asset: "HBAR", atomicAmount: prices.hbar.amount, type: prices.hbar.type },
        { asset: "USDC", atomicAmount: prices.usdc.amount, type: prices.usdc.type, hederaTokenId: prices.usdc.hederaTokenId },
      ],
    },
    {
      id: "research-web",
      category: "WEB_RESEARCH",
      name: "Web Research Query",
      description: "Bounded web research with source metadata",
      endpoint: "/v1/research",
      prices: [
        { asset: "HBAR", atomicAmount: prices.hbar.amount, type: prices.hbar.type },
      ],
    },
  ],
};

const marketData: Record<string, { price: string; change: string; high: string; low: string }> = {
  ETH: { price: "3450.25", change: "+2.3%", high: "3480.10", low: "3380.50" },
  BTC: { price: "67500.00", change: "+1.1%", high: "68100.00", low: "66300.00" },
  SOL: { price: "145.80", change: "-0.5%", high: "148.20", low: "143.90" },
  LINK: { price: "14.25", change: "+5.2%", high: "14.50", low: "13.55" },
};

function generateResourceId(): string {
  return createHash("sha256").update(randomUUID()).digest("hex").slice(0, 16);
}

const app = new Hono();

app.get("/health", (c: Context) => c.json({ status: "ok", network: env.NETWORK, provider: env.PROVIDER_ACCOUNT_ID }));

app.get("/catalog", (c: Context) => c.json(catalog));

async function handlePaidRequest(c: Context, category: string, resourceId: string, data: unknown) {
  const paymentSignature = c.req.header("PAYMENT-SIGNATURE");
  const paymentRequirementsHeader = c.req.header("PAYMENT-REQUIREMENTS");
  const canonical = paymentRequirements("hbar", c.req.url);
  const canonicalRequirement = requirementSchema.parse(canonical.accepts[0]);

  if (!paymentSignature) {
    c.header("PAYMENT-REQUIRED", JSON.stringify(canonical));
    return c.json({
      code: "PAYMENT_REQUIRED",
      message: `Pay ${prices.hbar.amount} tinybars to access this ${category} resource`,
      paymentRequirements: canonical,
    }, 402);
  }
  if (paymentSignature.length > 128 * 1024 || !paymentRequirementsHeader || paymentRequirementsHeader.length > 64 * 1024) {
    return c.json({ code: "PAYMENT_PAYLOAD_TOO_LARGE", message: "The payment headers exceed the allowed size." }, 413);
  }

  try {
    const parsed = requirementSchema.parse(JSON.parse(paymentRequirementsHeader));
    const payload = paymentPayloadSchema.parse(JSON.parse(paymentSignature));
    if (!sameRequirement(parsed, canonicalRequirement) || !sameRequirement(payload.accepted, canonicalRequirement)) {
      return c.json({ code: "PAYMENT_REQUIREMENT_MISMATCH", message: "The signed payment does not match this resource price and payee." }, 402);
    }
    const verifyBody = {
      paymentPayload: payload,
      paymentRequirements: canonicalRequirement,
    };
    const idempotencyKey = `resource:${resourceId}:${createHash("sha256").update(paymentSignature).digest("hex")}`;
    const verifyRes = await fetch(`${env.FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, ...(env.FACILITATOR_API_KEY ? { authorization: `Bearer ${env.FACILITATOR_API_KEY}` } : {}) },
      body: JSON.stringify(verifyBody),
      signal: AbortSignal.timeout(15_000),
    });
    const verifyResult = await verifyRes.json().catch(() => ({})) as { isValid?: boolean; invalidReason?: string };
    if (!verifyRes.ok || verifyResult.isValid !== true) {
      return c.json({ code: "PAYMENT_INVALID", message: verifyResult.invalidReason || "Payment verification failed" }, 402);
    }

    const settleRes = await fetch(`${env.FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, ...(env.FACILITATOR_API_KEY ? { authorization: `Bearer ${env.FACILITATOR_API_KEY}` } : {}) },
      body: JSON.stringify(verifyBody),
      signal: AbortSignal.timeout(30_000),
    });
    const settleResult = await settleRes.json().catch(() => ({})) as { success?: boolean; transaction?: string; transactionId?: string; errorReason?: string };
    if (!settleRes.ok || settleResult.success !== true) {
      return c.json({ code: "SETTLEMENT_FAILED", message: settleResult.errorReason || "Settlement failed" }, 422);
    }
    const transactionId = settleResult.transaction ?? settleResult.transactionId;
    if (!transactionId) return c.json({ code: "SETTLEMENT_EVIDENCE_MISSING", message: "Facilitator did not return a transaction ID" }, 502);

    const paymentResponse = {
      x402Version: 2,
      transactionId,
      network: env.NETWORK,
      settledAt: new Date().toISOString(),
    };
    c.header("PAYMENT-RESPONSE", JSON.stringify(paymentResponse));

    const response = {
      resourceId: generateResourceId(),
      category,
      content: data,
      settled: {
        transactionId,
        hashscanUrl: `https://hashscan.io/testnet/transaction/${transactionId}`,
      },
    };
    return c.json(response);
  } catch (error) {
    return c.json({ code: "FACILITATOR_ERROR", message: error instanceof Error ? error.message : "Facilitator communication failed" }, 502);
  }
}

app.get("/v1/market-data/:symbol", async (c: Context) => {
  const symbol = (c.req.param("symbol") ?? "").toUpperCase();
  const data = marketData[symbol];
  if (!data) return c.json({ code: "NOT_FOUND", message: `Unknown symbol: ${symbol}` }, 404);
  return handlePaidRequest(c, "MARKET_DATA", `market-data-${symbol}`, {
    symbol,
    ...data,
    timestamp: new Date().toISOString(),
  });
});

app.get("/v1/files/:fileId", async (c: Context) => {
  const fileId = c.req.param("fileId") ?? "";
  const files: Record<string, { name: string; content: string }> = {
    "report-q2": { name: "Q2-2026-Market-Report.pdf", content: "Executive Summary: Q2 2026 saw continued growth in decentralized finance...\n\nKey findings:\n- Total value locked increased 34% YoY\n- Institutional adoption reached 22% of surveyed funds\n- Regulatory clarity improved in 3 major jurisdictions" },
    "whitepaper": { name: "AgentPay-Whitepaper.pdf", content: "AgentPay: A Policy-Controlled Payment Layer for Autonomous Software Agents\n\nAbstract: This paper describes a novel approach to machine-to-machine payments..." },
  };
  const file = files[fileId];
  if (!file) return c.json({ code: "NOT_FOUND", message: `Unknown file: ${fileId}` }, 404);
  return handlePaidRequest(c, "FILE", `file-${fileId}`, file);
});

app.post("/v1/inference/:model", async (c: Context) => {
  const model = c.req.param("model") ?? "";
  let body: Record<string, unknown>;
  try { body = await boundedJson(c.req.raw) as Record<string, unknown>; }
  catch (error) { return c.json({ code: error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? "REQUEST_BODY_TOO_LARGE" : "INVALID_JSON" }, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400); }
  const prompt = String(body.prompt || "Explain the benefits of Hedera hashgraph for microtransactions.");
  return handlePaidRequest(c, "AI_INFERENCE", `inference-${model}`, {
    model,
    prompt,
    response: `[Simulated ${model} response] Based on the provided context: ${prompt.slice(0, 100)}...\n\nKey points:\n1. Hedera offers fixed $0.001 fees per transfer\n2. Finality in 3-5 seconds enables real-time micropayments\n3. The x402 standard formalizes HTTP 402 for autonomous commerce\n4. Native HBAR and USDC support provide stable payment options`,
    tokensUsed: prompt.length * 2,
    modelVersion: "3.2-4k",
  });
});

app.post("/v1/research", async (c: Context) => {
  let body: Record<string, unknown>;
  try { body = await boundedJson(c.req.raw) as Record<string, unknown>; }
  catch (error) { return c.json({ code: error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? "REQUEST_BODY_TOO_LARGE" : "INVALID_JSON" }, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400); }
  const query = String(body.query || "latest developments in decentralized AI");
  return handlePaidRequest(c, "WEB_RESEARCH", "research-default", {
    query,
    results: [
      { title: "Decentralized AI Computing Market 2026", url: "https://example.com/ai-computing-2026", snippet: "The decentralized AI computing market reached $4.2B in Q2 2026..." },
      { title: "Hedera x402 Standard Gains Traction", url: "https://example.com/x402-adoption", snippet: "The x402 payment standard on Hedera is seeing adoption across AI agent platforms..." },
      { title: "Agent-to-Agent Commerce Protocol", url: "https://example.com/a2a-commerce", snippet: "A new protocol for autonomous agent commerce was announced, built on Hedera..." },
    ],
    fetchedAt: new Date().toISOString(),
    sourceCount: 12,
  });
});

serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay resource server listening on ${env.PORT}`);
