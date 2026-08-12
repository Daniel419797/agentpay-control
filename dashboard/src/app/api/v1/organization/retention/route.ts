import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  auditDays: z.number().int().min(365).max(3650),
  financialRecordDays: z.number().int().min(365).max(3650),
  fulfillmentBodyDays: z.number().int().min(0).max(365),
  notificationDays: z.number().int().min(7).max(365),
});

export async function GET(request: Request) {
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing retention settings.");
  const policy = await db.dataRetentionPolicy.upsert({ where: { organizationId: workspace.organization.id }, update: {}, create: { organizationId: workspace.organization.id } });
  return ok(policy);
}

export async function PUT(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing retention settings.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing data-retention rules.");
    const input = schema.parse(await boundedJson(request));
    const policy = await db.$transaction(async (tx) => {
      const row = await tx.dataRetentionPolicy.upsert({ where: { organizationId: workspace.organization.id }, update: input, create: { organizationId: workspace.organization.id, ...input } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "RETENTION_POLICY_UPDATED", targetType: "ORGANIZATION", targetId: workspace.organization.id, result: "SUCCESS", metadata: input } });
      return row;
    });
    return ok(policy);
  } catch (error) {
    return handleApiError(error);
  }
}
