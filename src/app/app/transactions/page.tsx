import type { Route } from "next";

import { WorkspacePage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

export default async function TransactionsPage() {
  const workspace = await currentWorkspace();
  if (!workspace) return <WorkspacePage title="Transactions" description="Every payment intent, policy decision, attempt, and settlement." empty="Sign in to view payment activity." rows={[]} />;
  const [intents, walletPayments] = await Promise.all([
    db.paymentIntent.findMany({
      where: { organizationId: workspace.organization.id },
      include: { agent: true, quote: { include: { asset: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.auditEvent.findMany({
      where: { organizationId: workspace.organization.id, action: "WALLET_PAYMENT_SETTLED" },
      orderBy: { occurredAt: "desc" },
    }),
  ]);
  const rows = [
    ...walletPayments.map((event) => {
      const metadata = event.metadata as { purpose?: string; resource?: string; payeeAccountId?: string; amountHbar?: string };
      return {
        id: event.targetId ?? event.id,
        title: metadata.purpose ?? metadata.resource ?? "Hedera payment",
        subtitle: `Connected wallet · ${metadata.payeeAccountId ?? "Hedera testnet"}`,
        meta: `${metadata.amountHbar ?? "0"} HBAR`,
        status: "SETTLED",
        href: `/app/transactions/${event.targetId ?? event.id}` as Route,
      };
    }),
    ...intents.map((intent) => ({
      id: intent.id,
      title: intent.quote?.resourceDescription ?? intent.merchantHost,
      subtitle: `${intent.agent.name} · ${intent.quote?.payToAccountId ?? intent.merchantHost}`,
      meta: intent.quote ? `${formatAtomic(intent.quote.amountAtomic.toString(), intent.quote.asset.decimals)} ${intent.quote.asset.symbol}` : "Awaiting quote",
      status: intent.status,
      href: `/app/transactions/${intent.id}` as Route,
    })),
  ];
  return <WorkspacePage title="Transactions" description="Every real payment intent, policy decision, attempt, and settlement." empty="No payment activity yet." rows={rows} />;
}
