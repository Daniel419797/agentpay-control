import { z } from "zod";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ reason: z.string().min(3).max(300) });

export async function POST(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before voiding an invoice.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const { invoiceId } = await context.params;
    const input = schema.parse(await boundedJson(request));
    const collectionUrl = new URL(`/api/v1/invoices/${invoiceId}/collect`, getConfig().NEXT_PUBLIC_APP_URL).toString();
    const invoice = await db.$transaction(async (tx) => {
      const changed = await tx.agentInvoice.updateMany({ where: { id: invoiceId, issuerOrganizationId: workspace.organization.id, status: { in: ["DRAFT", "SENT", "VIEWED", "APPROVAL_PENDING", "PAYMENT_PENDING", "OVERDUE"] } }, data: { status: "VOID", voidedAt: new Date() } });
      if (changed.count !== 1) throw new Error("INVOICE_NOT_VOIDABLE");
      await tx.resourceListing.updateMany({ where: { endpoint: collectionUrl }, data: { status: "PAUSED" } });
      await tx.invoiceEvent.create({ data: { invoiceId, actorType: "USER", actorId: workspace.user.id, action: "INVOICE_VOIDED", metadata: { reason: input.reason } } });
      return tx.agentInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
    return ok({ ...invoice, subtotalAtomic: invoice.subtotalAtomic.toString(), totalAtomic: invoice.totalAtomic.toString() });
  } catch (error) { if (error instanceof Error && error.message === "INVOICE_NOT_VOIDABLE") return problem(409, error.message, "Paid or already void invoices cannot be voided."); return handleApiError(error); }
}
