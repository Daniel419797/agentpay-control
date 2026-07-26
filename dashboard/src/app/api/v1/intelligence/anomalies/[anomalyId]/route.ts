import { z } from "zod";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ status: z.enum(["ACKNOWLEDGED", "RESOLVED", "DISMISSED"]) });
export async function PATCH(request: Request, context: { params: Promise<{ anomalyId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before updating anomalies.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const { anomalyId } = await context.params; const input = schema.parse(await boundedJson(request));
    const anomaly = await db.$transaction(async (tx) => {
      const existing = await tx.financialAnomaly.findFirst({ where: { id: anomalyId, organizationId: workspace.organization.id } });
      if (!existing) throw new Error("ANOMALY_NOT_FOUND");
      const now = new Date();
      const updated = await tx.financialAnomaly.update({ where: { id: anomalyId }, data: { status: input.status, acknowledgedAt: input.status === "ACKNOWLEDGED" ? now : existing.acknowledgedAt, resolvedAt: input.status === "RESOLVED" ? now : existing.resolvedAt } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "FINANCIAL_ANOMALY_STATUS_CHANGED", targetType: "FINANCIAL_ANOMALY", targetId: updated.id, result: "SUCCESS", metadata: { from: existing.status, to: input.status } } });
      return updated;
    });
    return ok(anomaly);
  } catch (error) {
    if (error instanceof Error && error.message === "ANOMALY_NOT_FOUND") return problem(404, error.message, "The anomaly was not found.");
    return handleApiError(error);
  }
}
