import { z } from "zod";

import { executeAuthorizedIntent } from "@/domain/payment-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const schema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().max(500).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ approvalId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before deciding an approval.");
    const { approvalId } = await params;
    const input = schema.parse(await request.json());
    const approval = await db.approvalRequest.findFirst({
      where: { id: approvalId, paymentIntent: { organizationId: workspace.organization.id } },
      include: { paymentIntent: true },
    });
    if (!approval) return problem(404, "APPROVAL_NOT_FOUND", "Approval not found.");
    if (approval.status !== "PENDING" || approval.expiresAt <= new Date()) return problem(409, "APPROVAL_NOT_PENDING", "Approval is no longer pending.");
    if (input.decision === "REJECT") {
      await db.$transaction([
        db.approvalRequest.update({ where: { id: approvalId }, data: { status: "REJECTED", decidedAt: new Date(), decidedBy: workspace.user.id, decisionNote: input.note } }),
        db.paymentIntent.update({ where: { id: approval.paymentIntentId }, data: { status: "REJECTED" } }),
        db.spendReservation.updateMany({ where: { paymentIntentId: approval.paymentIntentId }, data: { status: "RELEASED" } }),
      ]);
      return ok({ status: "REJECTED" });
    }
    await db.$transaction([
      db.approvalRequest.update({ where: { id: approvalId }, data: { status: "CONSUMED", decidedAt: new Date(), decidedBy: workspace.user.id, decisionNote: input.note } }),
      db.paymentIntent.update({ where: { id: approval.paymentIntentId }, data: { status: "AUTHORIZED" } }),
    ]);
    return ok(await executeAuthorizedIntent(approval.paymentIntentId));
  } catch (error) {
    return handleApiError(error);
  }
}
