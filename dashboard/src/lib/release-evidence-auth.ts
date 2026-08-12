import { timingSafeEqual } from "node:crypto";

export function releaseEvidenceAuthErrors(env: NodeJS.ProcessEnv = process.env) {
  if (env.CATALYST_PRODUCTION_ENABLED !== "true") return [];
  const secret = env.RELEASE_EVIDENCE_API_KEY ?? "";
  if (secret.length < 32) return ["RELEASE_EVIDENCE_API_KEY"];
  if ([env.CRON_SECRET, env.CARDANO_SETTLEMENT_STORE_API_KEY, env.MASUMI_PAYMENT_API_KEY, env.MASUMI_REGISTRY_API_KEY].filter(Boolean).includes(secret)) return ["RELEASE_EVIDENCE_API_KEY must be capability-isolated"];
  return [];
}

export function authorizeReleaseEvidenceRequest(request: Request, env: NodeJS.ProcessEnv = process.env) {
  const expected = env.RELEASE_EVIDENCE_API_KEY;
  const header = request.headers.get("authorization");
  if (!expected || expected.length < 32 || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}
