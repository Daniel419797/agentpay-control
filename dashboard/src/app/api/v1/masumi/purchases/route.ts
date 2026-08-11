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
    let rateSubject: string;
    if (await authorizeAgentRequest(request, input.agentId, "payments:create")) {
      const agent = await db.agent.findUnique({ where: { id: input.agentId }, select: { organizationId: true, status: true } });
      if (!agent || agent.status === "ARCHIVED") return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
      organizationId = agent.organizationId;
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
    const status = typeof result === "object" && result && "status" in result && (result as { status?: string }).status === "APPROVAL_PENDING" ? 202 : 200;
    return ok(result, { status });
  } catch (error) { return handleApiError(error); }
}
