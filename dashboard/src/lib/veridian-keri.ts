import { createHash } from "node:crypto";
import { z } from "zod";

const said = z.string().min(20).max(200);
const aid = z.string().min(20).max(200);
const acdcSchema = z.object({
  d: said,
  i: aid,
  s: said,
  a: z.object({ i: aid.optional() }).passthrough().optional(),
}).passthrough();

export type VerifiedKeriCredential = {
  credentialSaid: string;
  issuerAid: string;
  schemaSaid: string;
  subjectAid: string | null;
  claimsHash: string;
  verifiedAt: Date;
  expiresAt: Date | null;
  revoked: boolean;
  evidence: Record<string, unknown>;
};

export type VeridianKeriConfig = {
  verifyUrl: string;
  apiKey?: string;
  timeoutMs: number;
  trustedIssuerAids: string[];
  allowedSchemaSaids: string[];
};

function csv(value: string | undefined) {
  return [...new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean))];
}

export function veridianKeriConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VeridianKeriConfig {
  const verifyUrl = env.VERIDIAN_KERIA_CREDENTIAL_VERIFY_URL || "";
  const timeoutMs = Number(env.VERIDIAN_KERIA_TIMEOUT_MS || "10000");
  const trustedIssuerAids = csv(env.VERIDIAN_TRUSTED_ISSUER_AIDS);
  const allowedSchemaSaids = csv(env.VERIDIAN_ALLOWED_SCHEMA_SAIDS);
  if (!verifyUrl) throw new Error("VERIDIAN_KERIA_CREDENTIAL_VERIFY_URL_REQUIRED");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30000) throw new Error("VERIDIAN_KERIA_TIMEOUT_INVALID");
  if (env.APP_ENV === "production") {
    if (new URL(verifyUrl).protocol !== "https:") throw new Error("VERIDIAN_KERIA_HTTPS_REQUIRED");
    if (!trustedIssuerAids.length) throw new Error("VERIDIAN_TRUSTED_ISSUER_AIDS_REQUIRED");
    if (!allowedSchemaSaids.length) throw new Error("VERIDIAN_ALLOWED_SCHEMA_SAIDS_REQUIRED");
  }
  return { verifyUrl, apiKey: env.VERIDIAN_KERIA_API_KEY, timeoutMs, trustedIssuerAids, allowedSchemaSaids };
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function credentialFromInput(input: unknown) {
  if (typeof input === "string") {
    try { return acdcSchema.parse(JSON.parse(input)); }
    catch { throw new Error("VERIDIAN_ACDC_JSON_REQUIRED_FOR_POLICY_BINDING"); }
  }
  return acdcSchema.parse(input);
}

export async function verifyVeridianCredential(input: unknown, config: VeridianKeriConfig = veridianKeriConfigFromEnv()): Promise<VerifiedKeriCredential> {
  const credential = credentialFromInput(input);
  const response = await fetch(config.verifyUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify(credential),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`VERIDIAN_KERIA_VERIFY_${response.status}`);
  // KERIA's credential verification endpoint is the cryptographic authority. We
  // deliberately do not reimplement KERI/ACDC/CESR cryptography in AgentPay.
  if (body && typeof body === "object" && "verified" in body && (body as { verified?: unknown }).verified !== true) throw new Error("VERIDIAN_CREDENTIAL_NOT_VERIFIED");
  if (config.trustedIssuerAids.length && !config.trustedIssuerAids.includes(credential.i)) throw new Error("VERIDIAN_ISSUER_NOT_TRUSTED");
  if (config.allowedSchemaSaids.length && !config.allowedSchemaSaids.includes(credential.s)) throw new Error("VERIDIAN_SCHEMA_NOT_ALLOWED");
  const evidence = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const revoked = evidence.revoked === true || evidence.status === "revoked";
  if (revoked) throw new Error("VERIDIAN_CREDENTIAL_REVOKED");
  const expiresRaw = typeof evidence.expiresAt === "string" ? evidence.expiresAt : null;
  const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
  if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) throw new Error("VERIDIAN_CREDENTIAL_EXPIRED");
  return {
    credentialSaid: credential.d,
    issuerAid: credential.i,
    schemaSaid: credential.s,
    subjectAid: credential.a?.i ?? null,
    claimsHash: createHash("sha256").update(stable(credential)).digest("hex"),
    verifiedAt: new Date(),
    expiresAt,
    revoked: false,
    evidence,
  };
}

export function veridianReadinessErrors(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.VERIDIAN_IDENTITY_ENABLED !== "true") return [];
  try { veridianKeriConfigFromEnv(env); return []; }
  catch (error) { return [error instanceof Error ? error.message : "VERIDIAN_CONFIG_INVALID"]; }
}
