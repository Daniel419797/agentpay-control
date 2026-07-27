import { createHash } from "node:crypto";
import { z } from "zod";
import { getNetworkRouter } from "@/domain/network-router";

const MAX_CHALLENGE_BYTES = 64 * 1024;
const MAX_FULFILLMENT_BYTES = 1024 * 1024;

const paymentRequirementSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string().min(1),
  asset: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string().min(1),
  maxTimeoutSeconds: z.number().int().positive().max(3600),
  extra: z.record(z.string(), z.unknown()).default({}),
});

const paymentRequiredSchema = z.object({
  x402Version: z.literal(2),
  error: z.string().optional(),
  resource: z.object({
    url: z.string().url(),
    description: z.string().optional(),
    mimeType: z.string().optional(),
    serviceName: z.string().optional(),
    tags: z.array(z.string()).optional(),
    iconUrl: z.string().url().optional(),
  }),
  accepts: z.array(paymentRequirementSchema).min(1),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

const paymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: paymentRequirementSchema,
  payload: z.record(z.string(), z.unknown()),
  resource: z.record(z.string(), z.unknown()).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

export type PaymentRequirement = z.infer<typeof paymentRequirementSchema>;
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

export function parsePaymentRequired(value: unknown) {
  return paymentRequiredSchema.parse(value);
}

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
    if (size > maximum) {
      await reader.cancel();
      throw new Error("RESOURCE_RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function discoverX402(resourceUrl: URL) {
  const response = await fetch(resourceUrl, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
    headers: { accept: "application/json" },
  });
  if (response.status !== 402) throw new Error("X402_PAYMENT_REQUIRED_EXPECTED");
  const header = response.headers.get("payment-required");
  if (header && Buffer.byteLength(header) > MAX_CHALLENGE_BYTES) throw new Error("RESOURCE_RESPONSE_TOO_LARGE");
  const text = header ?? await boundedText(response, MAX_CHALLENGE_BYTES);
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new Error("X402_CHALLENGE_INVALID");
  }
  if (!header && typeof candidate === "object" && candidate && "paymentRequirements" in candidate) {
    candidate = (candidate as { paymentRequirements: unknown }).paymentRequirements;
  }
  return paymentRequiredSchema.parse(candidate);
}

export function selectRequirement(
  required: PaymentRequired,
  expected: { network: string; asset: string; amount: string; payTo: string; resourceUrl: string },
) {
  if (new URL(required.resource.url).toString() !== new URL(expected.resourceUrl).toString()) throw new Error("X402_RESOURCE_MISMATCH");
  const selected = required.accepts.find((requirement) =>
    requirement.network === expected.network &&
    requirement.asset === expected.asset &&
    requirement.amount === expected.amount &&
    requirement.payTo === expected.payTo
  );
  if (!selected) throw new Error("X402_REQUIREMENT_MISMATCH");
  return selected;
}

export function createManagedPaymentPayload(
  facilitatorUrl: string,
  requirement: PaymentRequirement,
  apiKey?: string,
): Promise<{ paymentPayload: z.infer<typeof paymentPayloadSchema>; transactionId: string }>;

export function createManagedPaymentPayload(
  requirement: PaymentRequirement,
): Promise<{ paymentPayload: z.infer<typeof paymentPayloadSchema>; transactionId: string }>;

export async function createManagedPaymentPayload(
  facilitatorUrlOrRequirement: string | PaymentRequirement,
  requirement?: PaymentRequirement,
  apiKey?: string,
) {
  let url: string;
  let req: PaymentRequirement;
  let key: string | undefined;

  if (typeof facilitatorUrlOrRequirement === "string" && requirement) {
    url = facilitatorUrlOrRequirement;
    req = requirement;
    key = apiKey;
  } else {
    req = facilitatorUrlOrRequirement as PaymentRequirement;
    const route = getNetworkRouter().getRoute(req.network);
    url = route.facilitatorUrl;
    key = route.facilitatorApiKey;
  }

  const response = await fetch(`${url}/managed-sign`, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ paymentRequirements: req }),
  });
  if (!response.ok) throw new Error(`FACILITATOR_SIGNING_${response.status}`);
  const body = await response.json() as { paymentPayload?: unknown; transactionId?: unknown };
  if (typeof body.transactionId !== "string" || body.transactionId.length < 8) throw new Error("FACILITATOR_TRANSACTION_ID_MISSING");
  return { paymentPayload: paymentPayloadSchema.parse(body.paymentPayload), transactionId: body.transactionId };
}

export class X402SubmissionUnknownError extends Error {
  constructor() {
    super("X402_SUBMISSION_UNKNOWN");
  }
}

export async function fulfillX402Resource(
  resourceUrl: string,
  requirement: PaymentRequirement,
  paymentPayload: z.infer<typeof paymentPayloadSchema>,
) {
  let response: Response;
  try {
    response = await fetch(resourceUrl, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: {
        accept: "application/json",
        "payment-signature": JSON.stringify(paymentPayload),
        "payment-requirements": JSON.stringify(requirement),
      },
    });
  } catch {
    throw new X402SubmissionUnknownError();
  }
  const text = await boundedText(response, MAX_FULFILLMENT_BYTES);
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* retain text */ }
  if (!response.ok) {
    const code = typeof body === "object" && body && "code" in body ? String((body as { code: unknown }).code) : `HTTP_${response.status}`;
    throw new Error(`RESOURCE_FULFILLMENT_${code}`);
  }
  const paymentResponseHeader = response.headers.get("payment-response");
  let paymentResponse: { transactionId?: string; transaction?: string; network?: string } = {};
  if (paymentResponseHeader) {
    try { paymentResponse = JSON.parse(paymentResponseHeader); } catch { throw new Error("PAYMENT_RESPONSE_INVALID"); }
  }
  const nestedTransaction = typeof body === "object" && body && "settled" in body
    ? (body as { settled?: { transactionId?: string } }).settled?.transactionId
    : undefined;
  const transactionId = paymentResponse.transactionId ?? paymentResponse.transaction ?? nestedTransaction;
  if (!transactionId) throw new Error("SETTLEMENT_EVIDENCE_MISSING");
  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  return {
    body,
    transactionId,
    network: paymentResponse.network ?? requirement.network,
    contentType,
    contentBytes: Buffer.byteLength(text),
    contentHash: createHash("sha256").update(text).digest("hex"),
  };
}
