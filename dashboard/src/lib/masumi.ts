import { createHash } from "node:crypto";
import { z } from "zod";
import { assertCardanoPaymentCredential } from "@/lib/cardano-address";

const registryPolicyId = z.string().regex(/^[0-9a-fA-F]{56,64}$/);
const sellerPaymentKeyHash = z.string().regex(/^[0-9a-fA-F]{56}$/);

const entrySchema = z.object({
  id: z.string(), name: z.string(), description: z.string().optional().nullable(), status: z.string(),
  statusUpdatedAt: z.string().datetime().optional().nullable(), apiBaseUrl: z.string().url(),
  paymentType: z.string().optional().nullable(), agentIdentifier: z.string().min(57).max(250),
  RegistrySource: z.object({ policyId: registryPolicyId, url: z.string().url().optional().nullable() }),
  Capability: z.object({ name: z.string(), version: z.string().optional().nullable() }).optional().nullable(),
  AgentPricing: z.unknown().optional(), metadataVersion: z.number().int().optional(), tags: z.array(z.string()).optional().default([]),
}).passthrough();

const sellerWalletSchema = z.object({ address: z.string().regex(/^addr(_test)?1[0-9a-z]+$/), vkey: sellerPaymentKeyHash });
const paymentInformationEntrySchema = entrySchema.extend({ sellerWallet: sellerWalletSchema });
const registryResponseSchema = z.object({ status: z.string(), data: z.object({ entries: z.array(entrySchema) }) });
const paymentInformationResponseSchema = z.object({ status: z.string(), data: paymentInformationEntrySchema });

export type MasumiEntry = z.infer<typeof entrySchema>;
export type MasumiVerifiedEntry = z.infer<typeof paymentInformationEntrySchema>;
export type MasumiNetwork = "Preprod" | "Mainnet";
export type MasumiConfig = { baseUrl: string; apiKey?: string; requestTimeoutMs: number; trustedRegistryPolicyIds: string[] };

function parseTrustedPolicies(value: string | undefined) {
  const values = [...new Set((value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean))];
  for (const item of values) if (!/^[0-9a-f]{56,64}$/.test(item)) throw new Error("MASUMI_TRUSTED_REGISTRY_POLICY_IDS_INVALID");
  return values;
}

export function masumiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MasumiConfig {
  const baseUrl = (env.MASUMI_REGISTRY_URL || "https://registry.masumi.network/api/v1").replace(/\/$/, "");
  const requestTimeoutMs = Number(env.MASUMI_REQUEST_TIMEOUT_MS || "7000");
  if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 500 || requestTimeoutMs > 15000) throw new Error("MASUMI_REQUEST_TIMEOUT_INVALID");
  const trustedRegistryPolicyIds = parseTrustedPolicies(env.MASUMI_TRUSTED_REGISTRY_POLICY_IDS);
  if (env.APP_ENV === "production") {
    if (new URL(baseUrl).protocol !== "https:") throw new Error("MASUMI_HTTPS_REQUIRED");
    if (!env.MASUMI_REGISTRY_API_KEY || env.MASUMI_REGISTRY_API_KEY.length < 20) throw new Error("MASUMI_REGISTRY_API_KEY_REQUIRED");
    if (!trustedRegistryPolicyIds.length) throw new Error("MASUMI_TRUSTED_REGISTRY_POLICY_IDS_REQUIRED");
  }
  return { baseUrl, apiKey: env.MASUMI_REGISTRY_API_KEY, requestTimeoutMs, trustedRegistryPolicyIds };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function sellerWalletFromEntry(entry: MasumiEntry | MasumiVerifiedEntry) {
  if (!("sellerWallet" in entry)) return undefined;
  return sellerWalletSchema.parse(entry.sellerWallet);
}

export function masumiMetadataHash(entry: MasumiEntry | MasumiVerifiedEntry): string {
  const sellerWallet = sellerWalletFromEntry(entry);
  return createHash("sha256").update(stable({ agentIdentifier: entry.agentIdentifier, apiBaseUrl: entry.apiBaseUrl, status: entry.status,
    registryPolicyId: entry.RegistrySource.policyId, capability: entry.Capability ?? null, paymentType: entry.paymentType ?? null,
    pricing: entry.AgentPricing ?? null, sellerAddress: sellerWallet?.address ?? null, sellerVkey: sellerWallet?.vkey ?? null,
    metadataVersion: entry.metadataVersion ?? null })).digest("hex");
}

function headers(config: MasumiConfig) { const result: Record<string, string> = { accept: "application/json" }; if (config.apiKey) result.token = config.apiKey; return result; }
function assertTrustedRegistry(policyId: string, config: MasumiConfig) { if (config.trustedRegistryPolicyIds.length && !config.trustedRegistryPolicyIds.includes(policyId.toLowerCase())) throw new Error("MASUMI_REGISTRY_POLICY_NOT_TRUSTED"); }

async function queryRegistry(body: unknown, config: MasumiConfig): Promise<MasumiEntry[]> {
  const response = await fetch(`${config.baseUrl}/registry-entry/`, { method: "POST", headers: { ...headers(config), "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(config.requestTimeoutMs) });
  if (!response.ok) throw new Error(`MASUMI_PROVIDER_${response.status}`);
  const payload = registryResponseSchema.parse(await response.json());
  if (payload.status.toLowerCase() !== "success") throw new Error("MASUMI_RESPONSE_INVALID");
  return payload.data.entries;
}

async function paymentInformation(agentIdentifier: string, config: MasumiConfig): Promise<MasumiVerifiedEntry> {
  const url = new URL(`${config.baseUrl}/payment-information/`); url.searchParams.set("agentIdentifier", agentIdentifier);
  const response = await fetch(url, { headers: headers(config), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(config.requestTimeoutMs) });
  if (!response.ok) throw new Error(`MASUMI_PAYMENT_INFORMATION_${response.status}`);
  const payload = paymentInformationResponseSchema.parse(await response.json());
  if (payload.status.toLowerCase() !== "success") throw new Error("MASUMI_PAYMENT_INFORMATION_INVALID");
  return payload.data;
}

export async function fetchMasumiAgent(agentIdentifier: string, network: MasumiNetwork, config: MasumiConfig = masumiConfigFromEnv()): Promise<MasumiVerifiedEntry> {
  if (!/^[0-9a-fA-F]{57,250}$/.test(agentIdentifier)) throw new Error("MASUMI_AGENT_IDENTIFIER_INVALID");
  const entries = await queryRegistry({ network, limit: 10, filter: { assetIdentifier: agentIdentifier, status: ["Online"] }, minHealthCheckDate: new Date(Date.now() - 5 * 60_000).toISOString() }, config);
  const exact = entries.filter((entry) => entry.agentIdentifier.toLowerCase() === agentIdentifier.toLowerCase());
  if (exact.length !== 1) throw new Error(exact.length ? "MASUMI_AGENT_AMBIGUOUS" : "MASUMI_AGENT_NOT_VERIFIED");
  if (exact[0].status !== "Online") throw new Error("MASUMI_AGENT_OFFLINE");
  assertTrustedRegistry(exact[0].RegistrySource.policyId, config);
  const payment = await paymentInformation(agentIdentifier, config);
  if (payment.agentIdentifier.toLowerCase() !== exact[0].agentIdentifier.toLowerCase()) throw new Error("MASUMI_PAYMENT_INFORMATION_IDENTITY_MISMATCH");
  if (payment.RegistrySource.policyId !== exact[0].RegistrySource.policyId) throw new Error("MASUMI_PAYMENT_INFORMATION_REGISTRY_MISMATCH");
  assertTrustedRegistry(payment.RegistrySource.policyId, config);
  if (new URL(payment.apiBaseUrl).toString() !== new URL(exact[0].apiBaseUrl).toString()) throw new Error("MASUMI_PAYMENT_INFORMATION_URL_MISMATCH");
  if (payment.status !== "Online") throw new Error("MASUMI_AGENT_OFFLINE");
  const expectedPrefix = network === "Mainnet" ? "addr1" : "addr_test1";
  if (!payment.sellerWallet.address.startsWith(expectedPrefix)) throw new Error("MASUMI_SELLER_WALLET_NETWORK_MISMATCH");
  assertCardanoPaymentCredential(payment.sellerWallet.address, network, payment.sellerWallet.vkey);
  return payment;
}

export async function discoverMasumiAgents(input: { network: MasumiNetwork; capabilityName?: string; capabilityVersion?: string; tags?: string[]; limit?: number }, config: MasumiConfig = masumiConfigFromEnv()): Promise<MasumiEntry[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 50));
  const entries = await queryRegistry({ network: input.network, limit, filter: { status: ["Online"], ...(input.tags?.length ? { tags: input.tags.slice(0, 15) } : {}), ...(input.capabilityName ? { capability: { name: input.capabilityName, ...(input.capabilityVersion ? { version: input.capabilityVersion } : {}) } } : {}) } }, config);
  return entries.filter((entry) => !config.trustedRegistryPolicyIds.length || config.trustedRegistryPolicyIds.includes(entry.RegistrySource.policyId.toLowerCase()));
}

export function assertMasumiEntryMatches(entry: MasumiEntry | MasumiVerifiedEntry, expected: { network: MasumiNetwork; agentIdentifier: string; resourceUrl: string; allowedCapabilities?: string[] }) {
  if (entry.agentIdentifier.toLowerCase() !== expected.agentIdentifier.toLowerCase()) throw new Error("MASUMI_AGENT_IDENTIFIER_MISMATCH");
  if (entry.status !== "Online") throw new Error("MASUMI_AGENT_OFFLINE");
  const base = new URL(entry.apiBaseUrl), resource = new URL(expected.resourceUrl);
  if (base.protocol !== "https:" && process.env.APP_ENV === "production") throw new Error("MASUMI_AGENT_HTTPS_REQUIRED");
  const normalizedBasePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
  const normalizedResourcePath = resource.pathname.endsWith("/") ? resource.pathname : `${resource.pathname}/`;
  if (base.origin !== resource.origin || !normalizedResourcePath.startsWith(normalizedBasePath)) throw new Error("MASUMI_RESOURCE_URL_MISMATCH");
  if (expected.allowedCapabilities?.length) { const capability = entry.Capability?.name; if (!capability || !expected.allowedCapabilities.includes(capability)) throw new Error("MASUMI_CAPABILITY_NOT_ALLOWED"); }
  const sellerWallet = sellerWalletFromEntry(entry);
  if (sellerWallet) assertCardanoPaymentCredential(sellerWallet.address, expected.network, sellerWallet.vkey);
}

export function masumiReadinessErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.MASUMI_POLICY_ENABLED !== "true") return [];
  try { masumiConfigFromEnv(env); return []; } catch (error) { return [error instanceof Error ? error.message : "MASUMI_CONFIG_INVALID"]; }
}
