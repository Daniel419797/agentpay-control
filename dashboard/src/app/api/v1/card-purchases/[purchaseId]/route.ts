import { getCardPurchase } from "@/domain/card-autonomy-repository";
import { sanitizeCardPurchase } from "@/domain/card-autonomy-service";
import { authorizeAgentRequest, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function GET(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    const { purchaseId } = await params;
    const purchase = await getCardPurchase(purchaseId);
    if (!purchase) return problem(404, "CARD_PURCHASE_NOT_FOUND", "Card purchase not found.");
    let authorized = await authorizeAgentRequest(request, purchase.agentId, "payments:read");
    if (!authorized) {
      const workspace = await workspaceFromRequest(request);
      authorized = Boolean(workspace && workspace.organization.id === purchase.organizationId && workspaceHasRole(workspace, ["OWNER", "OPERATOR", "APPROVER", "VIEWER"]));
    }
    if (!authorized) return problem(401, "UNAUTHORIZED", "A valid agent credential or workspace session is required.");
    const paymentIntent = await db.paymentIntent.findUnique({ where: { id: purchase.paymentIntentId }, include: { approval: { select: { id: true, status: true, expiresAt: true } } } });
    return ok({ ...sanitizeCardPurchase(purchase), paymentIntent: paymentIntent ? { id: paymentIntent.id, status: paymentIntent.status, approval: paymentIntent.approval } : null }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
