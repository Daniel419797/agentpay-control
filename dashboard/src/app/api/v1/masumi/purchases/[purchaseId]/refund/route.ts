import { requestEscrowRefund } from "@/domain/masumi-escrow-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before requesting a refund.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before requesting an escrow refund.");
    const { purchaseId } = await params;
    return ok(await requestEscrowRefund(purchaseId, workspace.organization.id), { status: 202 });
  } catch (error) { return handleApiError(error); }
}
