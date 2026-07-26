import { ensureEntitlement } from "@/domain/entitlement-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing usage.");
    return ok(await db.$transaction(async (tx) => {
      const entitlement = await ensureEntitlement(tx, workspace.organization.id);
      const [agents, members, paymentIntents, notificationEndpoints, settled] = await Promise.all([
        tx.agent.count({ where: { organizationId: workspace.organization.id, status: { not: "ARCHIVED" } } }),
        tx.membership.count({ where: { organizationId: workspace.organization.id, status: { in: ["ACTIVE", "INVITED"] } } }),
        tx.paymentIntent.count({ where: { organizationId: workspace.organization.id, createdAt: { gte: entitlement.currentPeriodStart, lt: entitlement.currentPeriodEnd } } }),
        tx.notificationEndpoint.count({ where: { organizationId: workspace.organization.id, status: "ACTIVE" } }),
        tx.settlement.aggregate({ where: { paymentAttempt: { paymentIntent: { organizationId: workspace.organization.id } }, status: "CONFIRMED", confirmedAt: { gte: entitlement.currentPeriodStart, lt: entitlement.currentPeriodEnd } }, _count: { _all: true }, _sum: { amountAtomic: true } }),
      ]);
      return { tier: entitlement.tier, active: entitlement.active, period: { start: entitlement.currentPeriodStart, end: entitlement.currentPeriodEnd }, usage: { agents, members, paymentIntents, notificationEndpoints, settledPayments: settled._count._all, settledAtomicAcrossAssets: settled._sum.amountAtomic?.toString() ?? "0" }, limits: { agents: entitlement.maxActiveAgents, members: entitlement.maxMembers, paymentIntents: entitlement.maxMonthlyPaymentIntents, notificationEndpoints: entitlement.maxNotificationEndpoints } };
    }));
  } catch (error) {
    return handleApiError(error);
  }
}
