import { z } from "zod";

import { prepareMasumiEscrowPayment } from "@/domain/masumi-escrow-service";
import { authorizeAgentRequest, boundedJson, handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const createSchema = z.object({ agentId: z.string().uuid(), resourceListingId: z.string().uuid(), inputData: z.unknown(), purpose: z.string().trim().max(500).optional() });

function serialize(row: Record<string, unknown>) {
  const safe = { ...row }; delete safe.inputEncrypted; delete safe.providerEvidence;
  for (const [key, value] of Object.entries(safe)) if (typeof value === "bigint") safe[key] = value.toString();
  return safe;
}

function escrowProblem(error: Error) {
  if (error.message.startsWith("MASUMI_PAYMENT_PROVIDER_") || error.message.startsWith("MASUMI_PROVIDER_") || error.message.startsWith("MASUMI_PAYMENT_INFORMATION_") || error.message.startsWith("MASUMI_AGENT_START_") || error.message.startsWith("PYTH_PROVIDER_") || error.message.startsWith("VERIDIAN_KERIA_VERIFY_")) {
    return problem(503, "PAYMENT_TRUST_PROVIDER_UNAVAILABLE", "A payment-critical external provider is unavailable. No new spend was authorized.");
  }
  const status: Record<string, number> = {
    IDEMPOTENCY_CONFLICT: 409,
    AGENT_NOT_ACTIVE: 409,
    ORGANIZATION_NOT_ACTIVE: 409,
    ORGANIZATION_KILL_SWITCH_ENABLED: 409,
    POLICY_NOT_PUBLISHED: 409,
    RESOURCE_PROVIDER_NOT_VERIFIED: 409,
    MASUMI_RESOURCE_BINDING_REQUIRED: 409,
    MASUMI_AGENT_NOT_VERIFIED: 409,
    MASUMI_AGENT_AMBIGUOUS: 409,
    MASUMI_AGENT_OFFLINE: 409,
    MASUMI_RESOURCE_URL_MISMATCH: 409,
    MASUMI_SELLER_WALLET_NETWORK_MISMATCH: 409,
    MASUMI_SELLER_PAYMENT_KEY_MISMATCH: 409,
    MASUMI_PAYMENT_KEY_HASH_INVALID: 409,
    MASUMI_POLICY_ASSET_NOT_PRICED: 409,
    MASUMI_PRICE_AMBIGUOUS: 409,
    MASUMI_REPUTATION_HISTORY_INSUFFICIENT: 403,
    MASUMI_REPUTATION_BELOW_POLICY: 403,
    VERIDIAN_RESOURCE_IDENTITY_REQUIRED: 409,
    VERIDIAN_MASUMI_IDENTITY_MISMATCH: 409,
    VERIDIAN_ISSUER_NOT_TRUSTED: 403,
    VERIDIAN_SCHEMA_NOT_ALLOWED: 403,
    VERIDIAN_VERIFICATION_STALE: 409,
    VERIDIAN_CREDENTIAL_EXPIRED: 409,
    BALANCE_NOT_AVAILABLE: 503,
    PYTH_PRICE_STALE: 503,
    PYTH_PRICE_FROM_FUTURE: 503,
    PYTH_CONFIDENCE_TOO_WIDE: 503,
    PYTH_PRICE_NON_POSITIVE: 503,
    PYTH_ADA_USD_FEED_ID_REQUIRED: 503,
    PYTH_USDC_USD_FEED_ID_REQUIRED: 503,
    SPEND_RESERVATION_INVALID: 409,
    POLICY_CHANGED: 409,
  };
  return status[error.message] ? problem(status[error.message]!, error.message, error.message.replaceAll("_", " ").toLowerCase()) : null;
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing Masumi escrow purchases.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "APPROVER", "VIEWER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Workspace access is required.");
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id","agentId","resourceListingId","paymentIntentId","network","agentIdentifier","jobId","blockchainIdentifier","sellerAddress","paymentType","state","providerState","amounts","resultHash","resultVerifiedAt","refundRequestedAt","refundAuthorizedAt","disputedAt","completedAt","lastReconciledAt","failureCode","createdAt","updatedAt"
      FROM "MasumiEscrowPurchase" WHERE "organizationId" = ${workspace.organization.id}::uuid ORDER BY "createdAt" DESC LIMIT 100`;
    return ok(rows.map(serialize));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const input = createSchema.parse(await boundedJson(request, 256 * 1024));

    let organizationId: string;
    let initiatedByUserId: string | undefined;
    let agentInitiated = false;
    let rateSubject: string;
    if (await authorizeAgentRequest(request, input.agentId, "payments:create")) {
      const agent = await db.agent.findUnique({ where: { id: input.agentId }, select: { organizationId: true, status: true } });
      if (!agent || agent.status === "ARCHIVED") return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
      organizationId = agent.organizationId;
      agentInitiated = true;
      rateSubject = `agent:${input.agentId}`;
    } else {
      const workspace = await workspaceFromRequest(request);
      if (!workspace) return problem(401, "UNAUTHORIZED", "A valid agent credential or signed-in operator is required.");
      if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
      if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before initiating autonomous escrow spending.");
      const owned = await db.agent.findFirst({ where: { id: input.agentId, organizationId: workspace.organization.id, status: { not: "ARCHIVED" } }, select: { id: true } });
      if (!owned) return problem(404, "AGENT_NOT_FOUND", "Agent not found in the active workspace.");
      organizationId = workspace.organization.id;
      initiatedByUserId = workspace.user.id;
      rateSubject = `operator:${workspace.user.id}:${input.agentId}`;
    }

    const rate = await enforceRateLimit(request, { scope: "masumi-escrow-purchase", subject: rateSubject, limit: 30, windowMs: 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const result = await prepareMasumiEscrowPayment({ organizationId, agentId: input.agentId, resourceListingId: input.resourceListingId, idempotencyKey, inputData: input.inputData, purpose: input.purpose, initiatedByUserId });

    const paymentIntentId = typeof result === "object" && result && "id" in result && typeof (result as { id?: unknown }).id === "string"
      ? String((result as { id: string }).id)
      : typeof result === "object" && result && "paymentIntentId" in result && typeof (result as { paymentIntentId?: unknown }).paymentIntentId === "string"
        ? String((result as { paymentIntentId: string }).paymentIntentId)
        : undefined;
    if (agentInitiated && paymentIntentId) {
      const intent = await db.paymentIntent.findUnique({ where: { id: paymentIntentId }, select: { status: true } });
      if (intent?.status === "APPROVAL_PENDING") {
        await db.auditEvent.create({ data: { organizationId, actorType: "AGENT", actorId: input.agentId, action: "PAYMENT_REQUEST_INITIATED", targetType: "PAYMENT_INTENT", targetId: paymentIntentId, result: "SUCCESS", metadata: { scheme: "masumi-escrow", resourceListingId: input.resourceListingId, autonomous: true } } });
      }
    }

    const status = typeof result === "object" && result && "status" in result && (result as { status?: string }).status === "APPROVAL_PENDING" ? 202 : 200;
    return ok(result, { status });
  } catch (error) {
    if (error instanceof Error) {
      const mapped = escrowProblem(error);
      if (mapped) return mapped;
    }
    return handleApiError(error);
  }
}
