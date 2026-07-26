import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ agentId: string; credentialId: string }> },
) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before revoking credentials.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before revoking an agent credential.");
    const { agentId, credentialId } = await params;
    const credential = await db.agentCredential.findFirst({
      where: { id: credentialId, agentId, agent: { organizationId: workspace.organization.id } },
    });
    if (!credential) return problem(404, "CREDENTIAL_NOT_FOUND", "Credential not found.");
    if (credential.status === "REVOKED") return ok({ id: credential.id, status: credential.status });
    const revokedAt = new Date();
    const [revoked] = await db.$transaction([
      db.agentCredential.update({
        where: { id: credential.id },
        data: { status: "REVOKED", revokedAt },
        select: { id: true, label: true, prefix: true, status: true, revokedAt: true },
      }),
      db.auditEvent.create({
        data: {
          organizationId: workspace.organization.id,
          actorType: "USER",
          actorId: workspace.user.id,
          action: "AGENT_CREDENTIAL_REVOKED",
          targetType: "AGENT_CREDENTIAL",
          targetId: credential.id,
          result: "SUCCESS",
          metadata: { agentId, prefix: credential.prefix },
        },
      }),
      db.outboxEvent.create({
        data: {
          organizationId: workspace.organization.id,
          eventType: "AGENT_CREDENTIAL_REVOKED",
          aggregateType: "AGENT_CREDENTIAL",
          aggregateId: credential.id,
          payload: { agentId, prefix: credential.prefix },
        },
      }),
    ]);
    return ok(revoked);
  } catch (error) {
    return handleApiError(error);
  }
}
