import { handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing an invoice.");
    const { invoiceId } = await context.params;
    const invoice = await db.agentInvoice.findFirst({ where: { id: invoiceId, OR: [{ issuerOrganizationId: workspace.organization.id }, { recipientOrganizationId: workspace.organization.id }] }, include: { items: { orderBy: { position: "asc" } }, asset: true, issuerAgent: { select: { id: true, name: true } }, recipientAgent: { select: { id: true, name: true } }, issuerOrganization: { select: { id: true, name: true } }, recipientOrganization: { select: { id: true, name: true } }, settlement: true, events: { orderBy: { occurredAt: "asc" } } } });
    if (!invoice) return problem(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    if (invoice.recipientOrganizationId === workspace.organization.id && invoice.status === "SENT") await db.$transaction([db.agentInvoice.update({ where: { id: invoice.id }, data: { status: "VIEWED", viewedAt: new Date() } }), db.invoiceEvent.create({ data: { invoiceId: invoice.id, actorType: "USER", actorId: workspace.user.id, action: "INVOICE_VIEWED", metadata: {} } })]);
    const collectionUrl = new URL(`/api/v1/invoices/${invoice.id}/collect`, getConfig().NEXT_PUBLIC_APP_URL).toString();
    return ok({ ...invoice, subtotalAtomic: invoice.subtotalAtomic.toString(), totalAtomic: invoice.totalAtomic.toString(), items: invoice.items.map((item) => ({ ...item, unitAmountAtomic: item.unitAmountAtomic.toString(), totalAtomic: item.totalAtomic.toString() })), collectionUrl });
  } catch (error) { return handleApiError(error); }
}
