import { z } from "zod";

const chainSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  symbol: z.string().min(1),
  chainType: z.enum(["EVM", "SVM", "TVM", "BVM"]).optional(),
  logo: z.string().optional(),
}).passthrough();

const tokenSchema = z.object({
  address: z.string(),
  decimals: z.number().int().min(0).max(255),
  symbol: z.string().min(1),
  name: z.string().min(1),
  logo: z.string().nullable().optional(),
  isNative: z.boolean().nullable().optional(),
  isStablecoin: z.boolean().nullable().optional(),
  currencyCode: z.string().nullable().optional(),
  commodityCode: z.string().nullable().optional(),
  chain: chainSchema,
  priceUsd: z.string().nullable().optional(),
  isVerified: z.boolean().nullable().optional(),
}).passthrough();

const paymentLinkSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  toAmount: z.string().min(1),
  destinationAddress: z.string().min(1),
  url: z.string().url(),
  dateCreated: z.string().datetime({ offset: true }),
  token: tokenSchema,
  status: z.enum(["active", "completed", "inactive"]),
  description: z.string().nullable().optional(),
  maxUsage: z.number().int().positive().nullable().optional(),
  receivedAmount: z.string().nullable().optional(),
  expirationDate: z.string().datetime({ offset: true }).nullable().optional(),
  transactionUrl: z.string().url().nullable().optional(),
}).passthrough();

const publicPaymentLinkSchema = paymentLinkSchema.extend({
  user: z.object({
    id: z.string().min(1),
    handle: z.string().min(1),
    username: z.string().min(1),
    profileImage: z.string().nullable().optional(),
    bio: z.string().nullable().optional(),
    wallet: z.unknown().optional(),
  }).passthrough().optional(),
}).passthrough();

const createResponseSchema = z.object({ id: z.string().min(1), url: z.string().url() });
const listResponseSchema = z.object({
  data: z.array(paymentLinkSchema),
  limit: z.number().int().positive(),
  offset: z.number().int().min(0),
  nextOffset: z.number().int().min(0).nullable().optional(),
});
const apiErrorSchema = z.object({ errors: z.array(z.object({ message: z.string(), code: z.string() })).min(1) });

export type MoovePaymentLink = z.infer<typeof paymentLinkSchema>;
export type MoovePublicPaymentLink = z.infer<typeof publicPaymentLinkSchema>;
export type MoovePaymentLinkStatus = "active" | "completed" | "inactive";
export type MooveCreatePaymentLinkInput = {
  toAmount: string;
  description?: string;
  maxUsage?: number;
  expirationDate?: string;
};
export type MooveSettlementIdentity = { network: string; symbol: string; decimals: number };
export type MooveConfig = {
  baseUrl: string;
  apiKey: string;
  organizationId: string;
  timeoutMs: number;
  maxReconcilePages: number;
  settlement?: MooveSettlementIdentity;
};

export class MooveProviderError extends Error {
  constructor(
    public readonly status: number | undefined,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = "MooveProviderError";
  }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function mooveEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.MOOVE_RECEIVE_ENABLED === "true";
}

export function mooveConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MooveConfig {
  if (!mooveEnabled(env)) throw new Error("MOOVE_RECEIVE_DISABLED");
  const baseUrl = (env.MOOVE_API_BASE_URL || "https://api.moove.xyz").replace(/\/$/, "");
  const apiKey = env.MOOVE_API_KEY || "";
  const organizationId = env.MOOVE_ACCOUNT_ORGANIZATION_ID || "";
  const timeoutMs = Number(env.MOOVE_TIMEOUT_MS || "10000");
  const maxReconcilePages = Number(env.MOOVE_MAX_RECONCILE_PAGES || "100");
  const settlementNetwork = env.MOOVE_SETTLEMENT_NETWORK?.trim() || "";
  const settlementSymbol = env.MOOVE_SETTLEMENT_SYMBOL?.trim().toUpperCase() || "";
  const settlementDecimalsRaw = env.MOOVE_SETTLEMENT_DECIMALS?.trim() || "";
  const settlementConfigured = Boolean(settlementNetwork || settlementSymbol || settlementDecimalsRaw);

  if (!apiKey || apiKey.length < 16) throw new Error("MOOVE_API_KEY_REQUIRED");
  if (!uuid.test(organizationId)) throw new Error("MOOVE_ACCOUNT_ORGANIZATION_ID_REQUIRED");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error("MOOVE_TIMEOUT_INVALID");
  if (!Number.isInteger(maxReconcilePages) || maxReconcilePages < 1 || maxReconcilePages > 500) throw new Error("MOOVE_MAX_RECONCILE_PAGES_INVALID");

  let settlement: MooveSettlementIdentity | undefined;
  if (settlementConfigured) {
    if (!settlementNetwork || !settlementSymbol || !settlementDecimalsRaw) throw new Error("MOOVE_SETTLEMENT_CONFIG_INCOMPLETE");
    const decimals = Number(settlementDecimalsRaw);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error("MOOVE_SETTLEMENT_DECIMALS_INVALID");
    settlement = { network: settlementNetwork, symbol: settlementSymbol, decimals };
  }

  const parsed = new URL(baseUrl);
  if (env.APP_ENV === "production" && parsed.protocol !== "https:") throw new Error("MOOVE_HTTPS_REQUIRED");
  if (env.APP_ENV === "production" && parsed.hostname !== "api.moove.xyz" && env.MOOVE_ALLOW_CUSTOM_BASE_URL !== "true") throw new Error("MOOVE_PRODUCTION_HOST_INVALID");
  return { baseUrl, apiKey, organizationId, timeoutMs, maxReconcilePages, settlement };
}

export function assertMooveOrganization(organizationId: string, config: MooveConfig = mooveConfigFromEnv()) {
  if (organizationId !== config.organizationId) throw new Error("MOOVE_ORGANIZATION_NOT_CONFIGURED");
}

export function assertMooveAmount(value: string) {
  if (!decimal.test(value) || /^0(?:\.0+)?$/.test(value)) throw new Error("MOOVE_AMOUNT_INVALID");
  if (value.length > 100) throw new Error("MOOVE_AMOUNT_INVALID");
  return value;
}

export function mooveTokenNetwork(token: MoovePaymentLink["token"]): string {
  if (token.chain.chainType === "EVM" && /^\d+$/.test(token.chain.id)) return `eip155:${token.chain.id}`;
  return token.chain.id;
}

export function assertMooveSettlementToken(token: MoovePaymentLink["token"], settlement: MooveSettlementIdentity) {
  if (mooveTokenNetwork(token) !== settlement.network || token.symbol.toUpperCase() !== settlement.symbol || token.decimals !== settlement.decimals) {
    throw new Error("MOOVE_SETTLEMENT_TOKEN_MISMATCH");
  }
}

function providerError(status: number, payload: unknown) {
  const parsed = apiErrorSchema.safeParse(payload);
  const detail = parsed.success ? parsed.data.errors[0]! : { code: `HTTP_${status}`, message: `Moove returned HTTP ${status}` };
  const retryable = status === 429 || status >= 500;
  return new MooveProviderError(status, detail.code, detail.message, retryable, retryable);
}

function networkError(error: unknown, ambiguous: boolean) {
  if (error instanceof MooveProviderError) return error;
  const message = error instanceof Error ? error.message : "Network request failed";
  return new MooveProviderError(undefined, "MOOVE_NETWORK_ERROR", message, true, ambiguous);
}

function retryDelay(response: Response, attempt: number) {
  const retryAfter = response.headers.get("retry-after");
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 30) return Math.max(50, Math.round(seconds * 1000));
  return Math.min(2000, 200 * 2 ** attempt);
}

async function sleep(ms: number) { await new Promise((resolve) => setTimeout(resolve, ms)); }

async function jsonRequest(
  url: URL,
  config: MooveConfig,
  init: RequestInit,
  options: { authenticated: boolean; safeToRetry: boolean },
): Promise<unknown> {
  const attempts = options.safeToRetry ? 4 : 1;
  let lastError: MooveProviderError | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          ...(options.authenticated ? { "X-API-Key": config.apiKey } : {}),
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...(init.headers ?? {}),
        },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      lastError = networkError(error, !options.safeToRetry);
      if (!options.safeToRetry || attempt === attempts - 1) throw lastError;
      await sleep(Math.min(2000, 200 * 2 ** attempt));
      continue;
    }
    const payload: unknown = await response.json().catch(() => null);
    if (response.ok) return payload;
    const failure = providerError(response.status, payload);
    lastError = failure;
    if (!options.safeToRetry || !failure.retryable || attempt === attempts - 1) throw failure;
    await sleep(retryDelay(response, attempt));
  }
  throw lastError ?? new MooveProviderError(undefined, "MOOVE_REQUEST_FAILED", "Moove request failed", true, false);
}

export async function createMoovePaymentLink(input: MooveCreatePaymentLinkInput, config: MooveConfig = mooveConfigFromEnv()) {
  assertMooveAmount(input.toAmount);
  if (input.description && input.description.length > 500) throw new Error("MOOVE_DESCRIPTION_TOO_LONG");
  if (input.maxUsage !== undefined && (!Number.isInteger(input.maxUsage) || input.maxUsage < 1 || input.maxUsage > 2_147_483_647)) throw new Error("MOOVE_MAX_USAGE_INVALID");
  if (input.expirationDate && new Date(input.expirationDate).getTime() <= Date.now()) throw new Error("MOOVE_EXPIRATION_INVALID");
  const payload = await jsonRequest(new URL("/v1/payment-link", `${config.baseUrl}/`), config, {
    method: "POST",
    body: JSON.stringify(input),
  }, { authenticated: true, safeToRetry: false });
  return createResponseSchema.parse(payload);
}

export async function listMoovePaymentLinks(input: { status?: MoovePaymentLinkStatus; offset?: number } = {}, config: MooveConfig = mooveConfigFromEnv()) {
  const url = new URL("/v1/payment-link", `${config.baseUrl}/`);
  if (input.status) url.searchParams.set("status", input.status);
  url.searchParams.set("offset", String(input.offset ?? 0));
  return listResponseSchema.parse(await jsonRequest(url, config, { method: "GET" }, { authenticated: true, safeToRetry: true }));
}

export async function listAllMoovePaymentLinks(config: MooveConfig = mooveConfigFromEnv()) {
  const links: MoovePaymentLink[] = [];
  let offset = 0;
  for (let page = 0; page < config.maxReconcilePages; page += 1) {
    const result = await listMoovePaymentLinks({ offset }, config);
    links.push(...result.data);
    if (result.nextOffset === null || result.nextOffset === undefined) return { links, complete: true };
    if (result.nextOffset <= offset) throw new Error("MOOVE_PAGINATION_INVALID");
    offset = result.nextOffset;
  }
  return { links, complete: false };
}

export async function retrieveMoovePaymentLink(id: string, config: MooveConfig = mooveConfigFromEnv()) {
  if (!id || id.length > 200) throw new Error("MOOVE_PAYMENT_LINK_ID_INVALID");
  const url = new URL(`/v1/payment-link/${encodeURIComponent(id)}`, `${config.baseUrl}/`);
  return publicPaymentLinkSchema.parse(await jsonRequest(url, config, { method: "GET" }, { authenticated: false, safeToRetry: true }));
}

export function mooveReadinessErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (!mooveEnabled(env)) return [];
  try { mooveConfigFromEnv(env); return []; }
  catch (error) { return [error instanceof Error ? error.message : "MOOVE_CONFIG_INVALID"]; }
}
