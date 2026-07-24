import { z } from "zod";

import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const schema = z.object({ enabled: z.boolean(), reason: z.string().min(3).max(300) });

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing the kill switch.");
    const input = schema.parse(await request.json());
    const [organization] = await db.$transaction([
      db.organization.update({ where: { id: workspace.organization.id }, data: { killSwitchEnabled: input.enabled } }),
      db.auditEvent.create({
        data: {
          organizationId: workspace.organization.id,
          actorType: "USER",
          actorId: workspace.user.id,
          action: input.enabled ? "KILL_SWITCH_ENABLED" : "KILL_SWITCH_DISABLED",
          targetType: "ORGANIZATION",
          targetId: workspace.organization.id,
          result: "SUCCESS",
          metadata: { reason: input.reason },
        },
      }),
    ]);
    return ok(organization);
  } catch (error) {
    return handleApiError(error);
  }
}
