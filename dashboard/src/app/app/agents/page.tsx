import type { Route } from "next";

import { WorkspacePage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ network?: string }>;
}) {
  const workspace = await currentWorkspace();
  const params = await searchParams;
  const networkFilter = params.network === "hedera:testnet" || params.network === "hedera:mainnet"
    ? params.network : undefined;
  const agents = workspace ? await db.agent.findMany({
    where: {
      organizationId: workspace.organization.id,
      status: { not: "ARCHIVED" },
      ...(networkFilter ? { accounts: { some: { network: networkFilter } } } : {}),
    },
    include: {
      accounts: {
        where: networkFilter ? { network: networkFilter } : undefined,
        include: { balances: { orderBy: { asOf: "desc" }, take: 1, include: { asset: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  }) : [];

  return <WorkspacePage
    title="Agents"
    description="Payment identities, custody, balances, and operating status."
    action={{ label: "Create agent", href: "/app/agents/new" }}
    empty="Create an agent to begin."
    rows={agents.map((agent) => {
      const account = agent.accounts[0];
      const balance = account?.balances[0];
      return {
        id: agent.id,
        title: agent.name,
        subtitle: account?.accountId ?? "No payment account connected",
        meta: balance ? `${formatAtomic(balance.atomicAmount.toString(), balance.asset.decimals)} ${balance.asset.symbol}` : "Balance unavailable",
        status: agent.status,
        href: `/app/agents/${agent.id}` as Route,
      };
    })}
  />;
}
