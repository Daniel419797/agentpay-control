import { z } from "zod";

import { prepareMasumiEscrowPayment } from "@/domain/masumi-escrow-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const createSchema = z.object({
  agentId: z.string().uuid(),
  resourceListingId: z.string().uuid(),
  inputData: z.unknown(),
  purpose: z.string().trim().max(500).optional(),
});

function serialize(row: Record<string, unknown>) {
  const safe = { ...row };
  delete safe.inputEncrypted;
  delete safe.providerEvidence;
  for (const [key, value] of Object.entries(safe)) if (typeof value === "bigint") safe[key] = value.toString();
  return safe;
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing Masumi escrow purchases.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "APPROVER", "VIEWER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Workspace access is required.");
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id","agentId","resourceListingId","paymentIntentId","network","agentIdentifier","jobId","blockchainIdentifier",
             "sellerAddress","paymentType","state","providerState","amounts","resultHash","resultVerifiedAt","refundRequestedAt",
             "refundAuthorizedAt","disputedAt","completedAt","lastReconciledAt","failureCode","createdAt","updatedAt"
      FROM "MasumiEscrowPurchase"
      WHERE "organizationId" = ${workspace.organization.id}::uuid
      ORDER BY "createdAt" DESC
      LIMIT 100
    `;
    return ok(rows.map(serialize));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before initiating a Masumi escrow purchase.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before initiating autonomous escrow spending.");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const input = createSchema.parse(await boundedJson(request, 256 * 1024));
    const result = await prepareMasumiEscrowPayment({
      organizationId: workspace.organization.id,
      agentId: input.agentId,
      resourceListingId: input.resourceListingId,
      idempotencyKey,
      inputData: input.inputData,
      purpose: input.purpose,
      initiatedByUserId: workspace.user.id,
    });
    return ok(result, { status: 202 });
  } catch (error) { return handleApiError(error); }
}
