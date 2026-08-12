import { catalystProductMetrics } from "@/lib/catalyst-metrics";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing Catalyst metrics.");
    return ok(await catalystProductMetrics(workspace.organization.id));
  } catch (error) { return handleApiError(error); }
}
