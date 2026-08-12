import { triggerAutomation } from "@/domain/automation-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, context: { params: Promise<{ ruleId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before executing an automation.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before manually executing an autonomous rule.");
    const key = request.headers.get("idempotency-key");
    if (!key || key.length < 8 || key.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
    const { ruleId } = await context.params;
    return ok(await triggerAutomation(ruleId, workspace.organization.id, key, { type: "MANUAL", actorId: workspace.user.id }, workspace.user.id), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
