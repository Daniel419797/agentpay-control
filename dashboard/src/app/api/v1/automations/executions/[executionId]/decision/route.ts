import { z } from "zod";
import { automationApproverIsIndependent, executeAutomation } from "@/domain/automation-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(500).optional() });
export async function POST(request: Request, context: { params: Promise<{ executionId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before deciding an automation.");
    if (!workspaceHasRole(workspace, ["OWNER", "APPROVER"])) return problem(403, "ROLE_REQUIRED", "Owner or approver access is required.");
    const { executionId } = await context.params; const input = schema.parse(await boundedJson(request));
    const outcome = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`automation-execution:${executionId}`}, 0))`;
      const execution = await tx.automationExecution.findFirst({ where: { id: executionId, organizationId: workspace.organization.id, status: "AWAITING_APPROVAL" }, include: { rule: { select: { createdBy: true } } } });
      if (!execution) throw new Error("AUTOMATION_EXECUTION_NOT_AWAITING_APPROVAL");
      if (!automationApproverIsIndependent(execution.rule.createdBy, execution.triggeredByUserId, workspace.user.id)) throw new Error("AUTOMATION_SELF_APPROVAL_PROHIBITED");
      await tx.automationExecutionDecision.create({ data: { executionId, userId: workspace.user.id, decision: input.decision, note: input.note } });
      if (input.decision === "REJECT") return tx.automationExecution.update({ where: { id: execution.id }, data: { status: "CANCELED", errorCode: "APPROVAL_REJECTED", completedAt: new Date() } });
      const approvals = await tx.automationExecutionDecision.count({ where: { executionId, decision: "APPROVE" } });
      if (approvals >= execution.requiredApprovals) return tx.automationExecution.update({ where: { id: execution.id }, data: { status: "PENDING" } });
      return tx.automationExecution.findUniqueOrThrow({ where: { id: execution.id } });
    });
    return ok(outcome.status === "PENDING" ? await executeAutomation(outcome.id) : outcome);
  } catch (error) { if (error instanceof Error && error.message === "AUTOMATION_EXECUTION_NOT_AWAITING_APPROVAL") return problem(409, error.message, "This execution is not awaiting approval."); if (error instanceof Error && error.message === "AUTOMATION_SELF_APPROVAL_PROHIBITED") return problem(403, error.message, "The rule creator or manual trigger actor cannot approve this execution."); return handleApiError(error); }
}
