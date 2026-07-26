import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) { try { const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing recommendations."); return ok(await db.budgetRecommendation.findMany({ where: { organizationId: workspace.organization.id }, include: { agent: { select: { name: true } }, asset: { select: { symbol: true, decimals: true } } }, orderBy: { createdAt: "desc" }, take: 200 })); } catch (error) { return handleApiError(error); } }
