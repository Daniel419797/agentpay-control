import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function explorerFor(network: string | undefined, transactionId: string | null) {
  if (!transactionId) return { url: null, label: null };
  if (network === "hedera:mainnet") return { url: `https://hashscan.io/mainnet/transaction/${transactionId}`, label: "HashScan" };
  if (network === "hedera:testnet") return { url: `https://hashscan.io/testnet/transaction/${transactionId}`, label: "HashScan" };
  if (network === "eip155:5042002") return { url: `https://testnet.arcscan.app/tx/${transactionId}`, label: "ArcScan" };
  return { url: null, label: null };
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing payment operations.");
    const organizationId = workspace.organization.id;
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);

    const [agents, pending, intents, walletEvents, resources, dailyReservations, settledByAsset] = await Promise.all([
      db.agent.findMany({
        where: { organizationId, status: { not: "ARCHIVED" } },
        include: { accounts: true, effectivePolicy: { include: { asset: true } } },
        orderBy: { createdAt: "desc" },
      }),
      db.approvalRequest.findMany({
        where: { status: "PENDING", paymentIntent: { organizationId } },
        include: { paymentIntent: { include: { agent: true, quote: { include: { asset: true } } } } },
        orderBy: { requestedAt: "desc" }, take: 5,
      }),
      db.paymentIntent.findMany({
        where: { organizationId },
        include: { agent: true, quote: { include: { asset: true } }, attempts: { include: { settlement: true } } },
        orderBy: { createdAt: "desc" }, take: 10,
      }),
      db.auditEvent.findMany({ where: { organizationId, action: "WALLET_PAYMENT_SETTLED" }, orderBy: { occurredAt: "desc" }, take: 10 }),
      db.resourceListing.count({ where: { provider: { organizationId }, status: "ACTIVE" } }),
      db.spendReservation.findMany({
        where: { agent: { organizationId }, createdAt: { gte: dayStart }, status: { in: ["ACTIVE", "CONSUMED", "SETTLED"] } },
        select: { agentId: true, assetId: true, amountAtomic: true },
      }),
      db.settlement.groupBy({
        by: ["assetId"],
        where: { status: "CONFIRMED", paymentAttempt: { paymentIntent: { organizationId } } },
        _sum: { amountAtomic: true },
      }),
    ]);

    const assetIds = settledByAsset.map((row) => row.assetId);
    const settledAssets = assetIds.length ? await db.asset.findMany({ where: { id: { in: assetIds } }, select: { id: true, symbol: true, decimals: true, network: true } }) : [];
    const assetById = new Map(settledAssets.map((asset) => [asset.id, asset]));
    const settledSpend = settledByAsset.flatMap((row) => {
      const asset = assetById.get(row.assetId);
      if (!asset || !row._sum.amountAtomic) return [];
      return [{ assetId: asset.id, symbol: asset.symbol, network: asset.network, amount: formatAtomic(row._sum.amountAtomic.toString(), asset.decimals) }];
    });

    const orgSpendByAsset = new Map<string, bigint>();
    const agentSpendByAsset = new Map<string, bigint>();
    for (const reservation of dailyReservations) {
      const amount = BigInt(reservation.amountAtomic.toString());
      orgSpendByAsset.set(reservation.assetId, (orgSpendByAsset.get(reservation.assetId) ?? 0n) + amount);
      const key = `${reservation.agentId}:${reservation.assetId}`;
      agentSpendByAsset.set(key, (agentSpendByAsset.get(key) ?? 0n) + amount);
    }

    const budgetRows = agents.flatMap((agent) => {
      const policy = agent.effectivePolicy;
      if (agent.status !== "ACTIVE" || !policy) return [];
      const account = agent.accounts.find((candidate) => candidate.status === "ACTIVE" && candidate.network === agent.network);
      const sharedTreasury = account?.custodyType === "PLATFORM_MANAGED_TESTNET";
      const spent = sharedTreasury
        ? (orgSpendByAsset.get(policy.assetId) ?? 0n)
        : (agentSpendByAsset.get(`${agent.id}:${policy.assetId}`) ?? 0n);
      const limit = BigInt(policy.dailyLimitAtomic.toString());
      const remaining = limit > spent ? limit - spent : 0n;
      const percent = limit > 0n ? Number((spent * 10_000n) / limit) / 100 : 0;
      return [{ agentId: agent.id, agent: agent.name, symbol: policy.asset.symbol, network: policy.asset.network, remaining: formatAtomic(remaining.toString(), policy.asset.decimals), usedPercent: Math.round(percent) }];
    });
    const mostConstrained = budgetRows.toSorted((a, b) => b.usedPercent - a.usedPercent)[0] ?? null;

    const walletRows = walletEvents.map((event) => {
      const metadata = event.metadata as { payerAccountId?: string; payeeAccountId?: string; amountHbar?: string; resource?: string; purpose?: string; network?: string };
      const network = metadata.network === "hedera:mainnet" ? "hedera:mainnet" : "hedera:testnet";
      const receipt = explorerFor(network, event.targetId);
      return { id: event.targetId ?? event.id, createdAt: event.occurredAt, agent: "Connected wallet", payer: metadata.payerAccountId ?? "", resource: metadata.purpose ?? metadata.resource ?? "Hedera payment", payee: metadata.payeeAccountId ?? "", amount: metadata.amountHbar ?? "0", asset: "HBAR", network, status: "SETTLED", transactionId: event.targetId, explorerUrl: receipt.url, explorerLabel: receipt.label };
    });
    const intentRows = intents.map((intent) => {
      const settlement = intent.attempts.map((attempt) => attempt.settlement).find(Boolean);
      const network = settlement?.network ?? intent.quote?.network;
      const receipt = explorerFor(network, settlement?.transactionId ?? null);
      return { id: intent.id, createdAt: intent.createdAt, agent: intent.agent.name, payer: settlement?.payerAccountId ?? "", resource: intent.quote?.resourceDescription ?? intent.merchantHost, payee: intent.quote?.payToAccountId ?? intent.merchantHost, amount: intent.quote ? formatAtomic(intent.quote.amountAtomic.toString(), intent.quote.asset.decimals) : "0", asset: intent.quote?.asset.symbol ?? "", network: network ?? "", status: intent.status, transactionId: settlement?.transactionId ?? null, explorerUrl: receipt.url, explorerLabel: receipt.label };
    });
    const recent = [...walletRows, ...intentRows].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 8);

    return ok({
      metrics: {
        settledSpend,
        activeAgents: agents.filter((agent) => agent.status === "ACTIVE").length,
        pausedAgents: agents.filter((agent) => agent.status === "PAUSED").length,
        pendingApprovals: pending.length,
        activeResources: resources,
        trackedPolicies: budgetRows.length,
        highestDailyBudgetUsePercent: mostConstrained?.usedPercent ?? 0,
        mostConstrainedBudget: mostConstrained,
      },
      recent,
      approvals: pending.map((approval) => ({ id: approval.id, agent: approval.paymentIntent.agent.name, resource: approval.paymentIntent.quote?.resourceDescription ?? approval.paymentIntent.merchantHost, amount: approval.paymentIntent.quote ? formatAtomic(approval.paymentIntent.quote.amountAtomic.toString(), approval.paymentIntent.quote.asset.decimals) : "0", asset: approval.paymentIntent.quote?.asset.symbol ?? "", reason: approval.requestPurpose ?? "Policy review required" })),
      agents: agents.slice(0, 5).map((agent) => ({ id: agent.id, name: agent.name, status: agent.status, network: agent.network, accountId: agent.accounts.find((account) => account.network === agent.network)?.accountId ?? null })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
