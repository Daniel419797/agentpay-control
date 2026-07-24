import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing transactions.");
    const rows = await db.paymentIntent.findMany({
      where: { organizationId: workspace.organization.id },
      include: { agent: true, quote: { include: { asset: true } }, decisions: true, attempts: { include: { settlement: true } } },
      orderBy: { createdAt: "desc" },
    });
    return ok(rows.map((intent) => ({
      ...intent,
      quote: intent.quote ? { ...intent.quote, amountAtomic: intent.quote.amountAtomic.toString() } : null,
      decisions: intent.decisions.map((decision) => ({
        ...decision,
        spendBeforeAtomic: decision.spendBeforeAtomic.toString(),
        reservedBeforeAtomic: decision.reservedBeforeAtomic.toString(),
        projectedAtomic: decision.projectedAtomic.toString(),
      })),
      attempts: intent.attempts.map((attempt) => ({
        ...attempt,
        settlement: attempt.settlement ? { ...attempt.settlement, amountAtomic: attempt.settlement.amountAtomic.toString() } : null,
      })),
    })));
  } catch (error) {
    return handleApiError(error);
  }
}
