import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing audit events.");
    if (!workspaceHasRole(workspace, ["OWNER", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Owner or Viewer access is required.");
    return ok(await db.auditEvent.findMany({
      where: { organizationId: workspace.organization.id },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
