import { authorizeAgentRequest, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    if (!(await authorizeAgentRequest(request, agentId, "resources:read"))) {
      return problem(401, "UNAUTHORIZED", "A valid AgentPay connection credential with resources:read is required.");
    }

    const agent = await db.agent.findUnique({
      where: { id: agentId },
      include: {
        organization: { select: { status: true, killSwitchEnabled: true } },
        defaultAsset: { select: { symbol: true, decimals: true, network: true } },
        accounts: { orderBy: { createdAt: "asc" }, take: 1, select: { accountId: true, network: true, custodyType: true, signingMode: true, status: true } },
        effectivePolicy: { include: { asset: { select: { symbol: true, decimals: true } } } },
      },
    });
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");

    const account = agent.accounts[0] ?? null;
    const policy = agent.effectivePolicy;
    const blockingReasons: string[] = [];
    if (agent.organization.status !== "ACTIVE") blockingReasons.push("ORGANIZATION_NOT_ACTIVE");
    if (agent.organization.killSwitchEnabled) blockingReasons.push("ORGANIZATION_KILL_SWITCH_ENABLED");
    if (agent.status !== "ACTIVE") blockingReasons.push("AGENT_NOT_ACTIVE");
    if (!account || account.status !== "ACTIVE") blockingReasons.push("PAYMENT_ACCOUNT_NOT_ACTIVE");
    if (!policy || policy.status !== "PUBLISHED") blockingReasons.push("POLICY_NOT_PUBLISHED");

    return ok({
      ready: blockingReasons.length === 0,
      blockingReasons,
      agent: { id: agent.id, name: agent.name, status: agent.status, network: agent.network, defaultAsset: agent.defaultAsset },
      account,
      policy: policy ? {
        id: policy.id,
        version: policy.version,
        asset: policy.asset,
        perTransactionLimitAtomic: policy.perTransactionLimitAtomic.toString(),
        hourlyLimitAtomic: policy.hourlyLimitAtomic?.toString() ?? null,
        dailyLimitAtomic: policy.dailyLimitAtomic.toString(),
        monthlyLimitAtomic: policy.monthlyLimitAtomic?.toString() ?? null,
        overLimitAction: policy.overLimitAction,
        merchantMode: policy.merchantMode,
        allowedHosts: policy.allowedHosts,
        deniedHosts: policy.deniedHosts,
        allowedMerchantCategories: policy.allowedMerchantCategories,
        maxTransactionsPerHour: policy.maxTransactionsPerHour,
        cooldownSeconds: policy.cooldownSeconds,
      } : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
