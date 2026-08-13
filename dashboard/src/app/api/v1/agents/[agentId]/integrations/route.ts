import { handleApiError, ok, problem } from "@/lib/api";
import { INTEGRATION_CREDENTIAL_PREFIX, parseIntegrationCredentialLabel } from "@/lib/agent-integration";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

function statusFor(credential: { status: string; expiresAt: Date | null; lastUsedAt: Date | null }) {
  if (credential.status === "REVOKED") return "REVOKED";
  if (credential.status === "EXPIRED" || (credential.expiresAt && credential.expiresAt <= new Date())) return "EXPIRED";
  return credential.lastUsedAt ? "CONNECTED" : "READY";
}

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing AI connections.");
    const { agentId } = await params;
    const agent = await db.agent.findFirst({
      where: { id: agentId, organizationId: workspace.organization.id },
      select: { id: true, effectivePolicyId: true, status: true },
    });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");

    const credentials = await db.agentCredential.findMany({
      where: { agentId, label: { startsWith: INTEGRATION_CREDENTIAL_PREFIX } },
      select: { id: true, label: true, prefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    return ok({
      canConnect: agent.status === "ACTIVE" && Boolean(agent.effectivePolicyId) && !workspace.organization.killSwitchEnabled,
      blockingReasons: [
        ...(agent.status === "ACTIVE" ? [] : ["AGENT_NOT_ACTIVE"]),
        ...(agent.effectivePolicyId ? [] : ["POLICY_NOT_PUBLISHED"]),
        ...(workspace.organization.killSwitchEnabled ? ["ORGANIZATION_KILL_SWITCH_ENABLED"] : []),
      ],
      integrations: credentials.flatMap((credential) => {
        const parsed = parseIntegrationCredentialLabel(credential.label);
        return parsed ? [{
          id: credential.id,
          type: parsed.type,
          name: parsed.name,
          prefix: credential.prefix,
          scopes: credential.scopes,
          status: statusFor(credential),
          credentialStatus: credential.status,
          expiresAt: credential.expiresAt,
          lastUsedAt: credential.lastUsedAt,
          revokedAt: credential.revokedAt,
          createdAt: credential.createdAt,
        }] : [];
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
