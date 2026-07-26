import type { Prisma } from "@/generated/prisma/client";
import { createPaidRequest } from "@/domain/payment-service";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

export type CreateInvoiceInput = {
  issuerAgentId: string;
  recipientAgentId: string;
  assetId: string;
  title: string;
  memo?: string;
  dueAt: Date;
  items: Array<{ description: string; quantity: number; unitAmountAtomic: string }>;
};

export async function createInvoice(organizationId: string, userId: string, input: CreateInvoiceInput) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice:${organizationId}`}, 0))`;
    const [issuer, recipient, asset] = await Promise.all([
      tx.agent.findFirst({ where: { id: input.issuerAgentId, organizationId, status: "ACTIVE" }, include: { organization: true, accounts: { where: { status: "ACTIVE" } } } }),
      tx.agent.findFirst({ where: { id: input.recipientAgentId, status: "ACTIVE", organization: { status: "ACTIVE" } } }),
      tx.asset.findFirst({ where: { id: input.assetId, verified: true } }),
    ]);
    if (!issuer?.accounts[0]) throw new Error("ISSUER_AGENT_ACCOUNT_UNAVAILABLE");
    if (!recipient) throw new Error("RECIPIENT_AGENT_NOT_FOUND");
    if (!asset || asset.network !== issuer.network || asset.network !== recipient.network) throw new Error("INVOICE_ASSET_NETWORK_MISMATCH");
    if (issuer.id === recipient.id) throw new Error("SELF_INVOICE_PROHIBITED");
    const totals = input.items.map((item) => BigInt(item.unitAmountAtomic) * BigInt(item.quantity));
    const total = totals.reduce((sum, value) => sum + value, 0n);
    if (total <= 0n) throw new Error("INVALID_INVOICE_TOTAL");
    const sequence = await tx.invoiceSequence.upsert({ where: { organizationId }, create: { organizationId, nextNumber: 2n }, update: { nextNumber: { increment: 1n } } });
    const allocated = sequence.nextNumber - 1n;
    const number = `INV-${new Date().getUTCFullYear()}-${allocated.toString().padStart(6, "0")}`;
    const invoice = await tx.agentInvoice.create({
      data: {
        issuerOrganizationId: organizationId,
        recipientOrganizationId: recipient.organizationId,
        issuerAgentId: issuer.id,
        recipientAgentId: recipient.id,
        assetId: asset.id,
        number,
        title: input.title,
        memo: input.memo,
        subtotalAtomic: total.toString(),
        totalAtomic: total.toString(),
        dueAt: input.dueAt,
        createdBy: userId,
        items: { create: input.items.map((item, index) => ({ ...item, totalAtomic: totals[index].toString(), position: index + 1 })) },
        events: { create: { actorType: "USER", actorId: userId, action: "INVOICE_CREATED", metadata: {} } },
      },
    });
    let provider = await tx.resourceProvider.findFirst({ where: { organizationId, settlementAccountId: issuer.accounts[0].accountId, verificationStatus: "VERIFIED" } });
    provider ??= await tx.resourceProvider.create({ data: { organizationId, name: `${issuer.organization.name} Agent Invoices`, status: "ACTIVE", verificationStatus: "VERIFIED", verifiedAt: new Date(), settlementAccountId: issuer.accounts[0].accountId, settlementAccountVerified: true } });
    const collectionUrl = new URL(`/api/v1/invoices/${invoice.id}/collect`, getConfig().NEXT_PUBLIC_APP_URL).toString();
    await tx.resourceListing.create({ data: { providerId: provider.id, category: "FILE", name: `Invoice ${number}`, slug: `invoice-${invoice.id}`, description: `Agent-to-agent settlement for ${number}`, endpoint: collectionUrl, status: "ACTIVE", public: false, inputSchema: { type: "object" }, outputContentTypes: ["application/json"], tags: ["invoice"], prices: { create: { assetId: asset.id, atomicAmount: total.toString() } } } });
    await tx.auditEvent.create({ data: { organizationId, actorType: "USER", actorId: userId, action: "AGENT_INVOICE_CREATED", targetType: "AGENT_INVOICE", targetId: invoice.id, result: "SUCCESS", metadata: { number, recipientOrganizationId: recipient.organizationId, totalAtomic: total.toString(), asset: asset.symbol } } });
    return { ...invoice, collectionUrl };
  }, { isolationLevel: "Serializable" });
}

export async function sendInvoice(invoiceId: string, organizationId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const changed = await tx.agentInvoice.updateMany({ where: { id: invoiceId, issuerOrganizationId: organizationId, status: "DRAFT", dueAt: { gt: new Date() } }, data: { status: "SENT", sentAt: new Date() } });
    if (changed.count !== 1) throw new Error("INVOICE_NOT_SENDABLE");
    const invoice = await tx.agentInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await tx.invoiceEvent.create({ data: { invoiceId, actorType: "USER", actorId: userId, action: "INVOICE_SENT", metadata: {} } });
    await tx.outboxEvent.create({ data: { organizationId: invoice.recipientOrganizationId, eventType: "AGENT_INVOICE_RECEIVED", aggregateType: "AGENT_INVOICE", aggregateId: invoice.id, payload: { invoiceNumber: invoice.number, issuerOrganizationId: organizationId, totalAtomic: invoice.totalAtomic.toString(), dueAt: invoice.dueAt.toISOString() } } });
    return invoice;
  });
}

export async function payInvoice(invoiceId: string, organizationId: string, idempotencyKey: string) {
  const invoice = await db.agentInvoice.findFirst({ where: { id: invoiceId, recipientOrganizationId: organizationId, status: { in: ["SENT", "VIEWED", "APPROVAL_PENDING", "PAYMENT_PENDING", "OVERDUE"] } }, include: { asset: true } });
  if (!invoice) throw new Error("INVOICE_NOT_PAYABLE");
  const collectionUrl = new URL(`/api/v1/invoices/${invoice.id}/collect`, getConfig().NEXT_PUBLIC_APP_URL).toString();
  const intent = await createPaidRequest(invoice.recipientAgentId, `invoice:${invoice.id}:${idempotencyKey}`, { resourceUrl: collectionUrl, purpose: `Pay invoice ${invoice.number}`, maxAmountAtomic: invoice.totalAtomic.toString() });
  if (intent.status !== "SETTLED") {
    const invoiceStatus = intent.status === "APPROVAL_PENDING" ? "APPROVAL_PENDING" : "PAYMENT_PENDING";
    await db.agentInvoice.updateMany({ where: { id: invoice.id, status: { notIn: ["PAID", "VOID"] } }, data: { status: invoiceStatus } });
    await db.invoiceEvent.create({ data: { invoiceId: invoice.id, actorType: "AGENT", actorId: invoice.recipientAgentId, action: "INVOICE_PAYMENT_INITIATED", metadata: { paymentIntentId: intent.id, paymentStatus: intent.status } } });
  }
  return intent;
}

export async function markOverdueInvoices(now = new Date()) {
  const invoices = await db.agentInvoice.findMany({ where: { dueAt: { lt: now }, status: { in: ["SENT", "VIEWED", "APPROVAL_PENDING", "PAYMENT_PENDING"] } }, select: { id: true, issuerOrganizationId: true, recipientOrganizationId: true, number: true } });
  if (!invoices.length) return { overdue: 0 };
  await db.$transaction(async (tx) => {
    await tx.agentInvoice.updateMany({ where: { id: { in: invoices.map((invoice) => invoice.id) } }, data: { status: "OVERDUE" } });
    await tx.invoiceEvent.createMany({ data: invoices.map((invoice) => ({ invoiceId: invoice.id, actorType: "SYSTEM", action: "INVOICE_OVERDUE", metadata: {} })) });
    await tx.outboxEvent.createMany({ data: invoices.map((invoice) => ({ organizationId: invoice.recipientOrganizationId, eventType: "AGENT_INVOICE_OVERDUE", aggregateType: "AGENT_INVOICE", aggregateId: invoice.id, payload: { invoiceNumber: invoice.number } })) });
  });
  return { overdue: invoices.length };
}

export type InvoiceWithDetails = Prisma.AgentInvoiceGetPayload<{ include: { items: true; asset: true; issuerAgent: { select: { id: true; name: true } }; recipientAgent: { select: { id: true; name: true } }; issuerOrganization: { select: { id: true; name: true } }; recipientOrganization: { select: { id: true; name: true } }; settlement: true; events: true } }>;
