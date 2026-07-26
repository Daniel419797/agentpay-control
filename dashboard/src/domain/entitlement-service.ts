import type { Prisma } from "@/generated/prisma/client";

type LimitResource = "AGENTS" | "MEMBERS" | "PAYMENT_INTENTS" | "NOTIFICATION_ENDPOINTS";

function period(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export async function ensureEntitlement(tx: Prisma.TransactionClient, organizationId: string) {
  const current = period();
  const entitlement = await tx.organizationEntitlement.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId, currentPeriodStart: current.start, currentPeriodEnd: current.end },
  });
  if (entitlement.currentPeriodEnd <= new Date()) {
    return tx.organizationEntitlement.update({ where: { id: entitlement.id }, data: { currentPeriodStart: current.start, currentPeriodEnd: current.end } });
  }
  return entitlement;
}

export async function assertPlanLimit(tx: Prisma.TransactionClient, organizationId: string, resource: LimitResource) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${organizationId}, 0))`;
  const entitlement = await ensureEntitlement(tx, organizationId);
  if (!entitlement.active) throw new Error("PLAN_INACTIVE");
  let used = 0;
  let limit = 0;
  if (resource === "AGENTS") {
    [used, limit] = [await tx.agent.count({ where: { organizationId, status: { not: "ARCHIVED" } } }), entitlement.maxActiveAgents];
  } else if (resource === "MEMBERS") {
    [used, limit] = [await tx.membership.count({ where: { organizationId, status: { in: ["ACTIVE", "INVITED"] } } }), entitlement.maxMembers];
  } else if (resource === "NOTIFICATION_ENDPOINTS") {
    [used, limit] = [await tx.notificationEndpoint.count({ where: { organizationId, status: "ACTIVE" } }), entitlement.maxNotificationEndpoints];
  } else {
    [used, limit] = [await tx.paymentIntent.count({ where: { organizationId, createdAt: { gte: entitlement.currentPeriodStart, lt: entitlement.currentPeriodEnd } } }), entitlement.maxMonthlyPaymentIntents];
  }
  if (used >= limit) throw new Error(`PLAN_${resource}_LIMIT_REACHED`);
  return { entitlement, used, limit };
}
