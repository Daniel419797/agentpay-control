import { z } from "zod";
import { applyBudgetRecommendation } from "@/domain/financial-intelligence-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ action: z.enum(["ACCEPT", "DISMISS"]) });
export async function PATCH(request: Request, context: { params: Promise<{ recommendationId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before updating recommendations.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "OWNER_REQUIRED", "Only an owner may accept or dismiss a budget recommendation.");
    const { recommendationId } = await context.params; const input = schema.parse(await boundedJson(request));
    if (input.action === "ACCEPT") return ok({ draftPolicy: await applyBudgetRecommendation(workspace.organization.id, recommendationId, workspace.user.id) });
    await db.$transaction(async (tx) => {
      const result = await tx.budgetRecommendation.updateMany({ where: { id: recommendationId, organizationId: workspace.organization.id, status: "OPEN" }, data: { status: "DISMISSED" } });
      if (!result.count) throw new Error("RECOMMENDATION_NOT_FOUND");
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "BUDGET_RECOMMENDATION_DISMISSED", targetType: "BUDGET_RECOMMENDATION", targetId: recommendationId, result: "SUCCESS", metadata: {} } });
    });
    return ok({ id: recommendationId, status: "DISMISSED" });
  } catch (error) {
    if (error instanceof Error && ["RECOMMENDATION_NOT_FOUND", "EFFECTIVE_POLICY_REQUIRED"].includes(error.message)) return problem(409, error.message, error.message === "RECOMMENDATION_NOT_FOUND" ? "The recommendation is no longer open." : "The agent needs a published policy before a draft can be created.");
    return handleApiError(error);
  }
}
