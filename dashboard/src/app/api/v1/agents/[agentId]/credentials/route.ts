import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  label: z.string().min(2).max(80),
  scopes: z.array(z.enum(["payments:create", "payments:read", "resources:read"])).min(1),
  expiresAt: z.string().datetime().optional(),
});

async function authorizedAgent(request: Request, agentId: string) {
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return null;
  if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return false;
  return db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id }, select: { id: true } });
}

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const agent = await authorizedAgent(request, agentId);
    if (agent === null) return problem(401, "AUTH_REQUIRED", "Sign in before viewing credentials.");
    if (agent === false) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
    return ok(await db.agentCredential.findMany({ where: { agentId }, select: { id: true, label: true, prefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, createdAt: true } }));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before creating credentials.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before creating an agent credential.");
    const agent = await db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id }, select: { id: true } });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
    const input = schema.parse(await boundedJson(request));
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) return problem(422, "EXPIRY_INVALID", "Credential expiry must be in the future.");
    const environmentPrefix = getConfig().APP_ENV === "production" ? "ap_live_" : "ap_test_";
    const secret = `${environmentPrefix}${randomBytes(24).toString("base64url")}`;
    const prefix = secret.slice(0, 14);
    const credential = await db.$transaction(async (tx) => {
      const created = await tx.agentCredential.create({ data: { agentId, label: input.label, prefix, secretHash: createHash("sha256").update(secret).digest("hex"), scopes: input.scopes, expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "AGENT_CREDENTIAL_CREATED", targetType: "AGENT_CREDENTIAL", targetId: created.id, result: "SUCCESS", metadata: { agentId, prefix, scopes: created.scopes } } });
      await tx.outboxEvent.create({ data: { organizationId: workspace.organization.id, eventType: "AGENT_CREDENTIAL_CREATED", aggregateType: "AGENT_CREDENTIAL", aggregateId: created.id, payload: { agentId, prefix, label: created.label } } });
      return created;
    });
    return ok({ id: credential.id, label: credential.label, prefix, scopes: credential.scopes, secret, warning: "This secret is shown once." }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
