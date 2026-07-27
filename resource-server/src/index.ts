import { createHash, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import { boundedJson, sameRequirement } from "./security.js";

const env = z.object({
  FACILITATOR_URL: z.string().default("http://localhost:8787"),
  HEDERA_MAINNET_FACILITATOR_URL: z.string().default("http://localhost:8787"),
  ARC_FACILITATOR_URL: z.string().default("http://localhost:8788"),
  PORT: z.coerce.number().default(3200),
  NETWORK: z.string().default("hedera:testnet"),
  PROVIDER_ACCOUNT_ID: z.string(),
  HEDERA_MAINNET_PROVIDER_ACCOUNT_ID: z.string().optional(),
  USDC_TOKEN_ID: z.string().optional(),
  HEDERA_MAINNET_USDC_TOKEN_ID: z.string().optional(),
  FACILITATOR_FEE_PAYER_ID: z.string().optional(),
  FACILITATOR_API_KEY: z.string().min(32).optional(),
  ARC_PROVIDER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ARC_USDC_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
}).parse(process.env);

const ARCTestnet = {
  caip2: "eip155:5042002",
  usdcAddress: env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
  providerAddress: env.ARC_PROVIDER_ADDRESS ?? "",
  explorerUrl: "https://testnet.arcscan.app/tx",
  facilitatorUrl: env.ARC_FACILITATOR_URL,
};

const HederaTestnet = {
  caip2: "hedera:testnet",
  usdcTokenId: env.USDC_TOKEN_ID,
  providerAccountId: env.PROVIDER_ACCOUNT_ID,
  explorerUrl: "https://hashscan.io/testnet/transaction",
  facilitatorUrl: env.FACILITATOR_URL,
};

const HederaMainnet = {
  caip2: "hedera:mainnet",
  usdcTokenId: env.HEDERA_MAINNET_USDC_TOKEN_ID,
  providerAccountId: env.HEDERA_MAINNET_PROVIDER_ACCOUNT_ID ?? env.PROVIDER_ACCOUNT_ID,
  explorerUrl: "https://hashscan.io/mainnet/transaction",
  facilitatorUrl: env.HEDERA_MAINNET_FACILITATOR_URL,
};

type NetworkConfig = { caip2: string; facilitatorUrl: string; explorerUrl: string };
const networks: Record<string, NetworkConfig> = {
  [HederaTestnet.caip2]: HederaTestnet,
  [HederaMainnet.caip2]: HederaMainnet,
  [ARCTestnet.caip2]: ARCTestnet,
};

type AssetPrice = { type: "NATIVE" | "TOKEN"; amount: string; assetId: string; decimals: number; symbol: string };
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

const arcPrices: Record<string, AssetPrice> = {
  usdc: { type: "TOKEN", amount: "1000000", assetId: ARCTestnet.usdcAddress, decimals: 6, symbol: "USDC" },
};
const hederaPrices: Record<string, AssetPrice> = {
  hbar: { type: "NATIVE", amount: "5000000", assetId: "0.0.0", decimals: 8, symbol: "HBAR" },
  usdc: { type: "TOKEN", amount: "1000000", assetId: HederaTestnet.usdcTokenId ?? "", decimals: 6, symbol: "USDC" },
};

function getNetworkConfig(network: string): NetworkConfig | undefined {
  return networks[network];
}

function paymentRequirements(network: string, resourceUrl: string) {
  const isArc = network === ARCTestnet.caip2;
  const isHederaMainnet = network === HederaMainnet.caip2;
  const prices = isArc ? arcPrices : isHederaMainnet ? hederaPrices : hederaPrices;
  const payTo = isArc
    ? ARCTestnet.providerAddress
    : isHederaMainnet
      ? HederaMainnet.providerAccountId
      : HederaTestnet.providerAccountId;
  const accepts = Object.entries(prices).map(([key, p]) => ({
    scheme: "exact" as const,
    network,
    amount: p.amount,
    payTo,
    asset: p.assetId,
    maxTimeoutSeconds: 900,
    extra: isArc ? { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" } : { feePayer: env.FACILITATOR_FEE_PAYER_ID },
  }));
  return {
    x402Version: 2,
    accepts,
    resource: {
      url: resourceUrl,
      description: "AgentPay protected resource",
      mimeType: "application/json",
      serviceName: "AgentPay Resource Server",
    },
  };
}

const sharedPrices = [
  { asset: "HBAR", atomicAmount: hederaPrices.hbar.amount, network: HederaTestnet.caip2 },
  { asset: "USDC", atomicAmount: hederaPrices.usdc.amount, network: HederaTestnet.caip2 },
  { asset: "HBAR", atomicAmount: hederaPrices.hbar.amount, network: HederaMainnet.caip2 },
  { asset: "USDC", atomicAmount: hederaPrices.usdc.amount, network: HederaMainnet.caip2 },
  { asset: "USDC", atomicAmount: arcPrices.usdc.amount, network: ARCTestnet.caip2 },
];

const catalog = {
  resources: [
    {
      id: "market-data-eth", category: "MARKET_DATA", name: "ETH/USD Price",
      description: "Latest Ethereum price with 24h change", endpoint: "/v1/market-data/ETH",
      prices: sharedPrices,
    },
    {
      id: "market-data-btc", category: "MARKET_DATA", name: "BTC/USD Price",
      description: "Latest Bitcoin price with 24h change", endpoint: "/v1/market-data/BTC",
      prices: sharedPrices,
    },
    {
      id: "files-report", category: "FILE", name: "Q2 Market Report",
      description: "Confidential Q2 market analysis report (PDF)", endpoint: "/v1/files/report-q2",
      prices: [sharedPrices[0], sharedPrices[2]],
    },
    {
      id: "inference-llama", category: "AI_INFERENCE", name: "LLaMA 3.2 Inference",
      description: "Run inference on LLaMA 3.2 with custom prompt (max 1000 tokens)", endpoint: "/v1/inference/llama-3.2",
      prices: sharedPrices,
    },
    {
      id: "research-web", category: "WEB_RESEARCH", name: "Web Research Query",
      description: "Bounded web research with source metadata", endpoint: "/v1/research",
      prices: [sharedPrices[0], sharedPrices[2]],
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

function getFacilitatorForNetwork(network: string): string | undefined {
  if (network === ARCTestnet.caip2) return ARCTestnet.facilitatorUrl;
  if (network === HederaTestnet.caip2) return HederaTestnet.facilitatorUrl;
  if (network === HederaMainnet.caip2) return HederaMainnet.facilitatorUrl;
  return undefined;
}

const app = new Hono();

app.get("/health", (c: Context) => c.json({ status: "ok", networks: Object.keys(networks), provider: { testnet: env.PROVIDER_ACCOUNT_ID, mainnet: env.HEDERA_MAINNET_PROVIDER_ACCOUNT_ID ?? env.PROVIDER_ACCOUNT_ID } }));

app.get("/catalog", (c: Context) => c.json(catalog));

async function handlePaidRequest(c: Context, category: string, resourceId: string, data: unknown) {
  const paymentSignature = c.req.header("PAYMENT-SIGNATURE");
  const paymentRequirementsHeader = c.req.header("PAYMENT-REQUIREMENTS");
  const acceptNetwork = c.req.header("ACCEPT-NETWORK") ?? HederaTestnet.caip2;

  const canonical = paymentRequirements(acceptNetwork, c.req.url);
  const canonicalRequirement = requirementSchema.parse(canonical.accepts[0]);

  if (!paymentSignature) {
    c.header("PAYMENT-REQUIRED", JSON.stringify(canonical));
    const firstPrice = acceptNetwork === ARCTestnet.caip2 ? arcPrices.usdc : hederaPrices.hbar;
    return c.json({
      code: "PAYMENT_REQUIRED",
      message: `Pay ${firstPrice.amount} ${firstPrice.symbol} on ${acceptNetwork} to access this ${category} resource`,
      paymentRequirements: canonical,
    }, 402);
  }
  if (paymentSignature.length > 128 * 1024 || !paymentRequirementsHeader || paymentRequirementsHeader.length > 64 * 1024) {
    return c.json({ code: "PAYMENT_PAYLOAD_TOO_LARGE", message: "The payment headers exceed the allowed size." }, 413);
  }

  try {
    const parsed = requirementSchema.parse(JSON.parse(paymentRequirementsHeader));
    const payload = paymentPayloadSchema.parse(JSON.parse(paymentSignature));
    const matchingCanonical = canonical.accepts.find((req) => sameRequirement(parsed, req));
    if (!matchingCanonical || !sameRequirement(payload.accepted, matchingCanonical)) {
      return c.json({ code: "PAYMENT_REQUIREMENT_MISMATCH", message: "The signed payment does not match this resource price and payee." }, 402);
    }

    const verifyBody = { paymentPayload: payload, paymentRequirements: matchingCanonical };
    const idempotencyKey = `resource:${resourceId}:${createHash("sha256").update(paymentSignature).digest("hex")}`;
    const facilitatorUrl = getFacilitatorForNetwork(parsed.network);
    if (!facilitatorUrl) return c.json({ code: "NETWORK_UNSUPPORTED", message: `Network ${parsed.network} is not supported` }, 422);

    const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, ...(env.FACILITATOR_API_KEY ? { authorization: `Bearer ${env.FACILITATOR_API_KEY}` } : {}) },
      body: JSON.stringify(verifyBody),
      signal: AbortSignal.timeout(15_000),
    });
    const verifyResult = await verifyRes.json().catch(() => ({})) as { isValid?: boolean; invalidReason?: string };
    if (!verifyRes.ok || verifyResult.isValid !== true) {
      return c.json({ code: "PAYMENT_INVALID", message: verifyResult.invalidReason || "Payment verification failed" }, 402);
    }

    const settleRes = await fetch(`${facilitatorUrl}/settle`, {
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
      network: parsed.network,
      settledAt: new Date().toISOString(),
    };
    c.header("PAYMENT-RESPONSE", JSON.stringify(paymentResponse));

    const networkConfig = getNetworkConfig(parsed.network);
    const explorerUrl = networkConfig ? `${networkConfig.explorerUrl}/${transactionId}` : `https://hashscan.io/testnet/transaction/${transactionId}`;

    const response = {
      resourceId: generateResourceId(),
      category,
      content: data,
      settled: { transactionId, explorerUrl },
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
  return handlePaidRequest(c, "MARKET_DATA", `market-data-${symbol}`, { symbol, ...data, timestamp: new Date().toISOString() });
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
  const prompt = String(body.prompt || "Explain the benefits of micropayments for autonomous agents.");
  return handlePaidRequest(c, "AI_INFERENCE", `inference-${model}`, {
    model, prompt,
    response: `[Simulated ${model} response] Based on the provided context: ${prompt.slice(0, 100)}...\n\nKey points:\n1. Arc offers sub-second deterministic finality\n2. USDC is the native gas token, no separate ETH needed\n3. The x402 standard with EIP-3009 enables gasless payments\n4. Cross-chain USDC via CCTP maintains native fungibility`,
    tokensUsed: prompt.length * 2, modelVersion: "3.2-4k",
  });
});

app.post("/v1/research", async (c: Context) => {
  let body: Record<string, unknown>;
  try { body = await boundedJson(c.req.raw) as Record<string, unknown>; }
  catch (error) { return c.json({ code: error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? "REQUEST_BODY_TOO_LARGE" : "INVALID_JSON" }, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400); }
  const query = String(body.query || "latest developments in decentralized AI");
  return handlePaidRequest(c, "WEB_RESEARCH", "research-default", {
    query, results: [
      { title: "AgentPay Multi-Chain Expansion", url: "https://agentpay.dev/blog/multi-chain", snippet: "AgentPay now supports Arc blockchain for sub-second USDC settlements..." },
      { title: "Arc Blockchain by Circle", url: "https://docs.arc.io", snippet: "A purpose-built L1 for stablecoin-native financial applications with USDC as gas..." },
    ], fetchedAt: new Date().toISOString(), sourceCount: 8,
  });
});

serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay resource server listening on ${env.PORT}`);
