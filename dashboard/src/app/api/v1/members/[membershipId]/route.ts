import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const role = z.enum(["OWNER", "OPERATOR", "APPROVER", "VIEWER", "PROVIDER_ADMIN"]);
const schema = z.object({ roles: z.array(role).min(1).max(5).optional(), status: z.enum(["ACTIVE", "SUSPENDED"]).optional() }).refine((value) => value.roles || value.status, "No membership change supplied.");

export async function PATCH(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing members.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing organization access.");
    const { membershipId } = await params;
    const input = schema.parse(await boundedJson(request));
    const updated = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`membership-owner:${workspace.organization.id}`}, 0))`;
      const member = await tx.membership.findFirst({ where: { id: membershipId, organizationId: workspace.organization.id } });
      if (!member) throw new Error("MEMBERSHIP_NOT_FOUND");
      const removesOwner = member.roles.includes("OWNER") && (input.status === "SUSPENDED" || (input.roles && !input.roles.includes("OWNER")));
      if (removesOwner) {
        const ownerCount = await tx.membership.count({ where: { organizationId: workspace.organization.id, status: "ACTIVE", roles: { has: "OWNER" } } });
        if (ownerCount <= 1) throw new Error("LAST_OWNER_REQUIRED");
      }
      const row = await tx.membership.update({ where: { id: member.id }, data: { roles: input.roles ? [...new Set(input.roles)] : undefined, status: input.status, activatedAt: input.status === "ACTIVE" ? new Date() : undefined, suspendedAt: input.status === "SUSPENDED" ? new Date() : input.status === "ACTIVE" ? null : undefined } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: input.status === "SUSPENDED" ? "MEMBER_SUSPENDED" : "MEMBER_UPDATED", targetType: "MEMBERSHIP", targetId: member.id, result: "SUCCESS", metadata: { roles: row.roles, status: row.status } } });
      return row;
    });
    return ok(updated);
  } catch (error) {
    if (error instanceof Error && error.message === "MEMBERSHIP_NOT_FOUND") return problem(404, error.message, "Membership not found.");
    if (error instanceof Error && error.message === "LAST_OWNER_REQUIRED") return problem(409, error.message, "Promote another active owner before removing the last owner.");
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ membershipId: string }> }) {
  const clone = new Request(request.url, { method: "PATCH", headers: request.headers, body: JSON.stringify({ status: "SUSPENDED" }) });
  return PATCH(clone, { params });
}
