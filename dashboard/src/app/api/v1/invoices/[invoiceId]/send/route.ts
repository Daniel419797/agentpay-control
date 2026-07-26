import { sendInvoice } from "@/domain/invoice-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before sending an invoice.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const { invoiceId } = await context.params;
    const invoice = await sendInvoice(invoiceId, workspace.organization.id, workspace.user.id);
    return ok({ ...invoice, subtotalAtomic: invoice.subtotalAtomic.toString(), totalAtomic: invoice.totalAtomic.toString() });
  } catch (error) { if (error instanceof Error && error.message === "INVOICE_NOT_SENDABLE") return problem(409, error.message, "Only an unexpired draft invoice can be sent."); return handleApiError(error); }
}
