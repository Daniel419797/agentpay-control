import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ name: z.string().min(2).max(100), timezone: z.string().min(1).max(80).optional() });

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    return workspace ? ok(workspace.organization) : problem(401, "AUTH_REQUIRED", "Sign in before viewing the organization.");
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before updating the organization.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing organization security settings.");
    return ok(await db.organization.update({ where: { id: workspace.organization.id }, data: schema.parse(await boundedJson(request)) }));
  } catch (error) {
    return handleApiError(error);
  }
}
