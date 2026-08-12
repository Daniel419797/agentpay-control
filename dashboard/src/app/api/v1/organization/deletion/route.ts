import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ confirmSlug: z.string(), confirmation: z.literal("DELETE MY AGENTPAY WORKSPACE") });

export async function GET(request: Request) {
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing deletion requests.");
  if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
  return ok(await db.deletionRequest.findFirst({ where: { organizationId: workspace.organization.id }, orderBy: { requestedAt: "desc" } }));
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before requesting account deletion.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before requesting workspace deletion.");
    const input = schema.parse(await boundedJson(request));
    if (input.confirmSlug !== workspace.organization.slug) return problem(422, "DELETION_CONFIRMATION_INVALID", "The organization slug does not match.");
    const scheduledFor = new Date(Date.now() + 30 * 86_400_000);
    const deletion = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`organization-deletion:${workspace.organization.id}`}, 0))`;
      const organization = await tx.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
      if (!organization || organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
      const existing = await tx.deletionRequest.findFirst({ where: { organizationId: workspace.organization.id, status: { in: ["REQUESTED", "PROCESSING"] } } });
      if (existing) throw new Error("DELETION_ALREADY_REQUESTED");
      const activeAgents = await tx.agent.findMany({ where: { organizationId: workspace.organization.id, status: "ACTIVE" }, select: { id: true } });
      const row = await tx.deletionRequest.create({ data: { organizationId: workspace.organization.id, requestedBy: workspace.user.id, scheduledFor, previousKillSwitch: organization.killSwitchEnabled, snapshot: { activeAgentIds: activeAgents.map((agent) => agent.id) } } });
      await tx.organization.update({ where: { id: workspace.organization.id }, data: { killSwitchEnabled: true } });
      await tx.agent.updateMany({ where: { organizationId: workspace.organization.id, status: "ACTIVE" }, data: { status: "PAUSED" } });
      await tx.agentCredential.updateMany({ where: { agent: { organizationId: workspace.organization.id }, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
      await tx.notificationEndpoint.updateMany({ where: { organizationId: workspace.organization.id, status: "ACTIVE" }, data: { status: "PAUSED" } });
      await tx.paymentIntent.updateMany({ where: { organizationId: workspace.organization.id, status: { in: ["CREATED", "QUOTED", "APPROVAL_PENDING", "AUTHORIZED"] } }, data: { status: "CANCELED" } });
      await tx.spendReservation.updateMany({ where: { agent: { organizationId: workspace.organization.id }, status: "ACTIVE" }, data: { status: "RELEASED" } });
      await tx.approvalRequest.updateMany({ where: { paymentIntent: { organizationId: workspace.organization.id }, status: "PENDING" }, data: { status: "CANCELED", decidedAt: new Date(), decisionNote: "Organization deletion requested" } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "ORGANIZATION_DELETION_REQUESTED", targetType: "ORGANIZATION", targetId: workspace.organization.id, result: "SUCCESS", metadata: { scheduledFor: scheduledFor.toISOString() } } });
      if (workspace.user.email) await tx.outboxEvent.create({ data: { organizationId: workspace.organization.id, eventType: "ORGANIZATION_DELETION_REQUESTED", aggregateType: "ORGANIZATION", aggregateId: workspace.organization.id, directChannel: "EMAIL", directDestination: workspace.user.email, payload: { organizationName: workspace.organization.name, scheduledFor: scheduledFor.toISOString(), exportUrl: new URL("/api/v1/organization/export", request.url).toString() } } });
      return row;
    }, { isolationLevel: "Serializable" });
    return ok(deletion, { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "DELETION_ALREADY_REQUESTED") return problem(409, error.message, "A deletion request is already active.");
    if (error instanceof Error && error.message === "ORGANIZATION_NOT_ACTIVE") return problem(409, error.message, "The organization is not active.");
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before canceling account deletion.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before canceling workspace deletion and reactivating agents.");
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`organization-deletion:${workspace.organization.id}`}, 0))`;
      const deletion = await tx.deletionRequest.findFirst({ where: { organizationId: workspace.organization.id, status: "REQUESTED" }, orderBy: { requestedAt: "desc" } });
      if (!deletion) return null;
      const snapshot = deletion.snapshot as { activeAgentIds?: string[] };
      await tx.deletionRequest.update({ where: { id: deletion.id }, data: { status: "CANCELED", canceledAt: new Date() } });
      await tx.organization.update({ where: { id: workspace.organization.id }, data: { killSwitchEnabled: deletion.previousKillSwitch } });
      if (snapshot.activeAgentIds?.length) await tx.agent.updateMany({ where: { organizationId: workspace.organization.id, id: { in: snapshot.activeAgentIds }, status: "PAUSED" }, data: { status: "ACTIVE" } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "ORGANIZATION_DELETION_CANCELED", targetType: "ORGANIZATION", targetId: workspace.organization.id, result: "SUCCESS", metadata: { credentialsRequireReissue: true, notificationEndpointsRemainPaused: true } } });
      return deletion;
    }, { isolationLevel: "Serializable" });
    if (!result) return problem(404, "DELETION_REQUEST_NOT_FOUND", "No cancelable deletion request was found.");
    return ok({ status: "CANCELED", credentialsRequireReissue: true, notificationEndpointsRemainPaused: true });
  } catch (error) {
    return handleApiError(error);
  }
}
