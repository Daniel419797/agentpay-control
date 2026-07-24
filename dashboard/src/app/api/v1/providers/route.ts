import { z } from "zod";

import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const schema = z.object({
  name: z.string().min(2).max(100),
  settlementAccountId: z.string().regex(/^0\.0\.\d+$/),
  status: z.enum(["ACTIVE", "PAUSED", "UNAVAILABLE"]).default("ACTIVE"),
});

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before registering a provider.");
    return ok(await db.resourceProvider.create({
      data: { ...schema.parse(await request.json()), organizationId: workspace.organization.id },
    }), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
