import type { Route } from "next";

import { WorkspacePage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

export default async function ApprovalsPage() {
  const workspace = await currentWorkspace();
  const approvals = workspace ? await db.approvalRequest.findMany({
    where: { paymentIntent: { organizationId: workspace.organization.id } },
    include: { paymentIntent: { include: { agent: true, quote: { include: { asset: true } } } } },
    orderBy: { requestedAt: "desc" },
  }) : [];

  return <WorkspacePage
    title="Approval queue"
    description="Review policy exceptions before an agent may sign."
    empty="No payments are awaiting approval."
    rows={approvals.map((approval) => {
      const quote = approval.paymentIntent.quote;
      return {
        id: approval.id,
        title: quote?.resourceDescription ?? approval.paymentIntent.merchantHost,
        subtitle: `${approval.paymentIntent.agent.name} · ${approval.requestPurpose ?? "Policy review"}`,
        meta: quote ? `${formatAtomic(quote.amountAtomic.toString(), quote.asset.decimals)} ${quote.asset.symbol}` : "Quote unavailable",
        status: approval.status,
        href: `/app/approvals/${approval.id}` as Route,
      };
    })}
  />;
}
