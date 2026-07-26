import { payInvoice } from "@/domain/invoice-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function POST(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before paying an invoice.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const { invoiceId } = await context.params;
    const intent = await payInvoice(invoiceId, workspace.organization.id, idempotencyKey);
    return ok(intent, { status: intent.status === "SETTLED" ? 200 : 202 });
  } catch (error) { if (error instanceof Error && error.message === "INVOICE_NOT_PAYABLE") return problem(409, error.message, "This invoice cannot be paid by the current organization."); return handleApiError(error); }
}
