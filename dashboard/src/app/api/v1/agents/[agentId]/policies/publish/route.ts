import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  assetId: z.string().uuid(),
  perTransactionLimitAtomic: z.string().regex(/^\d+$/),
  dailyLimitAtomic: z.string().regex(/^\d+$/),
  overLimitAction: z.enum(["DENY", "REQUIRE_APPROVAL"]),
  merchantMode: z.enum(["ANY", "ALLOWLIST_ONLY"]),
  allowedHosts: z.array(z.string()).default([]),
  deniedHosts: z.array(z.string()).default([]),
  approvalThreshold: z.number().int().min(1).max(20).default(1),
  rejectionThreshold: z.number().int().min(1).max(20).default(1),
  allowedMerchantCategories: z.array(z.enum(["MARKET_DATA", "FILE", "AI_INFERENCE", "WEB_RESEARCH"])).default([]),
  activeFrom: z.coerce.date().optional(),
  activeUntil: z.coerce.date().optional(),
  allowedWeekdays: z.array(z.number().int().min(0).max(6)).default([]),
  allowedStartMinute: z.number().int().min(0).max(1439).optional(),
  allowedEndMinute: z.number().int().min(0).max(1439).optional(),
  hourlyLimitAtomic: z.string().regex(/^\d+$/).optional(),
  monthlyLimitAtomic: z.string().regex(/^\d+$/).optional(),
  maxTransactionsPerHour: z.number().int().positive().max(10_000).optional(),
  cooldownSeconds: z.number().int().min(0).max(86_400).optional(),
}).superRefine((value, context) => {
  if ((value.allowedStartMinute == null) !== (value.allowedEndMinute == null)) context.addIssue({ code: "custom", message: "Both schedule minutes are required." });
  if (value.activeFrom && value.activeUntil && value.activeUntil <= value.activeFrom) context.addIssue({ code: "custom", message: "activeUntil must be after activeFrom." });
});

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before publishing a policy.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    const { agentId } = await params;
    const agent = await db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id } });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
    const input = schema.parse(await boundedJson(request));
    const result = await db.$transaction(async (tx) => {
      let policy = await tx.policy.findFirst({ where: { agentId } });
      if (!policy) policy = await tx.policy.create({ data: { agentId, organizationId: workspace.organization.id } });
      const latest = await tx.policyVersion.aggregate({ where: { policyId: policy.id }, _max: { version: true } });
      await tx.policyVersion.updateMany({ where: { policyId: policy.id, status: "PUBLISHED" }, data: { status: "SUPERSEDED" } });
      const version = await tx.policyVersion.create({
        data: {
          policyId: policy.id,
          version: (latest._max.version ?? 0) + 1,
          status: "PUBLISHED",
          assetId: input.assetId,
          perTransactionLimitAtomic: input.perTransactionLimitAtomic,
          dailyLimitAtomic: input.dailyLimitAtomic,
          overLimitAction: input.overLimitAction,
          merchantMode: input.merchantMode,
          allowedHosts: input.allowedHosts.map((value) => value.toLowerCase()),
          deniedHosts: input.deniedHosts.map((value) => value.toLowerCase()),
          approvalThreshold: input.approvalThreshold,
          rejectionThreshold: input.rejectionThreshold,
          allowedMerchantCategories: input.allowedMerchantCategories,
          activeFrom: input.activeFrom,
          activeUntil: input.activeUntil,
          allowedWeekdays: [...new Set(input.allowedWeekdays)],
          allowedStartMinute: input.allowedStartMinute,
          allowedEndMinute: input.allowedEndMinute,
          hourlyLimitAtomic: input.hourlyLimitAtomic,
          monthlyLimitAtomic: input.monthlyLimitAtomic,
          maxTransactionsPerHour: input.maxTransactionsPerHour,
          cooldownSeconds: input.cooldownSeconds,
          createdBy: workspace.user.id,
          publishedAt: new Date(),
        },
      });
      await tx.agent.update({ where: { id: agentId }, data: { effectivePolicyId: version.id } });
      return version;
    });
    return ok({
      ...result,
      perTransactionLimitAtomic: result.perTransactionLimitAtomic.toString(),
      dailyLimitAtomic: result.dailyLimitAtomic.toString(),
    }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
