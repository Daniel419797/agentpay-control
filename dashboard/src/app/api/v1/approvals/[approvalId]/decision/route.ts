import { z } from "zod";

import { executeAuthorizedPayment } from "@/domain/authorized-payment-executor";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";
import { retrySerializable } from "@/lib/retry";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(500).optional() });

function errorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? String(error.code) : undefined;
}

export async function POST(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before deciding an approval.");
    if (!workspaceHasRole(workspace, ["OWNER", "APPROVER"])) return problem(403, "ROLE_REQUIRED", "Owner or Approver access is required.");
    const { approvalId } = await params;
    const input = schema.parse(await boundedJson(request));

    const result = await retrySerializable(() => db.$transaction(async (tx) => {
      const approval = await tx.approvalRequest.findFirst({
        where: { id: approvalId, paymentIntent: { organizationId: workspace.organization.id } },
        include: { paymentIntent: true },
      });
      if (!approval) return { kind: "NOT_FOUND" as const };
      if (approval.status !== "PENDING" || approval.expiresAt <= new Date()) return { kind: "NOT_PENDING" as const };

      const initiators = await tx.auditEvent.findMany({
        where: { organizationId: workspace.organization.id, action: "PAYMENT_REQUEST_INITIATED", targetType: "PAYMENT_INTENT", targetId: approval.paymentIntentId, result: "SUCCESS" },
        orderBy: { occurredAt: "asc" }, take: 2, select: { actorType: true, actorId: true },
      });
      if (initiators.length !== 1 || !initiators[0]?.actorId) {
        await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "PAYMENT_APPROVAL_INITIATOR_EVIDENCE_DENIED", targetType: "APPROVAL_REQUEST", targetId: approval.id, result: "DENIED", metadata: { paymentIntentId: approval.paymentIntentId, initiatorEvidenceCount: initiators.length } } });
        return { kind: "INITIATOR_EVIDENCE_MISSING" as const };
      }

      const initiator = initiators[0];
      if (input.decision === "APPROVE" && initiator.actorType === "USER" && initiator.actorId === workspace.user.id) {
        await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "PAYMENT_APPROVAL_SELF_DENIED", targetType: "APPROVAL_REQUEST", targetId: approval.id, result: "DENIED", metadata: { paymentIntentId: approval.paymentIntentId } } });
        return { kind: "SELF_APPROVAL_FORBIDDEN" as const };
      }

      await tx.approvalDecision.create({ data: { approvalRequestId: approval.id, userId: workspace.user.id, decision: input.decision, note: input.note } });
      const grouped = await tx.approvalDecision.groupBy({ by: ["decision"], where: { approvalRequestId: approval.id }, _count: { _all: true } });
      const approvals = grouped.find((row) => row.decision === "APPROVE")?._count._all ?? 0;
      const rejections = grouped.find((row) => row.decision === "REJECT")?._count._all ?? 0;
      let status: "PENDING" | "REJECTED" | "CONSUMED" = "PENDING";

      if (rejections >= approval.requiredRejections) {
        const stopped = await tx.paymentIntent.updateMany({ where: { id: approval.paymentIntentId, status: "APPROVAL_PENDING" }, data: { status: "REJECTED" } });
        if (stopped.count !== 1) throw new Error("APPROVAL_INTENT_STATE_INVALID");
        await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: "REJECTED", decidedAt: new Date(), decidedBy: workspace.user.id, decisionNote: input.note } });
        await tx.spendReservation.updateMany({ where: { paymentIntentId: approval.paymentIntentId, status: "ACTIVE" }, data: { status: "RELEASED" } });
        status = "REJECTED";
      } else if (approvals >= approval.requiredApprovals) {
        const authorized = await tx.paymentIntent.updateMany({ where: { id: approval.paymentIntentId, status: "APPROVAL_PENDING" }, data: { status: "AUTHORIZED" } });
        if (authorized.count !== 1) throw new Error("APPROVAL_INTENT_STATE_INVALID");
        await tx.approvalRequest.update({ where: { id: approval.id }, data: { status: "CONSUMED", decidedAt: new Date(), decidedBy: workspace.user.id, decisionNote: input.note } });
        status = "CONSUMED";
      }

      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: `PAYMENT_APPROVAL_${input.decision}`, targetType: "APPROVAL_REQUEST", targetId: approval.id, result: "SUCCESS", metadata: { approvals, rejections, requiredApprovals: approval.requiredApprovals, requiredRejections: approval.requiredRejections, status } } });
      return { kind: "DECIDED" as const, paymentIntentId: approval.paymentIntentId, status, approvals, rejections, requiredApprovals: approval.requiredApprovals, requiredRejections: approval.requiredRejections };
    }, { isolationLevel: "Serializable" }));

    if (result.kind === "NOT_FOUND") return problem(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    if (result.kind === "NOT_PENDING") return problem(409, "APPROVAL_NOT_PENDING", "Approval is no longer pending.");
    if (result.kind === "INITIATOR_EVIDENCE_MISSING") return problem(409, "APPROVAL_INITIATOR_EVIDENCE_MISSING", "This approval cannot be decided because its immutable initiator evidence is missing or inconsistent. Cancel and recreate the payment request.");
    if (result.kind === "SELF_APPROVAL_FORBIDDEN") return problem(403, "APPROVAL_SEPARATION_REQUIRED", "The operator who initiated this payment cannot approve it. A different Owner or Approver must review the request.");
    if (result.status === "CONSUMED") return ok(await executeAuthorizedPayment(result.paymentIntentId));
    return ok(result);
  } catch (error) {
    if (errorCode(error) === "P2002") return problem(409, "APPROVAL_ALREADY_DECIDED", "You have already voted on this approval.");
    if (errorCode(error) === "P2034") return problem(409, "APPROVAL_CONCURRENT_UPDATE", "Another approval vote was recorded. Retry with the latest state.");
    if (error instanceof Error && ["PAYMENT_QUOTE_EXPIRED", "SPEND_RESERVATION_INVALID", "POLICY_CHANGED", "POLICY_NOT_ACTIVE", "POLICY_EXPIRED", "OUTSIDE_POLICY_SCHEDULE"].includes(error.message)) return problem(409, error.message, error.message.replaceAll("_", " "));
    return handleApiError(error);
  }
}
