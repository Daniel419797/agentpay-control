import { z } from "zod";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]), expectedVersion: z.number().int().positive() });

export async function PATCH(request: Request, context: { params: Promise<{ ruleId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing an automation.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required to activate automation.");
    const { ruleId } = await context.params;
    const input = schema.parse(await boundedJson(request));
    if (input.status === "ACTIVE") {
      if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before activating an autonomous rule.");
      const organization = await db.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
      if (!organization || organization.status !== "ACTIVE") return problem(409, "ORGANIZATION_NOT_ACTIVE", "The organization is not active.");
      if (organization.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The emergency stop must be cleared before an automation can be activated.");
    }
    const changed = await db.automationRule.updateMany({ where: { id: ruleId, organizationId: workspace.organization.id, version: input.expectedVersion, status: { not: "ARCHIVED" } }, data: { status: input.status, version: { increment: 1 } } });
    if (changed.count !== 1) return problem(409, "AUTOMATION_VERSION_CONFLICT", "The automation changed or is archived.");
    return ok(await db.automationRule.findUniqueOrThrow({ where: { id: ruleId }, select: { id: true, status: true, version: true, nextRunAt: true } }));
  } catch (error) { return handleApiError(error); }
}
