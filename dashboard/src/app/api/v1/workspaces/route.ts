import { z } from "zod";

import { boundedJson, handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sessionFromRequest } from "@/lib/session";
import { workspaceCookie } from "@/lib/workspace";

const switchSchema = z.object({ organizationId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before viewing workspaces.");
    const memberships = await db.membership.findMany({
      where: { userId: session.sub, status: "ACTIVE", organization: { status: "ACTIVE" } },
      select: {
        organizationId: true,
        roles: true,
        activatedAt: true,
        organization: { select: { name: true, slug: true, killSwitchEnabled: true } },
      },
      orderBy: [{ activatedAt: "asc" }, { invitedAt: "asc" }, { id: "asc" }],
    });
    return ok(memberships.map((membership) => ({
      id: membership.organizationId,
      name: membership.organization.name,
      slug: membership.organization.slug,
      roles: membership.roles,
      killSwitchEnabled: membership.organization.killSwitchEnabled,
    })));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before switching workspaces.");
    const rate = await enforceRateLimit(request, { scope: "workspace-switch", subject: session.sub, limit: 60, windowMs: 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const input = switchSchema.parse(await boundedJson(request));
    const membership = await db.membership.findFirst({
      where: { userId: session.sub, organizationId: input.organizationId, status: "ACTIVE", organization: { status: "ACTIVE" } },
      select: {
        organizationId: true,
        roles: true,
        organization: { select: { name: true, slug: true, killSwitchEnabled: true } },
      },
    });
    if (!membership) return problem(404, "WORKSPACE_NOT_FOUND", "The requested workspace is not available to this user.");
    return ok({
      id: membership.organizationId,
      name: membership.organization.name,
      slug: membership.organization.slug,
      roles: membership.roles,
      killSwitchEnabled: membership.organization.killSwitchEnabled,
    }, { headers: { "set-cookie": workspaceCookie(membership.organizationId) } });
  } catch (error) {
    return handleApiError(error);
  }
}
