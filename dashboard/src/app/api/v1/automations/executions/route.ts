import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) { try { const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing automation executions."); return ok(await db.automationExecution.findMany({ where: { organizationId: workspace.organization.id }, include: { rule: { select: { id: true, name: true, actionType: true } }, decisions: { select: { userId: true, decision: true, note: true, createdAt: true } } }, orderBy: { createdAt: "desc" }, take: 100 })); } catch (error) { return handleApiError(error); } }
