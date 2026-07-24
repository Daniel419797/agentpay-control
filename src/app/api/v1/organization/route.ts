import { z } from "zod";

import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

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
    return ok(await db.organization.update({ where: { id: workspace.organization.id }, data: schema.parse(await request.json()) }));
  } catch (error) {
    return handleApiError(error);
  }
}
