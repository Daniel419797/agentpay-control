import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing audit events.");
    return ok(await db.auditEvent.findMany({
      where: { organizationId: workspace.organization.id },
      orderBy: { occurredAt: "desc" },
      take: 100,
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
