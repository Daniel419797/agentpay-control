import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { assertCardanoPaymentCredential } from "@/lib/cardano-address";
import { fetchMasumiAgent, type MasumiNetwork, type MasumiVerifiedEntry } from "@/lib/masumi";

const nextActionSchema = z.object({ requestedAction: z.string().min(1), errorType: z.string().nullable().optional(), errorNote: z.string().nullable().optional() }).passthrough();
const purchaseSchema = z.object({
  id: z.string().min(1), blockchainIdentifier: z.string().min(1).max(8000), inputHash: z.string().optional().nullable(), resultHash: z.string().optional().nullable(),
  submitResultTime: z.union([z.string(), z.number()]).optional().nullable(), unlockTime: z.union([z.string(), z.number()]).optional().nullable(), externalDisputeUnlockTime: z.union([z.string(), z.number()]).optional().nullable(),
  NextAction: nextActionSchema, PaidFunds: z.array(z.object({ amount: z.string().regex(/^\d+$/), unit: z.string() }).passthrough()).default([]),
  PaymentSource: z.object({ network: z.enum(["Preprod", "Mainnet"]), paymentType: z.string(), policyId: z.string().optional(), smartContractAddress: z.string().optional() }).passthrough(), CurrentTransaction: z.unknown().optional().nullable(),
}).passthrough();
const purchaseResponseSchema = z.object({ status: z.string(), data: purchaseSchema });
const purchaseListSchema = z.object({ status: z.string(), data: z.object({ Purchases: z.array(purchaseSchema) }) });
const startJobSchema = z.object({
  id: z.string().min(1).max(550), blockchainIdentifier: z.string().min(1).max(8000), payByTime: z.number().int().positive(), submitResultTime: z.number().int().positive(), unlockTime: z.number().int().positive(), externalDisputeUnlockTime: z.number().int().positive(),
  agentIdentifier: z.string().min(57).max(250), sellerVKey: z.string().regex(/^[0-9a-fA-F]{56}$/), identifierFromPurchaser: z.string().min(14).max(26), input_hash: z.string().regex(/^[0-9a-fA-F]{64}$/),
}).passthrough();
const statusSchema = z.object({ status: z.enum(["awaiting_payment", "awaiting_input", "running", "completed", "failed"]), result: z.string().optional(), input_schema: z.unknown().optional() }).passthrough();

export type MasumiPurchase = z.infer<typeof purchaseSchema>;
export type MasumiStartJob = z.infer<typeof startJobSchema>;
export type MasumiJobStatus = z.infer<typeof statusSchema>;
export type MasumiEscrowState = "FundsLockingRequested" | "FundsLocked" | "ResultSubmitted" | "Completed" | "RefundRequested" | "RefundAuthorized" | "Disputed";
export type MasumiPaymentConfig = { baseUrl: string; apiKey: string; timeoutMs: number; maxLookupPages: number };

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}
export function masumiInputHash(input: unknown) { return createHash("sha256").update(stable(input)).digest("hex"); }
export function masumiResultHash(result: string) { return createHash("sha256").update(result, "utf8").digest("hex"); }

export function masumiPaymentConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MasumiPaymentConfig {
  const baseUrl = (env.MASUMI_PAYMENT_URL || "").replace(/\/$/, ""), apiKey = env.MASUMI_PAYMENT_API_KEY || "";
  const timeoutMs = Number(env.MASUMI_PAYMENT_TIMEOUT_MS || "10000"), maxLookupPages = Number(env.MASUMI_PAYMENT_MAX_LOOKUP_PAGES || "10");
  if (!baseUrl) throw new Error("MASUMI_PAYMENT_URL_REQUIRED");
  if (!apiKey || apiKey.length < 20) throw new Error("MASUMI_PAYMENT_API_KEY_REQUIRED");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error("MASUMI_PAYMENT_TIMEOUT_INVALID");
  if (!Number.isInteger(maxLookupPages) || maxLookupPages < 1 || maxLookupPages > 50) throw new Error("MASUMI_PAYMENT_MAX_LOOKUP_PAGES_INVALID");
  if (env.APP_ENV === "production" && new URL(baseUrl).protocol !== "https:") throw new Error("MASUMI_PAYMENT_HTTPS_REQUIRED");
  if (env.APP_ENV === "production" && env.MASUMI_REGISTRY_API_KEY && env.MASUMI_REGISTRY_API_KEY === apiKey) throw new Error("MASUMI_REGISTRY_PAYMENT_KEYS_MUST_BE_DISTINCT");
  return { baseUrl, apiKey, timeoutMs, maxLookupPages };
}

function headers(config: MasumiPaymentConfig, json = false) { return { accept: "application/json", token: config.apiKey, ...(json ? { "content-type": "application/json" } : {}) }; }
async function providerJson(url: string | URL, config: MasumiPaymentConfig, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, headers: { ...headers(config, Boolean(init.body)), ...(init.headers ?? {}) }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(config.timeoutMs) });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(`MASUMI_PAYMENT_PROVIDER_${response.status}`) as Error & { status?: number; ambiguous?: boolean };
    error.status = response.status; error.ambiguous = response.status >= 500 || response.status === 409 || response.status === 408 || response.status === 429; throw error;
  }
  return payload;
}

export async function startMasumiJob(entry: MasumiVerifiedEntry, inputData: unknown, identifierFromPurchaser = randomBytes(10).toString("hex")): Promise<MasumiStartJob> {
  if (identifierFromPurchaser.length < 14 || identifierFromPurchaser.length > 26 || !/^[0-9a-f]+$/i.test(identifierFromPurchaser)) throw new Error("MASUMI_PURCHASER_IDENTIFIER_INVALID");
  const base = new URL(entry.apiBaseUrl); if (process.env.APP_ENV === "production" && base.protocol !== "https:") throw new Error("MASUMI_AGENT_HTTPS_REQUIRED");
  // Canonicalize input_data before transmission. AgentPay accepts only MIP-003
  // agents whose returned input_hash agrees with these exact deterministic bytes.
  const requestBody = `{"identifier_from_purchaser":${JSON.stringify(identifierFromPurchaser)},"input_data":${stable(inputData)}}`;
  const response = await fetch(new URL("start_job", base.href.endsWith("/") ? base : new URL(`${base.href}/`)), { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: requestBody, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`MASUMI_AGENT_START_${response.status}`);
  const job = startJobSchema.parse(await response.json());
  if (job.agentIdentifier.toLowerCase() !== entry.agentIdentifier.toLowerCase()) throw new Error("MASUMI_JOB_AGENT_MISMATCH");
  if (job.identifierFromPurchaser !== identifierFromPurchaser) throw new Error("MASUMI_JOB_PURCHASER_IDENTIFIER_MISMATCH");
  if (job.sellerVKey.toLowerCase() !== entry.sellerWallet.vkey.toLowerCase()) throw new Error("MASUMI_JOB_SELLER_VKEY_MISMATCH");
  if (job.input_hash.toLowerCase() !== masumiInputHash(inputData)) throw new Error("MASUMI_JOB_INPUT_HASH_MISMATCH");
  if (!(job.payByTime <= job.submitResultTime && job.submitResultTime <= job.unlockTime && job.unlockTime <= job.externalDisputeUnlockTime)) throw new Error("MASUMI_JOB_TIMING_INVALID");
  return job;
}

export async function createMasumiPurchase(input: { network: MasumiNetwork; entry: MasumiVerifiedEntry; job: MasumiStartJob; inputData: unknown; amounts?: Array<{ amount: string; unit: string }>; metadata?: string }, config: MasumiPaymentConfig = masumiPaymentConfigFromEnv()): Promise<MasumiPurchase> {
  assertCardanoPaymentCredential(input.entry.sellerWallet.address, input.network, input.entry.sellerWallet.vkey);
  if (input.job.input_hash.toLowerCase() !== masumiInputHash(input.inputData)) throw new Error("MASUMI_JOB_INPUT_HASH_MISMATCH");
  const request = { identifierFromPurchaser: input.job.identifierFromPurchaser, network: input.network, sellerVkey: input.entry.sellerWallet.vkey, paymentType: input.entry.paymentType ?? "Web3CardanoV1", blockchainIdentifier: input.job.blockchainIdentifier,
    payByTime: String(input.job.payByTime), submitResultTime: String(input.job.submitResultTime), unlockTime: String(input.job.unlockTime), externalDisputeUnlockTime: String(input.job.externalDisputeUnlockTime), agentIdentifier: input.entry.agentIdentifier, inputHash: input.job.input_hash.toLowerCase(),
    ...(input.amounts?.length ? { Amounts: input.amounts } : {}), ...(input.metadata ? { metadata: input.metadata.slice(0, 2000) } : {}) };
  let payload: unknown;
  try { payload = await providerJson(`${config.baseUrl}/purchase`, config, { method: "POST", body: JSON.stringify(request) }); }
  catch (error) { if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) { const ambiguous = new Error("MASUMI_PURCHASE_SUBMISSION_UNKNOWN") as Error & { ambiguous?: boolean }; ambiguous.ambiguous = true; throw ambiguous; } throw error; }
  const parsed = purchaseResponseSchema.parse(payload);
  if (parsed.status.toLowerCase() !== "success") throw new Error("MASUMI_PURCHASE_RESPONSE_INVALID");
  if (parsed.data.blockchainIdentifier !== input.job.blockchainIdentifier) throw new Error("MASUMI_PURCHASE_IDENTIFIER_MISMATCH");
  if (parsed.data.PaymentSource.network !== input.network) throw new Error("MASUMI_PURCHASE_NETWORK_MISMATCH");
  if (parsed.data.inputHash && parsed.data.inputHash.toLowerCase() !== input.job.input_hash.toLowerCase()) throw new Error("MASUMI_PURCHASE_INPUT_HASH_MISMATCH");
  return parsed.data;
}

export async function findMasumiPurchase(network: MasumiNetwork, blockchainIdentifier: string, config: MasumiPaymentConfig = masumiPaymentConfigFromEnv()): Promise<MasumiPurchase | null> {
  let cursorId: string | undefined;
  for (let page = 0; page < config.maxLookupPages; page += 1) {
    const url = new URL(`${config.baseUrl}/purchase`); url.searchParams.set("network", network); url.searchParams.set("limit", "100"); url.searchParams.set("includeHistory", "true"); if (cursorId) url.searchParams.set("cursorId", cursorId);
    const parsed = purchaseListSchema.parse(await providerJson(url, config));
    if (parsed.status.toLowerCase() !== "success") throw new Error("MASUMI_PURCHASE_LIST_INVALID");
    const exact = parsed.data.Purchases.filter((purchase) => purchase.blockchainIdentifier === blockchainIdentifier);
    if (exact.length > 1) throw new Error("MASUMI_PURCHASE_AMBIGUOUS"); if (exact[0]) return exact[0]; if (parsed.data.Purchases.length < 100) return null;
    cursorId = parsed.data.Purchases.at(-1)?.id; if (!cursorId) return null;
  }
  throw new Error("MASUMI_PURCHASE_LOOKUP_LIMIT_EXCEEDED");
}

export async function fetchMasumiJobStatus(entry: MasumiVerifiedEntry, jobId: string): Promise<MasumiJobStatus> {
  const url = new URL("status", entry.apiBaseUrl.endsWith("/") ? entry.apiBaseUrl : `${entry.apiBaseUrl}/`); url.searchParams.set("job_id", jobId);
  const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`MASUMI_AGENT_STATUS_${response.status}`); return statusSchema.parse(await response.json());
}

export async function requestMasumiRefund(network: MasumiNetwork, blockchainIdentifier: string, config: MasumiPaymentConfig = masumiPaymentConfigFromEnv()) {
  const parsed = purchaseResponseSchema.parse(await providerJson(`${config.baseUrl}/purchase/request-refund`, config, { method: "POST", body: JSON.stringify({ network, blockchainIdentifier }) }));
  if (parsed.status.toLowerCase() !== "success" || parsed.data.blockchainIdentifier !== blockchainIdentifier) throw new Error("MASUMI_REFUND_RESPONSE_INVALID"); return parsed.data;
}
export async function authorizeMasumiRefund(network: MasumiNetwork, blockchainIdentifier: string, config: MasumiPaymentConfig = masumiPaymentConfigFromEnv()) {
  const parsed = purchaseResponseSchema.parse(await providerJson(`${config.baseUrl}/payment/authorize-refund`, config, { method: "POST", body: JSON.stringify({ network, blockchainIdentifier }) }));
  if (parsed.status.toLowerCase() !== "success" || parsed.data.blockchainIdentifier !== blockchainIdentifier) throw new Error("MASUMI_REFUND_AUTH_RESPONSE_INVALID"); return parsed.data;
}
export function verifyMasumiResultHash(purchase: MasumiPurchase, status: MasumiJobStatus) {
  if (status.status !== "completed" || status.result === undefined) throw new Error("MASUMI_JOB_RESULT_NOT_COMPLETE");
  const expected = (purchase.resultHash ?? "").toLowerCase(); if (!/^[0-9a-f]{64}$/.test(expected)) throw new Error("MASUMI_RESULT_HASH_UNAVAILABLE");
  const actual = masumiResultHash(status.result); if (actual !== expected) throw new Error("MASUMI_RESULT_HASH_MISMATCH"); return { result: status.result, resultHash: actual };
}
export async function prepareMasumiEscrow(input: { agentIdentifier: string; network: MasumiNetwork; inputData: unknown }) { const entry = await fetchMasumiAgent(input.agentIdentifier, input.network); assertCardanoPaymentCredential(entry.sellerWallet.address, input.network, entry.sellerWallet.vkey); const job = await startMasumiJob(entry, input.inputData); return { entry, job }; }
export function masumiPaymentReadinessErrors(env: NodeJS.ProcessEnv = process.env): string[] { if (env.MASUMI_ESCROW_ENABLED !== "true") return []; try { masumiPaymentConfigFromEnv(env); return []; } catch (error) { return [error instanceof Error ? error.message : "MASUMI_PAYMENT_CONFIG_INVALID"]; } }
