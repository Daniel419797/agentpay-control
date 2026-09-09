import { resumeApprovedCardPurchase } from "@/domain/card-autonomy-service";
import { db } from "@/lib/db";

const terminalRevalidationErrors = new Set([
  "CARD_AUTONOMY_POLICY_CHANGED",
  "CARD_PURCHASE_POLICY_CHANGED",
  "CARD_PURCHASE_APPROVAL_STATE_INVALID",
  "ORGANIZATION_NOT_ACTIVE",
  "ORGANIZATION_KILL_SWITCH_ENABLED",
  "AGENT_NOT_ACTIVE",
  "CARD_NOT_ACTIVE",
  "CARD_CURRENCY_MISMATCH",
]);

export async function resumeApprovedCardPurchaseSafely(paymentIntentId: string) {
  try {
    return await resumeApprovedCardPurchase(paymentIntentId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (terminalRevalidationErrors.has(code)) {
      await db.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string; organization_id: string }>>`
          UPDATE "autonomous_card_purchase"
          SET "status" = 'CANCELED',
              "result_code" = ${code || "CARD_PURCHASE_REVALIDATION_FAILED"},
              "completed_at" = NOW(),
              "updated_at" = NOW()
          WHERE "payment_intent_id" = ${paymentIntentId}::uuid
            AND "status" = 'APPROVAL_PENDING'
          RETURNING "id", "organization_id"
        `;
        if (!rows[0]) return;
        await tx.paymentIntent.updateMany({ where: { id: paymentIntentId, status: "AUTHORIZED" }, data: { status: "CANCELED" } });
        await tx.auditEvent.create({ data: { organizationId: rows[0].organization_id, actorType: "SYSTEM", action: "CARD_PURCHASE_REVALIDATION_DENIED", targetType: "CARD_PURCHASE", targetId: rows[0].id, result: "DENIED", metadata: { paymentIntentId, reason: code } } });
      });
    }
    throw error;
  }
}
