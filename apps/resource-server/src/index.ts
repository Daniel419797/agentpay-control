import { createHash, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";

const env = z.object({
  FACILITATOR_URL: z.string().default("http://localhost:8787"),
  PORT: z.coerce.number().default(3200),
  NETWORK: z.string().default("hedera:testnet"),
  PROVIDER_ACCOUNT_ID: z.string(),
  USDC_TOKEN_ID: z.string().optional(),
}).parse(process.env);

const prices = {
  hbar: { type: "NATIVE", amount: "5000000" },
  usdc: { type: "TOKEN", hederaTokenId: env.USDC_TOKEN_ID, amount: "1000000" },
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
      asset: { type: p.type, hederaTokenId: p.type === "TOKEN" ? p.hederaTokenId : undefined },
    }],
    resource: resourceUrl,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
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

app.get("/health", (c) => c.json({ status: "ok", network: env.NETWORK, provider: env.PROVIDER_ACCOUNT_ID }));

app.get("/catalog", (c) => c.json(catalog));

async function handlePaidRequest(c: any, category: string, resourceId: string, data: unknown) {
  const paymentSignature = c.req.header("PAYMENT-SIGNATURE");
  const paymentRequirementsHeader = c.req.header("PAYMENT-REQUIREMENTS");

  if (!paymentSignature) {
    const reqs = paymentRequirements("hbar", c.req.url);
    c.header("PAYMENT-REQUIRED", JSON.stringify(reqs));
    return c.json({
      code: "PAYMENT_REQUIRED",
      message: `Pay ${prices.hbar.amount} tinybars to access this ${category} resource`,
      paymentRequirements: reqs,
    }, 402);
  }

  try {
    const parsed = JSON.parse(paymentRequirementsHeader || "{}");
    const verifyBody = {
      paymentPayload: JSON.parse(paymentSignature),
      paymentRequirements: parsed,
    };
    const verifyRes = await fetch(`${env.FACILITATOR_URL}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(verifyBody),
    });
    const verifyResult = await verifyRes.json() as { isValid: boolean; invalidReason?: string };
    if (!verifyResult.isValid) {
      return c.json({ code: "PAYMENT_INVALID", message: verifyResult.invalidReason || "Payment verification failed" }, 402);
    }

    const settleRes = await fetch(`${env.FACILITATOR_URL}/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(verifyBody),
    });
    const settleResult = await settleRes.json() as { success: boolean; transactionId?: string; errorReason?: string };
    if (!settleResult.success) {
      return c.json({ code: "SETTLEMENT_FAILED", message: settleResult.errorReason || "Settlement failed" }, 422);
    }

    const paymentResponse = {
      x402Version: 2,
      transactionId: settleResult.transactionId,
      network: env.NETWORK,
      settledAt: new Date().toISOString(),
    };
    c.header("PAYMENT-RESPONSE", JSON.stringify(paymentResponse));

    const response = {
      resourceId: generateResourceId(),
      category,
      content: data,
      settled: {
        transactionId: settleResult.transactionId,
        hashscanUrl: `https://hashscan.io/testnet/transaction/${settleResult.transactionId}`,
      },
    };
    return c.json(response);
  } catch (error) {
    return c.json({ code: "FACILITATOR_ERROR", message: error instanceof Error ? error.message : "Facilitator communication failed" }, 502);
  }
}

app.get("/v1/market-data/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  const data = marketData[symbol];
  if (!data) return c.json({ code: "NOT_FOUND", message: `Unknown symbol: ${symbol}` }, 404);
  return handlePaidRequest(c, "MARKET_DATA", `market-data-${symbol}`, {
    symbol,
    ...data,
    timestamp: new Date().toISOString(),
  });
});

app.get("/v1/files/:fileId", async (c) => {
  const fileId = c.req.param("fileId");
  const files: Record<string, { name: string; content: string }> = {
    "report-q2": { name: "Q2-2026-Market-Report.pdf", content: "Executive Summary: Q2 2026 saw continued growth in decentralized finance...\n\nKey findings:\n- Total value locked increased 34% YoY\n- Institutional adoption reached 22% of surveyed funds\n- Regulatory clarity improved in 3 major jurisdictions" },
    "whitepaper": { name: "AgentPay-Whitepaper.pdf", content: "AgentPay: A Policy-Controlled Payment Layer for Autonomous Software Agents\n\nAbstract: This paper describes a novel approach to machine-to-machine payments..." },
  };
  const file = files[fileId];
  if (!file) return c.json({ code: "NOT_FOUND", message: `Unknown file: ${fileId}` }, 404);
  return handlePaidRequest(c, "FILE", `file-${fileId}`, file);
});

app.post("/v1/inference/:model", async (c) => {
  const model = c.req.param("model");
  const body = await c.req.json().catch(() => ({}));
  const prompt = body.prompt || "Explain the benefits of Hedera hashgraph for microtransactions.";
  return handlePaidRequest(c, "AI_INFERENCE", `inference-${model}`, {
    model,
    prompt,
    response: `[Simulated ${model} response] Based on the provided context: ${prompt.slice(0, 100)}...\n\nKey points:\n1. Hedera offers fixed $0.001 fees per transfer\n2. Finality in 3-5 seconds enables real-time micropayments\n3. The x402 standard formalizes HTTP 402 for autonomous commerce\n4. Native HBAR and USDC support provide stable payment options`,
    tokensUsed: prompt.length * 2,
    modelVersion: "3.2-4k",
  });
});

app.post("/v1/research", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const query = body.query || "latest developments in decentralized AI";
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