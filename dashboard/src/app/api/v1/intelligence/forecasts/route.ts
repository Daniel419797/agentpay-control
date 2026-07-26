import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try { const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing forecasts."); const url = new URL(request.url); const horizon = Number(url.searchParams.get("horizon") ?? 30); if (![7, 30, 90].includes(horizon)) return problem(422, "INVALID_HORIZON", "Forecast horizon must be 7, 30, or 90 days."); return ok(await db.spendForecast.findMany({ where: { organizationId: workspace.organization.id, horizonDays: horizon }, orderBy: { generatedAt: "desc" }, take: 100 })); } catch (error) { return handleApiError(error); }
}
