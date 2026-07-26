import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing financial intelligence.");
    const organizationId = workspace.organization.id;
    const [run, forecasts, anomalies, recommendations] = await Promise.all([
      db.intelligenceRun.findFirst({ where: { organizationId }, orderBy: { startedAt: "desc" } }),
      db.spendForecast.findMany({ where: { organizationId, horizonDays: 30 }, orderBy: { generatedAt: "desc" }, take: 20 }),
      db.financialAnomaly.findMany({ where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: { detectedAt: "desc" }, take: 20 }),
      db.budgetRecommendation.findMany({ where: { organizationId, status: "OPEN" }, include: { agent: { select: { name: true } }, asset: { select: { symbol: true, decimals: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    ]);
    return ok({ run, forecasts, anomalies, recommendations });
  } catch (error) { return handleApiError(error); }
}
