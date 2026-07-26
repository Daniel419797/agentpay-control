import type { Route } from "next";

import { WorkspacePage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function InvoicesPage() {
  const workspace = await currentWorkspace();
  const id = workspace?.organization.id;
  const rows = id ? await db.agentInvoice.findMany({
    where: { OR: [{ issuerOrganizationId: id }, { recipientOrganizationId: id }] },
    include: { asset: true, issuerAgent: { select: { name: true } }, recipientAgent: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  }) : [];

  return <WorkspacePage
    title="Invoices"
    description="Agent-to-agent invoices, collection state, and settlement evidence."
    action={{ label: "Create invoice", href: "/app/invoices/new" }}
    empty="Invoices appear when agents bill one another."
    rows={rows.map((invoice) => ({
      id: invoice.id,
      title: `${invoice.number} · ${invoice.title}`,
      subtitle: `${invoice.issuerAgent.name} → ${invoice.recipientAgent.name}`,
      meta: `${invoice.totalAtomic} ${invoice.asset.symbol} · due ${invoice.dueAt.toLocaleDateString()}`,
      status: invoice.status,
      href: `/app/invoices/${invoice.id}` as Route,
    }))}
  />;
}
