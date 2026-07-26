import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const schema = z.object({ body: z.string().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: Promise<{ caseId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before replying to support.");
    const { caseId } = await params;
    const supportCase = await db.supportCase.findFirst({ where: { id: caseId, organizationId: workspace.organization.id } });
    if (!supportCase) return problem(404, "SUPPORT_CASE_NOT_FOUND", "Support case not found.");
    if (supportCase.status === "CLOSED") return problem(409, "SUPPORT_CASE_CLOSED", "This support case is closed.");
    const input = schema.parse(await boundedJson(request));
    const message = await db.$transaction(async (tx) => {
      const row = await tx.supportMessage.create({ data: { supportCaseId: supportCase.id, authorId: workspace.user.id, authorType: "CUSTOMER", body: input.body } });
      await tx.supportCase.update({ where: { id: supportCase.id }, data: { status: "OPEN" } });
      await tx.outboxEvent.create({ data: { organizationId: workspace.organization.id, eventType: "SUPPORT_CASE_REPLIED", aggregateType: "SUPPORT_CASE", aggregateId: supportCase.id, payload: { messageId: row.id } } });
      return row;
    });
    return ok(message, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
