import { cancelLeasedPurchase } from "@/domain/card-autonomy-repository";
import { materializeLeasedCardPurchase } from "@/domain/card-autonomy-service";
import { leaseCrashSafeCardPurchase } from "@/domain/card-autonomy-submission";
import { handleApiError, problem } from "@/lib/api";
import { authorizeCardExecutorRequest, getCardExecutorConfig } from "@/lib/card-executor-config";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!authorizeCardExecutorRequest(request)) return problem(401, "CARD_EXECUTOR_UNAUTHORIZED", "A valid card executor credential is required.");
    const config = getCardExecutorConfig();
    const purchase = await leaseCrashSafeCardPurchase({ leaseSeconds: config.CARD_EXECUTOR_LEASE_SECONDS, maxAttempts: config.CARD_EXECUTOR_MAX_ATTEMPTS });
    if (!purchase) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    try {
      const task = await materializeLeasedCardPurchase(purchase);
      return Response.json({ data: task }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (purchase.leaseToken) await cancelLeasedPurchase(purchase.id, purchase.leaseToken, error instanceof Error ? error.message.slice(0, 120) : "CARD_PURCHASE_REVOKED");
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && ["CARD_EXECUTOR_DISABLED", "CARD_EXECUTOR_SHARED_SECRET_REQUIRED"].includes(error.message)) return problem(503, error.message, "The autonomous card executor is not configured.");
    return handleApiError(error);
  }
}
