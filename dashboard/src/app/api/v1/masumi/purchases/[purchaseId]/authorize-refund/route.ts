import { authorizeEscrowRefundDurably } from "@/domain/masumi-refund-mutation-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before authorizing a refund.");
    if (!workspaceHasRole(workspace, ["OWNER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Owner or Provider Admin access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before authorizing an escrow refund.");
    const { purchaseId } = await params;
    return ok(await authorizeEscrowRefundDurably(purchaseId, workspace.organization.id, workspace.user.id), { status: 202 });
  } catch (error) { return handleApiError(error); }
}
