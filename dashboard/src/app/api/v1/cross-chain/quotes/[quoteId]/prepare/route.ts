import { prepareCrossChainTransfer } from "@/domain/cross-chain-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, context: { params: Promise<{ quoteId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before preparing a transfer.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
    const { quoteId } = await context.params;
    return ok(await prepareCrossChainTransfer(quoteId, workspace.organization.id, idempotencyKey), { status: 201 });
  } catch (error) { return handleApiError(error); }
}
