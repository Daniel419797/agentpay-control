import { z } from "zod";

import { evaluatePolicy } from "@/domain/policy";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  merchantHost: z.string().min(1),
  merchantCategory: z.string().optional(),
  amountAtomic: z.string().regex(/^\d+$/),
  balanceAtomic: z.string().regex(/^\d+$/).default("999999999999"),
  settledTodayAtomic: z.string().regex(/^\d+$/).default("0"),
  reservedTodayAtomic: z.string().regex(/^\d+$/).default("0"),
  hourlySpendAtomic: z.string().regex(/^\d+$/).default("0"),
  monthlySpendAtomic: z.string().regex(/^\d+$/).default("0"),
  transactionsLastHour: z.number().int().min(0).default(0),
  lastTransactionAt: z.coerce.date().optional(),
  evaluatedAt: z.coerce.date().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before previewing policies.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    const { agentId } = await params;
    const input = schema.parse(await boundedJson(request));
    const agent = await db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id }, include: { organization: true, effectivePolicy: true } });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
    const policy = agent.effectivePolicy;
    if (!policy) return problem(409, "POLICY_NOT_PUBLISHED", "Publish a policy before previewing it.");
    return ok(evaluatePolicy({
      ...input,
      agentStatus: agent.status,
      organizationKillSwitch: agent.organization.killSwitchEnabled,
      assetSupported: true,
      challengeExpired: false,
      merchantMode: policy.merchantMode,
      allowedHosts: policy.allowedHosts,
      deniedHosts: policy.deniedHosts,
      allowedMerchantCategories: policy.allowedMerchantCategories,
      activeFrom: policy.activeFrom,
      activeUntil: policy.activeUntil,
      allowedWeekdays: policy.allowedWeekdays,
      allowedStartMinute: policy.allowedStartMinute,
      allowedEndMinute: policy.allowedEndMinute,
      perTransactionLimitAtomic: policy.perTransactionLimitAtomic.toString(),
      dailyLimitAtomic: policy.dailyLimitAtomic.toString(),
      hourlyLimitAtomic: policy.hourlyLimitAtomic?.toString(),
      monthlyLimitAtomic: policy.monthlyLimitAtomic?.toString(),
      maxTransactionsPerHour: policy.maxTransactionsPerHour,
      cooldownSeconds: policy.cooldownSeconds,
      overLimitAction: policy.overLimitAction,
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
