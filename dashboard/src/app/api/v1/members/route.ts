import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";
import { assertPlanLimit } from "@/domain/entitlement-service";

const roles = z.enum(["OWNER", "OPERATOR", "APPROVER", "VIEWER", "PROVIDER_ADMIN"]);
const inviteSchema = z.object({ email: z.string().email(), roles: z.array(roles).min(1).max(5) });

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing members.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Member access is required.");
    return ok(await db.membership.findMany({ where: { organizationId: workspace.organization.id }, include: { user: { select: { id: true, email: true, displayName: true, createdAt: true } } }, orderBy: { invitedAt: "desc" } }));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before inviting members.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before granting organization access.");
    const input = inviteSchema.parse(await boundedJson(request));
    const email = input.email.toLowerCase();
    const result = await db.$transaction(async (tx) => {
      await assertPlanLimit(tx, workspace.organization.id, "MEMBERS");
      const user = await tx.user.upsert({ where: { email }, update: {}, create: { email, displayName: email.split("@")[0] } });
      const existing = await tx.membership.findUnique({ where: { organizationId_userId: { organizationId: workspace.organization.id, userId: user.id } } });
      if (existing?.status === "ACTIVE") return { conflict: true as const };
      const membership = existing
        ? await tx.membership.update({ where: { id: existing.id }, data: { roles: [...new Set(input.roles)], status: "INVITED", invitedAt: new Date(), activatedAt: null, suspendedAt: null } })
        : await tx.membership.create({ data: { organizationId: workspace.organization.id, userId: user.id, roles: [...new Set(input.roles)], status: "INVITED" } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "MEMBER_INVITED", targetType: "MEMBERSHIP", targetId: membership.id, result: "SUCCESS", metadata: { roles: membership.roles } } });
      await tx.outboxEvent.create({ data: { organizationId: workspace.organization.id, eventType: "ORG_MEMBER_INVITED", aggregateType: "MEMBERSHIP", aggregateId: membership.id, directChannel: "EMAIL", directDestination: email, payload: { organizationName: workspace.organization.name, invitedBy: workspace.user.displayName, roles: membership.roles, signInUrl: new URL("/sign-in", request.url).toString() } } });
      return { conflict: false as const, membership };
    });
    if (result.conflict) return problem(409, "MEMBER_ALREADY_ACTIVE", "This user is already an active member.");
    return ok(result.membership, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_MEMBERS_LIMIT_REACHED") return problem(402, error.message, "Your plan's member limit has been reached.");
    return handleApiError(error);
  }
}
