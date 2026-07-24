import { db } from "@/lib/db";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing approvals.");
    const rows = await db.approvalRequest.findMany({
      where: { paymentIntent: { organizationId: workspace.organization.id } },
      include: { paymentIntent: { include: { agent: true, quote: { include: { asset: true } }, decisions: true } } },
      orderBy: { requestedAt: "desc" },
    });
    return ok(rows.map((approval) => ({
      ...approval,
      paymentIntent: {
        ...approval.paymentIntent,
        quote: approval.paymentIntent.quote ? { ...approval.paymentIntent.quote, amountAtomic: approval.paymentIntent.quote.amountAtomic.toString() } : null,
        decisions: approval.paymentIntent.decisions.map((decision) => ({
          ...decision,
          spendBeforeAtomic: decision.spendBeforeAtomic.toString(),
          reservedBeforeAtomic: decision.reservedBeforeAtomic.toString(),
          projectedAtomic: decision.projectedAtomic.toString(),
        })),
      },
    })));
  } catch (error) {
    return handleApiError(error);
  }
}
