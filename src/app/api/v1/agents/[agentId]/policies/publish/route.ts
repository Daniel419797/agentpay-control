import { z } from "zod";

import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const schema = z.object({
  assetId: z.string().uuid(),
  perTransactionLimitAtomic: z.string().regex(/^\d+$/),
  dailyLimitAtomic: z.string().regex(/^\d+$/),
  overLimitAction: z.enum(["DENY", "REQUIRE_APPROVAL"]),
  merchantMode: z.enum(["ANY", "ALLOWLIST_ONLY"]),
  allowedHosts: z.array(z.string()).default([]),
  deniedHosts: z.array(z.string()).default([]),
});

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before publishing a policy.");
    const { agentId } = await params;
    const agent = await db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id } });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
    const input = schema.parse(await request.json());
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
