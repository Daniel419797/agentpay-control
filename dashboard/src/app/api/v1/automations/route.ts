import { z } from "zod";
import { encryptAutomationAction, newWebhookSecret, validateAutomationAction, webhookSecretHash } from "@/domain/automation-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const triggerConfig = z.discriminatedUnion("type", [
  z.object({ type: z.literal("MANUAL") }),
  z.object({ type: z.literal("SCHEDULE"), intervalMinutes: z.number().int().min(1).max(10_080), firstRunAt: z.string().datetime().optional() }),
  z.object({ type: z.literal("BALANCE_THRESHOLD"), assetId: z.string().uuid(), comparison: z.enum(["BELOW", "ABOVE"]), amountAtomic: z.string().regex(/^\d+$/) }),
  z.object({ type: z.literal("INVOICE_EVENT"), status: z.enum(["SENT", "PAID", "OVERDUE"]) }),
  z.object({ type: z.literal("WEBHOOK") }),
]);
const schema = z.object({ agentId: z.string().uuid(), name: z.string().min(2).max(120), description: z.string().max(1_000).optional(), trigger: triggerConfig, actionType: z.enum(["CONTRACT_CALL", "X402_PAYMENT", "CREATE_INVOICE"]), action: z.unknown(), approvalThreshold: z.number().int().min(0).max(20).default(0), maxExecutionsPerDay: z.number().int().min(1).max(1_000).default(24) });

function safeTriggerConfig(triggerType: string, value: unknown) {
  if (triggerType === "WEBHOOK") return { type: "WEBHOOK", secretConfigured: true };
  return value;
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing automations.");
    const rules = await db.automationRule.findMany({ where: { organizationId: workspace.organization.id }, select: { id: true, agentId: true, name: true, description: true, status: true, triggerType: true, triggerConfig: true, actionType: true, approvalThreshold: true, maxExecutionsPerDay: true, nextRunAt: true, version: true, createdAt: true, updatedAt: true, _count: { select: { executions: true } } }, orderBy: { createdAt: "desc" } });
    return ok(rules.map((rule) => ({ ...rule, triggerConfig: safeTriggerConfig(rule.triggerType, rule.triggerConfig) })));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before creating an automation.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const input = schema.parse(await boundedJson(request));
    const agent = await db.agent.findFirst({ where: { id: input.agentId, organizationId: workspace.organization.id, status: "ACTIVE" } });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "An active agent was not found.");
    const action = await validateAutomationAction(workspace.organization.id, input.actionType, input.action);
    const webhookSecret = input.trigger.type === "WEBHOOK" ? newWebhookSecret() : undefined;
    const storedTrigger = input.trigger.type === "WEBHOOK" ? { type: "WEBHOOK", secretHash: webhookSecretHash(webhookSecret!) } : input.trigger.type === "SCHEDULE" ? { type: "SCHEDULE", intervalMinutes: input.trigger.intervalMinutes } : input.trigger;
    const nextRunAt = input.trigger.type === "SCHEDULE" ? new Date(input.trigger.firstRunAt ?? Date.now() + input.trigger.intervalMinutes * 60_000) : undefined;
    const rule = await db.$transaction(async (tx) => {
      const created = await tx.automationRule.create({ data: { organizationId: workspace.organization.id, agentId: agent.id, name: input.name, description: input.description, triggerType: input.trigger.type, triggerConfig: storedTrigger, actionType: input.actionType, actionConfigEncrypted: encryptAutomationAction(action), approvalThreshold: input.approvalThreshold, maxExecutionsPerDay: input.maxExecutionsPerDay, nextRunAt, createdBy: workspace.user.id } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "AUTOMATION_RULE_CREATED", targetType: "AUTOMATION_RULE", targetId: created.id, result: "SUCCESS", metadata: { triggerType: created.triggerType, actionType: created.actionType, approvalThreshold: created.approvalThreshold } } });
      return created;
    });
    const { actionConfigEncrypted: _action, ...safe } = rule; void _action;
    return ok({ ...safe, triggerConfig: safeTriggerConfig(rule.triggerType, rule.triggerConfig), webhookSecret }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
