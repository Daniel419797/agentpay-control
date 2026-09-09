import { z } from "zod";

import { heartbeatCardPurchase } from "@/domain/card-autonomy-repository";
import { hasCardPurchaseSubmissionStarted } from "@/domain/card-autonomy-submission";
import { validateLeasedCardPurchase } from "@/domain/card-autonomy-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { authorizeCardExecutorRequest, getCardExecutorConfig } from "@/lib/card-executor-config";

const schema = z.object({ leaseToken: z.string().uuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    if (!authorizeCardExecutorRequest(request)) return problem(401, "CARD_EXECUTOR_UNAUTHORIZED", "A valid card executor credential is required.");
    const { purchaseId } = await params;
    const { leaseToken } = schema.parse(await boundedJson(request, 4 * 1024));
    const submitted = await hasCardPurchaseSubmissionStarted(purchaseId, leaseToken);
    if (!submitted) await validateLeasedCardPurchase(purchaseId, leaseToken);
    const updated = await heartbeatCardPurchase(purchaseId, leaseToken, getCardExecutorConfig().CARD_EXECUTOR_LEASE_SECONDS);
    if (!updated) return problem(409, "CARD_PURCHASE_LEASE_INVALID", "The purchase lease is no longer valid.");
    return ok({ purchaseId: updated.id, leaseExpiresAt: updated.leaseExpiresAt }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "CARD_PURCHASE_LEASE_INVALID") return problem(409, error.message, "The purchase lease is no longer valid.");
    return handleApiError(error);
  }
}
