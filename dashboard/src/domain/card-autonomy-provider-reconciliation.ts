import { db } from "@/lib/db";

/**
 * Browser success is useful checkout evidence, but the card provider remains the
 * source of truth for financial authorization and settlement. This reconciler
 * upgrades or fails autonomous purchase state only from persisted provider data.
 */
export async function reconcileAutonomousCardAuthorization(cardAuthorizationId: string) {
  return db.$transaction(async (tx) => {
    const authorization = await tx.cardAuthorization.findUnique({ where: { id: cardAuthorizationId } });
    if (!authorization) return null;
    const rows = await tx.$queryRaw<Array<{
      id: string;
      organization_id: string;
      payment_intent_id: string;
      status: string;
      result_code: string | null;
    }>>`
      SELECT "id", "organization_id", "payment_intent_id", "status", "result_code"
      FROM "autonomous_card_purchase"
      WHERE "card_authorization_id" = ${cardAuthorizationId}::uuid
      LIMIT 1
      FOR UPDATE
    `;
    const purchase = rows[0];
    if (!purchase) return null;

    const failed = authorization.approved === false || authorization.status === "DECLINED" || authorization.status === "REVERSED";
    const settled = authorization.approved === true && authorization.status === "CLOSED";
    const authorized = authorization.approved === true && ["APPROVED", "PENDING", "CLOSED"].includes(authorization.status);
    let eventType: string | null = null;
    let resultCode: string | null = null;

    if (failed) {
      resultCode = authorization.status === "REVERSED" ? "PROVIDER_AUTHORIZATION_REVERSED" : "PROVIDER_AUTHORIZATION_DECLINED";
      await tx.$executeRaw`
        UPDATE "autonomous_card_purchase"
        SET "status" = 'CHECKOUT_FAILED',
            "result_code" = ${resultCode},
            "lease_token" = NULL,
            "lease_expires_at" = NULL,
            "completed_at" = NOW(),
            "updated_at" = NOW()
        WHERE "id" = ${purchase.id}::uuid
          AND "status" IN ('EXECUTING','REQUIRES_HUMAN','CHECKOUT_SUCCEEDED')
      `;
      await tx.paymentIntent.updateMany({
        where: { id: purchase.payment_intent_id, status: { in: ["AUTHORIZED", "SUBMITTED", "SUBMISSION_UNKNOWN"] } },
        data: { status: "SETTLEMENT_FAILED" },
      });
      eventType = "CARD_PURCHASE_PROVIDER_FAILED";
    } else if (settled) {
      resultCode = "PROVIDER_SETTLEMENT_CONFIRMED";
      await tx.$executeRaw`
        UPDATE "autonomous_card_purchase"
        SET "status" = 'CHECKOUT_SUCCEEDED',
            "result_code" = ${resultCode},
            "lease_token" = NULL,
            "lease_expires_at" = NULL,
            "completed_at" = COALESCE("completed_at", NOW()),
            "updated_at" = NOW()
        WHERE "id" = ${purchase.id}::uuid
          AND "status" IN ('EXECUTING','REQUIRES_HUMAN','CHECKOUT_SUCCEEDED')
      `;
      await tx.paymentIntent.updateMany({
        where: { id: purchase.payment_intent_id, status: { in: ["AUTHORIZED", "SUBMITTED", "SUBMISSION_UNKNOWN"] } },
        data: { status: "SETTLED" },
      });
      eventType = "CARD_PURCHASE_PROVIDER_SETTLED";
    } else if (authorized) {
      await tx.paymentIntent.updateMany({
        where: { id: purchase.payment_intent_id, status: { in: ["AUTHORIZED", "SUBMISSION_UNKNOWN"] } },
        data: { status: "SUBMITTED" },
      });
      eventType = "CARD_PURCHASE_PROVIDER_AUTHORIZED";
    }

    if (!eventType) return { purchaseId: purchase.id, changed: false };
    await tx.auditEvent.create({
      data: {
        organizationId: purchase.organization_id,
        actorType: "PROVIDER",
        action: eventType,
        targetType: "CARD_PURCHASE",
        targetId: purchase.id,
        result: failed ? "FAILURE" : "SUCCESS",
        metadata: { paymentIntentId: purchase.payment_intent_id, cardAuthorizationId, providerStatus: authorization.status, approved: authorization.approved, resultCode },
      },
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: purchase.organization_id,
        eventType,
        aggregateType: "CARD_PURCHASE",
        aggregateId: purchase.id,
        payload: { paymentIntentId: purchase.payment_intent_id, cardAuthorizationId, providerStatus: authorization.status, approved: authorization.approved, resultCode },
      },
    });
    return { purchaseId: purchase.id, changed: true, eventType, resultCode };
  }, { isolationLevel: "Serializable" });
}
