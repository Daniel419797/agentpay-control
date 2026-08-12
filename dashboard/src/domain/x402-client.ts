import { createHash } from "node:crypto";
import { z } from "zod";
import { getNetworkRouter } from "@/domain/network-router";
import { decodeX402Header, encodeX402Header } from "@/domain/x402-headers";
import { safeFetch } from "@/lib/safe-url";

const MAX_CHALLENGE_BYTES = 64 * 1024;
const MAX_FULFILLMENT_BYTES = 1024 * 1024;

const paymentRequirementSchema = z.object({ scheme: z.literal("exact"), network: z.string().min(1), asset: z.string().min(1), amount: z.string().regex(/^\d+$/), payTo: z.string().min(1), maxTimeoutSeconds: z.number().int().positive().max(3600), extra: z.record(z.string(), z.unknown()).default({}) });
const paymentRequiredSchema = z.object({ x402Version: z.literal(2), error: z.string().optional(), resource: z.object({ url: z.string().url(), description: z.string().optional(), mimeType: z.string().optional(), serviceName: z.string().optional(), tags: z.array(z.string()).optional(), iconUrl: z.string().url().optional() }), accepts: z.array(paymentRequirementSchema).min(1), extensions: z.record(z.string(), z.unknown()).optional() });
const paymentPayloadSchema = z.object({ x402Version: z.literal(2), accepted: paymentRequirementSchema, payload: z.record(z.string(), z.unknown()), resource: z.record(z.string(), z.unknown()).optional(), extensions: z.record(z.string(), z.unknown()).optional() });
const standardPaymentResponseSchema = z.object({ success: z.boolean(), errorReason: z.string().optional(), payer: z.string().optional(), transaction: z.string().min(1), network: z.string().min(1), amount: z.string().optional(), extensions: z.record(z.string(), z.unknown()).optional() }).passthrough();
const legacyPaymentResponseSchema = z.object({ transactionId: z.string().optional(), transaction: z.string().optional(), network: z.string().optional() }).passthrough();

export type PaymentRequirement = z.infer<typeof paymentRequirementSchema>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

export function parsePaymentRequired(value: unknown) { return paymentRequiredSchema.parse(value); }

async function boundedText(response: Response, maximum: number) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("RESOURCE_RESPONSE_TOO_LARGE");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new Error("RESOURCE_RESPONSE_TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function discoverX402(resourceUrl: URL, production = false) {
  const response = await safeFetch(resourceUrl, { method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" } }, production);
  if (response.status !== 402) throw new Error("X402_PAYMENT_REQUIRED_EXPECTED");
  const header = response.headers.get("payment-required");
  let candidate: unknown;
  if (header) {
    try { candidate = decodeX402Header(header, MAX_CHALLENGE_BYTES); }
    catch { throw new Error("X402_CHALLENGE_INVALID"); }
  } else {
    const text = await boundedText(response, MAX_CHALLENGE_BYTES);
    try { candidate = JSON.parse(text); } catch { throw new Error("X402_CHALLENGE_INVALID"); }
    if (typeof candidate === "object" && candidate && "paymentRequirements" in candidate) candidate = (candidate as { paymentRequirements: unknown }).paymentRequirements;
  }
  return paymentRequiredSchema.parse(candidate);
}

function requirementIdentifierMatches(network: string, actual: string, expected: string) {
  return network.startsWith("eip155:") ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
}

function canonicalResourceUrl(value: string) {
  const url = new URL(value);
  url.hash = "";
  return url.toString();
}

function expectedCardanoResourceBinding(resourceUrl: string) {
  return createHash("sha256").update(canonicalResourceUrl(resourceUrl)).digest("hex");
}

function cardanoRequirementSafe(requirement: PaymentRequirement, resourceUrl: string) {
  if (!requirement.network.startsWith("cardano:")) return true;
  // AgentPay's Cardano rail is a direct, server-submitted exact x402 rail.
  // Masumi registry/identity may authorize the seller, but Masumi escrow is a
  // separate settlement protocol and must never be silently treated as direct.
  if (requirement.extra.assetTransferMethod !== "default") return false;
  if (requirement.extra.submissionPolicy !== "server") return false;
  if (requirement.extra.resourceBinding !== expectedCardanoResourceBinding(resourceUrl)) return false;
  const confirmation = requirement.extra.confirmationPolicy;
  if (!confirmation || typeof confirmation !== "object") return false;
  const l1 = (confirmation as Record<string, unknown>).l1Confirmations;
  return typeof l1 === "number" && Number.isInteger(l1) && l1 >= 1 && l1 <= 120;
}

export function selectRequirement(required: PaymentRequired, expected: { network: string; asset: string; amount: string; payTo: string; resourceUrl: string }) {
  if (canonicalResourceUrl(required.resource.url) !== canonicalResourceUrl(expected.resourceUrl)) throw new Error("X402_RESOURCE_MISMATCH");
  const selected = required.accepts.find((requirement) =>
    requirement.network === expected.network
    && requirementIdentifierMatches(requirement.network, requirement.asset, expected.asset)
    && requirement.amount === expected.amount
    && requirementIdentifierMatches(requirement.network, requirement.payTo, expected.payTo)
    && cardanoRequirementSafe(requirement, expected.resourceUrl)
  );
  if (!selected) throw new Error("X402_REQUIREMENT_MISMATCH");
  return selected;
}

export function createManagedPaymentPayload(facilitatorUrl: string, requirement: PaymentRequirement, apiKey?: string): Promise<{ paymentPayload: z.infer<typeof paymentPayloadSchema>; transactionId: string }>;
export function createManagedPaymentPayload(requirement: PaymentRequirement): Promise<{ paymentPayload: z.infer<typeof paymentPayloadSchema>; transactionId: string }>;
export async function createManagedPaymentPayload(facilitatorUrlOrRequirement: string | PaymentRequirement, requirement?: PaymentRequirement, apiKey?: string) {
  let url: string; let req: PaymentRequirement; let key: string | undefined;
  if (typeof facilitatorUrlOrRequirement === "string" && requirement) { url = facilitatorUrlOrRequirement; req = requirement; key = apiKey; }
  else { req = facilitatorUrlOrRequirement as PaymentRequirement; const route = getNetworkRouter().getRoute(req.network); url = route.facilitatorUrl; key = route.facilitatorApiKey; }
  const response = await fetch(`${url}/managed-sign`, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/json", accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ paymentRequirements: req }) });
  if (!response.ok) throw new Error(`FACILITATOR_SIGNING_${response.status}`);
  const body = await response.json() as { paymentPayload?: unknown; transactionId?: unknown };
  if (typeof body.transactionId !== "string" || body.transactionId.length < 8) throw new Error("FACILITATOR_TRANSACTION_ID_MISSING");
  const parsedPayload = paymentPayloadSchema.parse(body.paymentPayload);
  if (JSON.stringify(parsedPayload.accepted) !== JSON.stringify(req)) throw new Error("FACILITATOR_REQUIREMENT_MISMATCH");
  return { paymentPayload: parsedPayload, transactionId: body.transactionId };
}

function settlementCandidateFromBody(body: unknown) {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  for (const key of ["transactionId", "transaction"]) {
    const value = record[key];
    if (typeof value === "string" && value.length >= 8 && value.length <= 200) return value;
  }
  return undefined;
}

export class X402SubmissionUnknownError extends Error {
  constructor(readonly candidateTransactionId?: string) {
    super("X402_SUBMISSION_UNKNOWN");
    this.name = "X402SubmissionUnknownError";
  }
}

function ambiguousPostPaymentFailure(status: number, code: string) {
  return status >= 500 || ["SETTLEMENT_FAILED", "SETTLEMENT_UNKNOWN", "SETTLEMENT_EVIDENCE_MISSING", "SETTLEMENT_NETWORK_MISMATCH", "FACILITATOR_ERROR"].includes(code);
}

export async function fulfillX402Resource(resourceUrl: string, requirement: PaymentRequirement, paymentPayload: z.infer<typeof paymentPayloadSchema>, production = false) {
  let response: Response;
  try {
    response = await safeFetch(resourceUrl, {
      method: "GET", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(90_000),
      headers: { accept: "application/json", "payment-signature": encodeX402Header(paymentPayload) },
    }, production);
  } catch { throw new X402SubmissionUnknownError(); }

  let text: string;
  try { text = await boundedText(response, MAX_FULFILLMENT_BYTES); }
  catch { throw new X402SubmissionUnknownError(); }
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* retain text */ }
  if (!response.ok) {
    const code = typeof body === "object" && body && "code" in body ? String((body as { code: unknown }).code) : `HTTP_${response.status}`;
    if (ambiguousPostPaymentFailure(response.status, code)) throw new X402SubmissionUnknownError(settlementCandidateFromBody(body));
    throw new Error(`RESOURCE_FULFILLMENT_${code}`);
  }

  const nestedTransaction = typeof body === "object" && body && "settled" in body ? (body as { settled?: { transactionId?: string } }).settled?.transactionId : undefined;
  const paymentResponseHeader = response.headers.get("payment-response");
  let transactionId: string | undefined;
  let settlementNetwork: string | undefined;
  if (paymentResponseHeader) {
    try {
      const decoded = decodeX402Header(paymentResponseHeader, 64 * 1024);
      const standard = standardPaymentResponseSchema.safeParse(decoded);
      if (standard.success) {
        if (!standard.data.success) throw new X402SubmissionUnknownError(nestedTransaction);
        transactionId = standard.data.transaction;
        settlementNetwork = standard.data.network;
      } else {
        const legacy = legacyPaymentResponseSchema.parse(decoded);
        transactionId = legacy.transactionId ?? legacy.transaction;
        settlementNetwork = legacy.network;
      }
    } catch (error) {
      if (error instanceof X402SubmissionUnknownError) throw error;
      throw new X402SubmissionUnknownError(nestedTransaction);
    }
  }
  transactionId ??= nestedTransaction;
  if (!transactionId) throw new X402SubmissionUnknownError();
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return { body, transactionId, network: settlementNetwork ?? requirement.network, contentType, contentBytes: Buffer.byteLength(text), contentHash: createHash("sha256").update(text).digest("hex") };
}