import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ confirmSlug: z.string(), confirmation: z.literal("DELETE MY AGENTPAY WORKSPACE") });

export async function GET(request: Request) {
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing deletion requests.");
  return ok(await db.deletionRequest.findFirst({ where: { organizationId: workspace.organization.id }, orderBy: { requestedAt: "desc" } }));
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before requesting account deletion.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    const input = schema.parse(await boundedJson(request));
    if (input.confirmSlug !== workspace.organization.slug) return problem(422, "DELETION_CONFIRMATION_INVALID", "The organization slug does not match.");
    const existing = await db.deletionRequest.findFirst({ where: { organizationId: workspace.organization.id, status: { in: ["REQUESTED", "PROCESSING"] } } });
    if (existing) return problem(409, "DELETION_ALREADY_REQUESTED", "A deletion request is already active.");
    const activeAgents = await db.agent.findMany({ where: { organizationId: workspace.organization.id, status: "ACTIVE" }, select: { id: true } });
    const scheduledFor = new Date(Date.now() + 30 * 86_400_000);
    const deletion = await db.$transaction(async (tx) => {
      const row = await tx.deletionRequest.create({ data: { organizationId: workspace.organization.id, requestedBy: workspace.user.id, scheduledFor, previousKillSwitch: workspace.organization.killSwitchEnabled, snapshot: { activeAgentIds: activeAgents.map((agent) => agent.id) } } });
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
    });
    return ok(deletion, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before canceling account deletion.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    const deletion = await db.deletionRequest.findFirst({ where: { organizationId: workspace.organization.id, status: "REQUESTED" }, orderBy: { requestedAt: "desc" } });
    if (!deletion) return problem(404, "DELETION_REQUEST_NOT_FOUND", "No cancelable deletion request was found.");
    const snapshot = deletion.snapshot as { activeAgentIds?: string[] };
    await db.$transaction(async (tx) => {
      await tx.deletionRequest.update({ where: { id: deletion.id }, data: { status: "CANCELED", canceledAt: new Date() } });
      await tx.organization.update({ where: { id: workspace.organization.id }, data: { killSwitchEnabled: deletion.previousKillSwitch } });
      if (snapshot.activeAgentIds?.length) await tx.agent.updateMany({ where: { organizationId: workspace.organization.id, id: { in: snapshot.activeAgentIds }, status: "PAUSED" }, data: { status: "ACTIVE" } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "ORGANIZATION_DELETION_CANCELED", targetType: "ORGANIZATION", targetId: workspace.organization.id, result: "SUCCESS", metadata: {} } });
    });
    return ok({ status: "CANCELED", credentialsRequireReissue: true, notificationEndpointsRemainPaused: true });
  } catch (error) {
    return handleApiError(error);
  }
}
