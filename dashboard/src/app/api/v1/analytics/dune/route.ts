import { handleApiError, ok, problem } from "@/lib/api";
import { fetchAgentPayDuneAnalytics } from "@/lib/dune";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing analytics.");
    if (process.env.DUNE_ANALYTICS_ENABLED !== "true") return problem(503, "DUNE_ANALYTICS_DISABLED", "Dune analytics are not enabled for this deployment.");
    const analytics = await fetchAgentPayDuneAnalytics();
    return ok({
      source: "DUNE",
      scope: "PUBLIC_CARDANO_CHAIN_ANALYTICS",
      organizationId: workspace.organization.id,
      ...analytics,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
