import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing payment operations.");
    const organizationId = workspace.organization.id;
    const [agents, pending, intents, walletEvents, resources] = await Promise.all([
      db.agent.findMany({
        where: { organizationId, status: { not: "ARCHIVED" } },
        include: { accounts: true },
        orderBy: { createdAt: "desc" },
      }),
      db.approvalRequest.findMany({
        where: { status: "PENDING", paymentIntent: { organizationId } },
        include: { paymentIntent: { include: { agent: true, quote: { include: { asset: true } } } } },
        orderBy: { requestedAt: "desc" },
        take: 5,
      }),
      db.paymentIntent.findMany({
        where: { organizationId },
        include: { agent: true, quote: { include: { asset: true } }, attempts: { include: { settlement: true } } },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
      db.auditEvent.findMany({
        where: { organizationId, action: "WALLET_PAYMENT_SETTLED" },
        orderBy: { occurredAt: "desc" },
        take: 10,
      }),
      db.resourceListing.count({ where: { provider: { organizationId }, status: "ACTIVE" } }),
    ]);

    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const activeAgentIds = agents.filter((a) => a.status === "ACTIVE").map((a) => a.id);
    const policyVersionIds = agents.filter((a) => a.status === "ACTIVE").map((a) => a.effectivePolicyId).filter(Boolean) as string[];
    const dailySpend = activeAgentIds.length > 0 ? await db.spendReservation.aggregate({
      where: { agentId: { in: activeAgentIds }, createdAt: { gte: dayStart }, status: { in: ["ACTIVE", "CONSUMED", "SETTLED"] } },
      _sum: { amountAtomic: true },
    }) : { _sum: { amountAtomic: null } };
    const policyVersions = policyVersionIds.length > 0 ? await db.policyVersion.findMany({
      where: { id: { in: policyVersionIds } },
      select: { dailyLimitAtomic: true, asset: { select: { decimals: true, symbol: true } } },
    }) : [];
    const totalDailyLimit = policyVersions.reduce((sum, p) => sum + Number(p.dailyLimitAtomic), 0);
    const totalDailySpent = Number(dailySpend._sum.amountAtomic ?? 0);
    const dailyDecimals = policyVersions[0]?.asset.decimals ?? 8;
    const dailySymbol = policyVersions[0]?.asset.symbol ?? "HBAR";
    const remainingDaily = totalDailyLimit > 0 ? Math.max(0, totalDailyLimit - totalDailySpent) : 0;
    const remainingDailyFormatted = totalDailyLimit > 0 ? (remainingDaily / Math.pow(10, dailyDecimals)).toFixed(4) : "—";

    const walletRows = walletEvents.map((event) => {
      const metadata = event.metadata as {
        payerAccountId?: string;
        payeeAccountId?: string;
        amountHbar?: string;
        resource?: string;
        purpose?: string;
      };
      return {
        id: event.targetId ?? event.id,
        createdAt: event.occurredAt,
        agent: "Connected wallet",
        payer: metadata.payerAccountId ?? "",
        resource: metadata.purpose ?? metadata.resource ?? "Hedera payment",
        payee: metadata.payeeAccountId ?? "",
        amount: metadata.amountHbar ?? "0",
        asset: "HBAR",
        status: "SETTLED",
        transactionId: event.targetId,
        hashscanUrl: event.targetId ? `https://hashscan.io/testnet/transaction/${event.targetId}` : null,
      };
    });
    const intentRows = intents.map((intent) => {
      const settlement = intent.attempts.flatMap((attempt) => attempt.settlement ?? []).at(0);
      return {
        id: intent.id,
        createdAt: intent.createdAt,
        agent: intent.agent.name,
        payer: settlement?.payerAccountId ?? "",
        resource: intent.quote?.resourceDescription ?? intent.merchantHost,
        payee: intent.quote?.payToAccountId ?? intent.merchantHost,
        amount: intent.quote ? formatAtomic(intent.quote.amountAtomic.toString(), intent.quote.asset.decimals) : "0",
        asset: intent.quote?.asset.symbol ?? "",
        status: intent.status,
        transactionId: settlement?.transactionId ?? null,
        hashscanUrl: settlement?.transactionId ? `https://hashscan.io/testnet/transaction/${settlement.transactionId}` : null,
      };
    });
    const recent = [...walletRows, ...intentRows]
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 8);
    const settledHbar = walletRows.reduce((sum, row) => sum + Number(row.amount), 0);

    return ok({
      metrics: {
        settledHbar,
        activeAgents: agents.filter((agent) => agent.status === "ACTIVE").length,
        pausedAgents: agents.filter((agent) => agent.status === "PAUSED").length,
        pendingApprovals: pending.length,
        activeResources: resources,
        remainingDailyBudget: remainingDailyFormatted,
        dailyBudgetSymbol: dailySymbol,
        dailySpentPercent: totalDailyLimit > 0 ? Math.round((totalDailySpent / totalDailyLimit) * 100) : 0,
      },
      recent,
      approvals: pending.map((approval) => ({
        id: approval.id,
        agent: approval.paymentIntent.agent.name,
        resource: approval.paymentIntent.quote?.resourceDescription ?? approval.paymentIntent.merchantHost,
        amount: approval.paymentIntent.quote ? formatAtomic(approval.paymentIntent.quote.amountAtomic.toString(), approval.paymentIntent.quote.asset.decimals) : "0",
        asset: approval.paymentIntent.quote?.asset.symbol ?? "",
        reason: approval.requestPurpose ?? "Policy review required",
      })),
      agents: agents.slice(0, 5).map((agent) => ({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        accountId: agent.accounts[0]?.accountId ?? null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
