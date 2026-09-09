import { cancelLeasedCardPurchaseSafely, getCardPurchaseExecutionState } from "@/domain/card-autonomy-execution";
import { getCardPurchase } from "@/domain/card-autonomy-repository";
import { materializeLeasedCardPurchase } from "@/domain/card-autonomy-service";

/**
 * Before card credentials enter the merchant context we revalidate the complete
 * card/policy/budget state. After that irreversible boundary we validate only
 * lease ownership: policy changes must never turn an uncertain charge into an
 * automatic retry or a false "canceled" result.
 */
export async function validateCardExecutorLease(purchaseId: string, leaseToken: string) {
  const state = await getCardPurchaseExecutionState(purchaseId);
  const purchase = await getCardPurchase(purchaseId);
  if (!state || !purchase || state.status !== "EXECUTING" || purchase.leaseToken !== leaseToken || !purchase.leaseExpiresAt || purchase.leaseExpiresAt <= new Date()) {
    throw new Error("CARD_PURCHASE_LEASE_INVALID");
  }

  if (state.submissionStartedAt) return purchase;

  try {
    await materializeLeasedCardPurchase(purchase);
    return purchase;
  } catch (error) {
    await cancelLeasedCardPurchaseSafely(purchaseId, leaseToken, error instanceof Error ? error.message.slice(0, 120) : "CARD_PURCHASE_REVOKED");
    throw error;
  }
}
