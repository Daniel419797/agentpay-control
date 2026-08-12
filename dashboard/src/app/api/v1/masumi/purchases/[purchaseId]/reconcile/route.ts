import { reconcileMasumiEscrowPurchase } from "@/domain/masumi-escrow-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before reconciling a Masumi purchase.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "APPROVER"])) return problem(403, "ROLE_REQUIRED", "Owner, Operator, or Approver access is required.");
    const { purchaseId } = await params;
    const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MasumiEscrowPurchase" WHERE "id"=${purchaseId}::uuid AND "organizationId"=${workspace.organization.id}::uuid LIMIT 1`;
    if (!rows[0]) return problem(404, "MASUMI_ESCROW_NOT_FOUND", "Masumi escrow purchase not found in this workspace.");
    return ok(await reconcileMasumiEscrowPurchase(purchaseId));
  } catch (error) { return handleApiError(error); }
}
