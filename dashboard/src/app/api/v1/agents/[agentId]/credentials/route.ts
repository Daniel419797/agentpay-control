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
    if (workspace.organization.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The emergency stop is active. New agent credentials are disabled.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before creating an agent credential.");
    const input = schema.parse(await boundedJson(request));
    const agent = await db.agent.findFirst({
      where: { id: agentId, organizationId: workspace.organization.id },
      select: {
        id: true,
        status: true,
        effectivePolicy: { select: { id: true, status: true } },
        accounts: { where: { status: "ACTIVE" }, take: 1, select: { id: true } },
      },
    });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
    if (input.scopes.includes("payments:create")) {
      if (agent.status !== "ACTIVE") return problem(409, "AGENT_NOT_ACTIVE", "Activate the agent before issuing a payment-capable credential.");
      if (!agent.accounts.length) return problem(409, "PAYMENT_ACCOUNT_UNAVAILABLE", "An active payment account is required before issuing a payment-capable credential.");
      if (!agent.effectivePolicy || agent.effectivePolicy.status !== "PUBLISHED") return problem(409, "POLICY_NOT_PUBLISHED", "Publish a spending policy before issuing a payment-capable credential.");
    }
    const operationState = await db.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
    if (!operationState || operationState.status !== "ACTIVE") return problem(409, "ORGANIZATION_NOT_ACTIVE", "The organization is not active.");
    if (operationState.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The emergency stop is active. New agent credentials are disabled.");
    if (input.expiresAt && new Date(input.expiresAt) <= new Date()) return problem(422, "EXPIRY_INVALID", "Credential expiry must be in the future.");
    const environmentPrefix = getConfig().APP_ENV === "production" ? "ap_live_" : "ap_test_";
    const secret = `${environmentPrefix}${randomBytes(24).toString("base64url")}`;
    const prefix = secret.slice(0, 24);
    const credential = await db.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
      if (!organization || organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
      if (organization.killSwitchEnabled) throw new Error("ORGANIZATION_KILL_SWITCH_ENABLED");
      if (input.scopes.includes("payments:create")) {
        const currentAgent = await tx.agent.findUnique({
          where: { id: agentId },
          select: { status: true, effectivePolicy: { select: { status: true } }, accounts: { where: { status: "ACTIVE" }, take: 1, select: { id: true } } },
        });
        if (!currentAgent || currentAgent.status !== "ACTIVE") throw new Error("AGENT_NOT_ACTIVE");
        if (!currentAgent.accounts.length) throw new Error("PAYMENT_ACCOUNT_UNAVAILABLE");
        if (!currentAgent.effectivePolicy || currentAgent.effectivePolicy.status !== "PUBLISHED") throw new Error("POLICY_NOT_PUBLISHED");
      }
      const created = await tx.agentCredential.create({ data: { agentId, label: input.label, prefix, secretHash: createHash("sha256").update(secret).digest("hex"), scopes: input.scopes, expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "AGENT_CREDENTIAL_CREATED", targetType: "AGENT_CREDENTIAL", targetId: created.id, result: "SUCCESS", metadata: { agentId, prefix, scopes: created.scopes } } });
      await tx.outboxEvent.create({ data: { organizationId: workspace.organization.id, eventType: "AGENT_CREDENTIAL_CREATED", aggregateType: "AGENT_CREDENTIAL", aggregateId: created.id, payload: { agentId, prefix, label: created.label } } });
      return created;
    });
    return ok({ id: credential.id, label: credential.label, prefix, scopes: credential.scopes, secret, warning: "This secret is shown once." }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "AGENT_NOT_ACTIVE") return problem(409, error.message, "The agent is not active.");
    if (error instanceof Error && error.message === "PAYMENT_ACCOUNT_UNAVAILABLE") return problem(409, error.message, "An active payment account is required.");
    if (error instanceof Error && error.message === "POLICY_NOT_PUBLISHED") return problem(409, error.message, "Publish a spending policy before issuing a payment-capable credential.");
    if (error instanceof Error && error.message === "ORGANIZATION_NOT_ACTIVE") return problem(409, error.message, "The organization is not active.");
    if (error instanceof Error && error.message === "ORGANIZATION_KILL_SWITCH_ENABLED") return problem(409, error.message, "The emergency stop is active.");
    return handleApiError(error);
  }
}
