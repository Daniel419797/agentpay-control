import { z } from "zod";

const priceId = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

const hermesResponseSchema = z.object({
  parsed: z.array(z.object({
    id: z.string().regex(/^[0-9a-fA-F]{64}$/),
    price: z.object({
      price: z.string().regex(/^-?\d+$/),
      conf: z.string().regex(/^\d+$/),
      expo: z.number().int().min(-30).max(30),
      publish_time: z.number().int().nonnegative(),
    }),
  })).min(1),
});

export type PythPriceObservation = {
  feedId: string;
  price: bigint;
  confidence: bigint;
  exponent: number;
  publishTime: number;
};

export type PythConfig = {
  baseUrl: string;
  apiKey?: string;
  adaUsdFeedId?: string;
  usdcUsdFeedId?: string;
  requestTimeoutMs: number;
};

function optionalFeed(value: string | undefined) {
  if (!value) return undefined;
  return priceId.parse(value).toLowerCase();
}

export function pythConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PythConfig {
  const baseUrl = (env.PYTH_HERMES_URL || "https://pyth.dourolabs.app/hermes").replace(/\/$/, "");
  const requestTimeoutMs = Number(env.PYTH_REQUEST_TIMEOUT_MS || "5000");
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 500 || requestTimeoutMs > 15000) throw new Error("PYTH_REQUEST_TIMEOUT_INVALID");
  if (env.APP_ENV === "production") {
    if (new URL(baseUrl).protocol !== "https:") throw new Error("PYTH_HTTPS_REQUIRED");
    if (!env.PYTH_API_KEY || env.PYTH_API_KEY.length < 20) throw new Error("PYTH_API_KEY_REQUIRED");
  }
  return {
    baseUrl,
    apiKey: env.PYTH_API_KEY,
    adaUsdFeedId: optionalFeed(env.PYTH_ADA_USD_FEED_ID),
    usdcUsdFeedId: optionalFeed(env.PYTH_USDC_USD_FEED_ID),
    requestTimeoutMs,
  };
}

export function pythFeedForSymbol(symbol: string, config: PythConfig = pythConfigFromEnv()): string {
  const normalized = symbol.toUpperCase();
  if (normalized === "ADA") {
    if (!config.adaUsdFeedId) throw new Error("PYTH_ADA_USD_FEED_ID_REQUIRED");
    return config.adaUsdFeedId;
  }
  if (normalized === "USDC" || normalized === "USDCX") {
    if (!config.usdcUsdFeedId) throw new Error("PYTH_USDC_USD_FEED_ID_REQUIRED");
    return config.usdcUsdFeedId;
  }
  throw new Error("PYTH_ASSET_UNSUPPORTED");
}

export async function fetchPythPrice(symbol: string, config: PythConfig = pythConfigFromEnv()): Promise<PythPriceObservation> {
  const feedId = pythFeedForSymbol(symbol, config);
  const url = new URL(`${config.baseUrl}/v2/updates/price/latest`);
  url.searchParams.append("ids[]", feedId);
  url.searchParams.set("parsed", "true");
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
  const response = await fetch(url, {
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!response.ok) throw new Error(`PYTH_PROVIDER_${response.status}`);
  const parsed = hermesResponseSchema.parse(await response.json()).parsed;
  const target = feedId.slice(2).toLowerCase();
  const row = parsed.find((entry) => entry.id.toLowerCase() === target);
  if (!row) throw new Error("PYTH_FEED_MISMATCH");
  const price = BigInt(row.price.price);
  const confidence = BigInt(row.price.conf);
  if (price <= 0n) throw new Error("PYTH_PRICE_NON_POSITIVE");
  return { feedId, price, confidence, exponent: row.price.expo, publishTime: row.price.publish_time };
}

export function assertPythObservation(
  observation: PythPriceObservation,
  options: { maxAgeSeconds: number; maxConfidenceBps: number; nowSeconds?: number },
) {
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (observation.publishTime > now + 5) throw new Error("PYTH_PRICE_FROM_FUTURE");
  if (now - observation.publishTime > options.maxAgeSeconds) throw new Error("PYTH_PRICE_STALE");
  if (observation.confidence * 10_000n > observation.price * BigInt(options.maxConfidenceBps)) throw new Error("PYTH_CONFIDENCE_TOO_WIDE");
}

function pow10(exponent: number): bigint {
  if (!Number.isInteger(exponent) || exponent < 0 || exponent > 80) throw new Error("PYTH_SCALE_INVALID");
  return 10n ** BigInt(exponent);
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n || numerator < 0n) throw new Error("PYTH_SCALE_INVALID");
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Converts an atomic asset amount to a conservative USD micro-dollar value.
 * The upper edge of Pyth's confidence interval is used so a policy can never
 * under-estimate autonomous spend because of oracle uncertainty or rounding.
 */
export function usdMicrosForAtomic(
  amountAtomic: string | bigint,
  assetDecimals: number,
  observation: PythPriceObservation,
): bigint {
  const amount = typeof amountAtomic === "bigint" ? amountAtomic : BigInt(amountAtomic);
  if (amount < 0n || !Number.isInteger(assetDecimals) || assetDecimals < 0 || assetDecimals > 30) throw new Error("PYTH_AMOUNT_INVALID");
  const upperPrice = observation.price + observation.confidence;
  const scaleExponent = observation.exponent + 6 - assetDecimals;
  const numerator = amount * upperPrice;
  return scaleExponent >= 0 ? numerator * pow10(scaleExponent) : ceilDiv(numerator, pow10(-scaleExponent));
}

export function pythReadinessErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  const enabled = env.PYTH_POLICY_ENABLED === "true";
  if (!enabled) return [];
  const errors: string[] = [];
  try {
    const config = pythConfigFromEnv(env);
    if (!config.adaUsdFeedId) errors.push("PYTH_ADA_USD_FEED_ID");
    if (!config.usdcUsdFeedId) errors.push("PYTH_USDC_USD_FEED_ID");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "PYTH_CONFIG_INVALID");
  }
  return errors;
}
