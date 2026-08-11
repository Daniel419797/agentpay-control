import { createHash, randomUUID } from "node:crypto";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";
import { z } from "zod";
import "./production-preflight.js";
import { parseEnabledNetworks, requiresNetwork } from "./network-selection.js";
import { boundedJson, sameRequirement } from "./security.js";
import { decodeX402Header, encodeX402Header } from "./x402-headers.js";

const env = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  ENABLED_NETWORKS: z.string().default("hedera:testnet,eip155:5042002"),
  FACILITATOR_URL: z.string().default("http://localhost:8787"),
  HEDERA_MAINNET_FACILITATOR_URL: z.string().default("http://localhost:8787"),
  ARC_FACILITATOR_URL: z.string().default("http://localhost:8788"),
  PORT: z.coerce.number().default(3200),
  NETWORK: z.string().default("hedera:testnet"),
  PROVIDER_ACCOUNT_ID: z.string().optional(),
  HEDERA_MAINNET_PROVIDER_ACCOUNT_ID: z.string().optional(),
  USDC_TOKEN_ID: z.string().optional(),
  HEDERA_MAINNET_USDC_TOKEN_ID: z.string().optional(),
  FACILITATOR_FEE_PAYER_ID: z.string().optional(),
  FACILITATOR_API_KEY: z.string().min(32).optional(),
  FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  HEDERA_MAINNET_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  ARC_FACILITATOR_SETTLEMENT_API_KEY: z.string().min(32).optional(),
  ARC_PROVIDER_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ARC_USDC_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
}).parse(process.env);

const enabledNetworks = parseEnabledNetworks(env.ENABLED_NETWORKS);
if (env.APP_ENV === "production") {
  if (requiresNetwork(enabledNetworks, "hedera:testnet") && !env.FACILITATOR_SETTLEMENT_API_KEY) throw new Error("Production Hedera testnet settlement API key is required");
  if (requiresNetwork(enabledNetworks, "hedera:mainnet") && !env.HEDERA_MAINNET_FACILITATOR_SETTLEMENT_API_KEY) throw new Error("Production Hedera mainnet settlement API key is required");
  if (requiresNetwork(enabledNetworks, "eip155:5042002") && !env.ARC_FACILITATOR_SETTLEMENT_API_KEY) throw new Error("Production Arc settlement API key is required");
}

const ARCTestnet = {
  caip2: "eip155:5042002",
  usdcAddress: env.ARC_USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000",
  providerAddress: env.ARC_PROVIDER_ADDRESS ?? "",
  explorerUrl: "https://testnet.arcscan.app/tx",
  facilitatorUrl: env.ARC_FACILITATOR_URL,
};
const HederaTestnet = {
  caip2: "hedera:testnet",
  usdcTokenId: env.USDC_TOKEN_ID ?? "",
  providerAccountId: env.PROVIDER_ACCOUNT_ID ?? "",
  explorerUrl: "https://hashscan.io/testnet/transaction",
  facilitatorUrl: env.FACILITATOR_URL,
};
const HederaMainnet = {
  caip2: "hedera:mainnet",
  usdcTokenId: env.HEDERA_MAINNET_USDC_TOKEN_ID ?? "",
  providerAccountId: env.HEDERA_MAINNET_PROVIDER_ACCOUNT_ID ?? "",
  explorerUrl: "https://hashscan.io/mainnet/transaction",
  facilitatorUrl: env.HEDERA_MAINNET_FACILITATOR_URL,
};

type NetworkConfig = { caip2: string; facilitatorUrl: string; explorerUrl: string };
const configuredNetworks: Record<string, NetworkConfig> = {
  [HederaTestnet.caip2]: HederaTestnet,
  [HederaMainnet.caip2]: HederaMainnet,
  [ARCTestnet.caip2]: ARCTestnet,
};
const networks = Object.fromEntries(Object.entries(configuredNetworks).filter(([network]) => enabledNetworks.has(network as never))) as Record<string, NetworkConfig>;

type AssetPrice = { type: "NATIVE" | "TOKEN"; amount: string; assetId: string; decimals: number; symbol: string };
const requirementSchema = z.object({
  scheme: z.literal("exact"), network: z.string().min(1), amount: z.string().regex(/^\d+$/), payTo: z.string().min(1), asset: z.string().min(1), maxTimeoutSeconds: z.number().int().positive().max(3600), extra: z.record(z.string(), z.unknown()).default({}),
});
const paymentPayloadSchema = z.object({ x402Version: z.literal(2), accepted: requirementSchema, payload: z.record(z.string(), z.unknown()) }).passthrough();
const settlementResponseSchema = z.object({
  success: z.boolean(),
  errorReason: z.string().optional(),
  payer: z.string().optional(),
  transaction: z.string(),
  transactionId: z.string().optional(),
  network: z.string(),
  amount: z.string().optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const arcPrices: Record<string, AssetPrice> = { usdc: { type: "TOKEN", amount: "1000000", assetId: ARCTestnet.usdcAddress, decimals: 6, symbol: "USDC" } };
const hederaTestnetPrices: Record<string, AssetPrice> = {
  hbar: { type: "NATIVE", amount: "5000000", assetId: "0.0.0", decimals: 8, symbol: "HBAR" },
  usdc: { type: "TOKEN", amount: "1000000", assetId: HederaTestnet.usdcTokenId, decimals: 6, symbol: "USDC" },
};
const hederaMainnetPrices: Record<string, AssetPrice> = {
  hbar: { type: "NATIVE", amount: "5000000", assetId: "0.0.0", decimals: 8, symbol: "HBAR" },
  usdc: { type: "TOKEN", amount: "1000000", assetId: HederaMainnet.usdcTokenId, decimals: 6, symbol: "USDC" },
};

function getNetworkConfig(network: string): NetworkConfig | undefined { return networks[network]; }
function pricesForNetwork(network: string): Record<string, AssetPrice> {
  if (network === ARCTestnet.caip2) return arcPrices;
  if (network === HederaMainnet.caip2) return hederaMainnetPrices;
  return hederaTestnetPrices;
}
function payeeForNetwork(network: string): string {
  if (network === ARCTestnet.caip2) return ARCTestnet.providerAddress;
  if (network === HederaMainnet.caip2) return HederaMainnet.providerAccountId;
  return HederaTestnet.providerAccountId;
}
function requirementsForNetwork(network: string) {
  const isArc = network === ARCTestnet.caip2;
  return Object.values(pricesForNetwork(network))
    .filter((price) => price.assetId.length > 0 && payeeForNetwork(network).length > 0)
    .map((price) => ({ scheme: "exact" as const, network, amount: price.amount, payTo: payeeForNetwork(network), asset: price.assetId, maxTimeoutSeconds: 900, extra: isArc ? { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" } : { feePayer: env.FACILITATOR_FEE_PAYER_ID } }));
}
function paymentRequirements(resourceUrl: string) {
  const accepts = Object.keys(networks).flatMap(requirementsForNetwork);
  if (!accepts.length) throw new Error("PAYMENT_ASSET_NOT_CONFIGURED");
  return { x402Version: 2, accepts, resource: { url: resourceUrl, description: "AgentPay x402 demonstration resource", mimeType: "application/json", serviceName: "AgentPay Resource Server" } };
}

const sharedPrices = [
  { asset: "HBAR", atomicAmount: hederaTestnetPrices.hbar.amount, network: HederaTestnet.caip2, assetId: hederaTestnetPrices.hbar.assetId },
  { asset: "USDC", atomicAmount: hederaTestnetPrices.usdc.amount, network: HederaTestnet.caip2, assetId: hederaTestnetPrices.usdc.assetId },
  { asset: "HBAR", atomicAmount: hederaMainnetPrices.hbar.amount, network: HederaMainnet.caip2, assetId: hederaMainnetPrices.hbar.assetId },
  { asset: "USDC", atomicAmount: hederaMainnetPrices.usdc.amount, network: HederaMainnet.caip2, assetId: hederaMainnetPrices.usdc.assetId },
  { asset: "USDC", atomicAmount: arcPrices.usdc.amount, network: ARCTestnet.caip2, assetId: arcPrices.usdc.assetId },
].filter((price) => enabledNetworks.has(price.network as never) && price.assetId.length > 0).map(({ assetId: _assetId, ...price }) => price);
const hederaCatalogPrices = sharedPrices.filter((price) => price.network.startsWith("hedera:"));

const catalog = {
  mode: "DEMO_SYNTHETIC",
  notice: "Resource payloads are synthetic fixtures for x402 integration testing, not live market, AI, file, or research services.",
  resources: [
    { id: "market-data-eth", category: "MARKET_DATA", name: "ETH/USD Demo Snapshot", description: "Synthetic ETH/USD fixture for testing paid-resource flows; not live market data.", endpoint: "/v1/market-data/ETH", prices: sharedPrices },
    { id: "market-data-btc", category: "MARKET_DATA", name: "BTC/USD Demo Snapshot", description: "Synthetic BTC/USD fixture for testing paid-resource flows; not live market data.", endpoint: "/v1/market-data/BTC", prices: sharedPrices },
    { id: "files-report", category: "FILE", name: "Demo Market Report", description: "Synthetic document fixture used to demonstrate paid file access.", endpoint: "/v1/files/report-q2", prices: hederaCatalogPrices },
    { id: "inference-llama", category: "AI_INFERENCE", name: "Simulated LLaMA Inference", description: "Simulated model output used to test metered x402 inference flows; no model is called.", endpoint: "/v1/inference/llama-3.2", prices: sharedPrices },
    { id: "research-web", category: "WEB_RESEARCH", name: "Simulated Web Research", description: "Synthetic research results used to test paid research flows; no live web retrieval occurs.", endpoint: "/v1/research", prices: hederaCatalogPrices },
  ],
};

const marketData: Record<string, { price: string; change: string; high: string; low: string }> = {
  ETH: { price: "3450.25", change: "+2.3%", high: "3480.10", low: "3380.50" },
  BTC: { price: "67500.00", change: "+1.1%", high: "68100.00", low: "66300.00" },
  SOL: { price: "145.80", change: "-0.5%", high: "148.20", low: "143.90" },
  LINK: { price: "14.25", change: "+5.2%", high: "14.50", low: "13.55" },
};

function generateResourceId(): string { return createHash("sha256").update(randomUUID()).digest("hex").slice(0, 16); }
function getFacilitatorForNetwork(network: string): string | undefined {
  if (network === ARCTestnet.caip2) return ARCTestnet.facilitatorUrl;
  if (network === HederaTestnet.caip2) return HederaTestnet.facilitatorUrl;
  if (network === HederaMainnet.caip2) return HederaMainnet.facilitatorUrl;
  return undefined;
}
function getSettlementApiKey(network: string): string | undefined {
  if (network === ARCTestnet.caip2) return env.ARC_FACILITATOR_SETTLEMENT_API_KEY ?? env.FACILITATOR_API_KEY;
  if (network === HederaMainnet.caip2) return env.HEDERA_MAINNET_FACILITATOR_SETTLEMENT_API_KEY ?? env.FACILITATOR_API_KEY;
  return env.FACILITATOR_SETTLEMENT_API_KEY ?? env.FACILITATOR_API_KEY;
}

const app = new Hono();
app.get("/health", (c: Context) => c.json({ status: "ok", networks: Object.keys(networks), resourceMode: "DEMO_SYNTHETIC" }));
app.get("/catalog", (c: Context) => c.json(catalog));

async function handlePaidRequest(c: Context, category: string, resourceId: string, data: unknown) {
  const paymentSignature = c.req.header("PAYMENT-SIGNATURE");
  let canonical: ReturnType<typeof paymentRequirements>;
  try { canonical = paymentRequirements(c.req.url); }
  catch { return c.json({ code: "PAYMENT_ASSET_NOT_CONFIGURED", message: "No enabled payment rail has a complete asset/payee configuration." }, 503); }

  if (!paymentSignature) {
    c.header("PAYMENT-REQUIRED", encodeX402Header(canonical));
    return c.json({ code: "PAYMENT_REQUIRED", message: `Payment is required to access this ${category} resource`, paymentRequirements: canonical }, 402);
  }

  let payload: z.infer<typeof paymentPayloadSchema>;
  try { payload = paymentPayloadSchema.parse(decodeX402Header(paymentSignature)); }
  catch (error) {
    const code = error instanceof Error && error.message === "PAYMENT_HEADER_TOO_LARGE" ? "PAYMENT_PAYLOAD_TOO_LARGE" : "PAYMENT_HEADER_INVALID";
    return c.json({ code, message: "The payment signature header is invalid." }, code === "PAYMENT_PAYLOAD_TOO_LARGE" ? 413 : 400);
  }

  const matchingCanonical = canonical.accepts.find((req) => sameRequirement(payload.accepted, req));
  if (!matchingCanonical) return c.json({ code: "PAYMENT_REQUIREMENT_MISMATCH", message: "The signed payment does not match this resource price and payee." }, 402);
  const network = matchingCanonical.network;
  const facilitatorUrl = getFacilitatorForNetwork(network);
  if (!facilitatorUrl) return c.json({ code: "NETWORK_UNSUPPORTED", message: `Network ${network} is not supported` }, 422);
  const settlementApiKey = getSettlementApiKey(network);
  const verifyBody = { paymentPayload: payload, paymentRequirements: matchingCanonical };
  const idempotencyKey = `resource:${resourceId}:${createHash("sha256").update(paymentSignature).digest("hex")}`;

  try {
    const verifyRes = await fetch(`${facilitatorUrl.replace(/\/$/, "")}/verify`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, ...(settlementApiKey ? { authorization: `Bearer ${settlementApiKey}` } : {}) }, body: JSON.stringify(verifyBody), signal: AbortSignal.timeout(15_000),
    });
    const verifyResult = await verifyRes.json().catch(() => ({})) as { isValid?: boolean; invalidReason?: string };
    if (!verifyRes.ok || verifyResult.isValid !== true) return c.json({ code: "PAYMENT_INVALID", message: verifyResult.invalidReason || "Payment verification failed" }, 402);

    const settleRes = await fetch(`${facilitatorUrl.replace(/\/$/, "")}/settle`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, ...(settlementApiKey ? { authorization: `Bearer ${settlementApiKey}` } : {}) }, body: JSON.stringify(verifyBody), signal: AbortSignal.timeout(75_000),
    });
    const rawSettlement = await settleRes.json().catch(() => ({}));
    const parsedSettlement = settlementResponseSchema.safeParse(rawSettlement);
    if (!settleRes.ok || !parsedSettlement.success || parsedSettlement.data.success !== true) {
      const errorReason = parsedSettlement.success ? parsedSettlement.data.errorReason : undefined;
      const transactionCandidate = parsedSettlement.success
        ? ((parsedSettlement.data.transactionId ?? parsedSettlement.data.transaction) || undefined)
        : undefined;
      if (settleRes.status >= 500 || errorReason === "settlement_unknown") {
        return c.json({
          code: "SETTLEMENT_UNKNOWN",
          message: "Settlement may have been submitted but could not be confirmed.",
          network,
          ...(transactionCandidate ? { transactionId: transactionCandidate } : {}),
        }, 503);
      }
      return c.json({ code: "SETTLEMENT_FAILED", message: errorReason || "Settlement failed" }, 422);
    }
    const settleResult = parsedSettlement.data;
    if (settleResult.network !== network) return c.json({ code: "SETTLEMENT_NETWORK_MISMATCH", message: "Facilitator settlement evidence returned a different network." }, 502);
    if (!settleResult.transaction) return c.json({ code: "SETTLEMENT_EVIDENCE_MISSING", message: "Facilitator did not return a transaction ID" }, 502);

    const paymentResponse = {
      success: true,
      transaction: settleResult.transaction,
      network: settleResult.network,
      ...(settleResult.payer ? { payer: settleResult.payer } : {}),
      amount: settleResult.amount ?? matchingCanonical.amount,
      ...(settleResult.extensions ? { extensions: settleResult.extensions } : {}),
    };
    c.header("PAYMENT-RESPONSE", encodeX402Header(paymentResponse));
    const networkConfig = getNetworkConfig(network);
    const explorerUrl = networkConfig ? `${networkConfig.explorerUrl}/${settleResult.transaction}` : undefined;
    return c.json({ resourceId: generateResourceId(), category, content: data, settled: { transactionId: settleResult.transaction, explorerUrl } });
  } catch (error) {
    console.error(JSON.stringify({ event: "facilitator_request_failed", errorType: error instanceof Error ? error.name : "UnknownError" }));
    return c.json({ code: "FACILITATOR_ERROR", message: "Facilitator communication failed" }, 502);
  }
}

app.get("/v1/market-data/:symbol", async (c: Context) => {
  const symbol = (c.req.param("symbol") ?? "").toUpperCase();
  const data = marketData[symbol];
  if (!data) return c.json({ code: "NOT_FOUND", message: `Unknown symbol: ${symbol}` }, 404);
  return handlePaidRequest(c, "MARKET_DATA", `market-data-${symbol}`, { symbol, ...data, simulated: true, provenance: "STATIC_DEMO_FIXTURE", observedAt: null });
});

app.get("/v1/files/:fileId", async (c: Context) => {
  const fileId = c.req.param("fileId") ?? "";
  const files: Record<string, { name: string; content: string; simulated: true }> = {
    "report-q2": { name: "Demo-Q2-Market-Report.txt", content: "Synthetic demonstration report. The figures and findings in this fixture are not real market research and must not be used for decisions.", simulated: true },
    "whitepaper": { name: "AgentPay-Demo-Whitepaper.txt", content: "Synthetic demonstration document for exercising paid file delivery through x402.", simulated: true },
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
  return handlePaidRequest(c, "AI_INFERENCE", `inference-${model}`, { model, prompt, simulated: true, response: `[Simulated ${model} output] This endpoint is a fixture used to exercise x402 payment and fulfillment. No model provider was called.`, tokensUsed: null, modelVersion: null });
});

app.post("/v1/research", async (c: Context) => {
  let body: Record<string, unknown>;
  try { body = await boundedJson(c.req.raw) as Record<string, unknown>; }
  catch (error) { return c.json({ code: error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? "REQUEST_BODY_TOO_LARGE" : "INVALID_JSON" }, error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE" ? 413 : 400); }
  const query = String(body.query || "agent payment infrastructure");
  return handlePaidRequest(c, "WEB_RESEARCH", "research-default", { query, simulated: true, results: [{ title: "Synthetic example result", url: null, snippet: "Fixture content used only to demonstrate paid research delivery." }], fetchedAt: null, sourceCount: 0, provenance: "STATIC_DEMO_FIXTURE" });
});

serve({ fetch: app.fetch, port: env.PORT });
console.log(`AgentPay resource server listening on ${env.PORT}`);