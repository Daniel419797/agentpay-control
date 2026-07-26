import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const schema = z.object({ title: z.string().min(4).max(120), description: z.string().min(10).max(5000), category: z.enum(["PAYMENT", "ACCOUNT", "INTEGRATION", "SECURITY", "BILLING", "OTHER"]), severity: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL") });

export async function GET(request: Request) {
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing support cases.");
  return ok(await db.supportCase.findMany({ where: { organizationId: workspace.organization.id }, include: { messages: { orderBy: { createdAt: "asc" } } }, orderBy: { updatedAt: "desc" }, take: 100 }));
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before opening a support case.");
    const input = schema.parse(await boundedJson(request));
    const supportCase = await db.$transaction(async (tx) => {
      const row = await tx.supportCase.create({ data: { organizationId: workspace.organization.id, createdBy: workspace.user.id, ...input } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "SUPPORT_CASE_OPENED", targetType: "SUPPORT_CASE", targetId: row.id, result: "SUCCESS", metadata: { category: row.category, severity: row.severity } } });
      await tx.outboxEvent.create({ data: { organizationId: workspace.organization.id, eventType: "SUPPORT_CASE_OPENED", aggregateType: "SUPPORT_CASE", aggregateId: row.id, payload: { title: row.title, category: row.category, severity: row.severity } } });
      return row;
    });
    return ok(supportCase, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
