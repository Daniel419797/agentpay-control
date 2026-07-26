import { notFound } from "next/navigation";

import { InvoiceActions } from "@/components/invoice-actions";
import { FormPage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const [{ invoiceId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const organizationId = workspace.organization.id;
  const invoice = await db.agentInvoice.findFirst({
    where: { id: invoiceId, OR: [{ issuerOrganizationId: organizationId }, { recipientOrganizationId: organizationId }] },
    include: {
      asset: true,
      issuerAgent: { select: { name: true } },
      recipientAgent: { select: { name: true } },
      issuerOrganization: { select: { name: true } },
      recipientOrganization: { select: { name: true } },
      items: { orderBy: { position: "asc" } },
      settlement: true,
      events: { orderBy: { occurredAt: "asc" } },
    },
  });
  if (!invoice) notFound();
  const isIssuer = invoice.issuerOrganizationId === organizationId;
  const isRecipient = invoice.recipientOrganizationId === organizationId;
  const payable = ["SENT", "VIEWED", "OVERDUE"].includes(invoice.status);
  const voidable = ["DRAFT", "SENT", "VIEWED", "APPROVAL_PENDING", "PAYMENT_PENDING", "OVERDUE"].includes(invoice.status);

  return <FormPage title={invoice.number} description={invoice.title}>
    <div className="detail-grid">
      <div><span>Status</span><strong>{invoice.status}</strong></div>
      <div><span>Total</span><strong>{invoice.totalAtomic.toString()} {invoice.asset.symbol}</strong></div>
      <div><span>Issuer</span><strong>{invoice.issuerAgent.name} · {invoice.issuerOrganization.name}</strong></div>
      <div><span>Recipient</span><strong>{invoice.recipientAgent.name} · {invoice.recipientOrganization.name}</strong></div>
      <div><span>Due</span><strong>{invoice.dueAt.toLocaleString()}</strong></div>
      <div><span>Settlement</span><strong>{invoice.settlement?.transactionId ?? "Not settled"}</strong></div>
    </div>
    <section>
      <h2 className="panel-title">Line items</h2>
      <div className="record-list">{invoice.items.map((item) => <div className="record-row" key={item.id}><div><div className="record-title">{item.description}</div><div className="record-subtitle">Quantity {item.quantity}</div></div><strong>{item.totalAtomic.toString()} {invoice.asset.symbol}</strong></div>)}</div>
    </section>
    <InvoiceActions invoiceId={invoice.id} canSend={isIssuer && invoice.status === "DRAFT"} canPay={isRecipient && payable} canVoid={isIssuer && voidable} />
    <ol className="timeline">{invoice.events.map((event) => <li key={event.id}><strong>{event.action.replaceAll("_", " ")}</strong><span>{event.occurredAt.toLocaleString()}</span></li>)}</ol>
  </FormPage>;
}
