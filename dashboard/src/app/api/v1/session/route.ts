import { handleApiError, ok, problem } from "@/lib/api";
import { sessionFromRequest } from "@/lib/session";
import { workspaceForSession } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before viewing the active session.");
    const workspace = await workspaceForSession(session);
    return ok({
      user: workspace.user,
      activeOrganization: workspace.organization,
      roles: workspace.membership.roles,
      mode: session.mode,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
