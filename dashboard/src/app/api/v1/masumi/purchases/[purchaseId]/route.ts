import { authorizeAgentRequest, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

function sanitize(row: Record<string, unknown>) {
  const safe = { ...row };
  delete safe.inputEncrypted;
  delete safe.providerEvidence;
  delete safe.requestHash;
  delete safe.identifierFromPurchaser;
  return safe;
}

export async function GET(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    const { purchaseId } = await params;
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "id","organizationId","agentId","resourceListingId","paymentIntentId","network","agentIdentifier","masumiPurchaseId","jobId","blockchainIdentifier","sellerAddress","paymentType","state","providerState","amounts","resultHash","resultVerifiedAt","refundRequestedAt","refundAuthorizedAt","disputedAt","completedAt","lastReconciledAt","failureCode","createdAt","updatedAt"
      FROM "MasumiEscrowPurchase" WHERE "id"=${purchaseId}::uuid LIMIT 1`;
    const purchase = rows[0];
    if (!purchase) return problem(404, "MASUMI_ESCROW_NOT_FOUND", "Masumi escrow purchase not found.");
    const agentId = String(purchase.agentId);
    if (await authorizeAgentRequest(request, agentId, "payments:create")) return ok(sanitize(purchase));
    const workspace = await workspaceFromRequest(request);
    if (!workspace || String(purchase.organizationId) !== workspace.organization.id) return problem(401, "UNAUTHORIZED", "A valid owner-agent credential or workspace session is required.");
    return ok(sanitize(purchase));
  } catch (error) { return handleApiError(error); }
}
