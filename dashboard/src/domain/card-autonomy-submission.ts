import { randomUUID } from "node:crypto";

import { getCardPurchase } from "@/domain/card-autonomy-repository";
import { db } from "@/lib/db";

export async function leaseCrashSafeCardPurchase(input: { leaseSeconds: number; maxAttempts: number }) {
  const result = await db.$transaction(async (tx) => {
    const stale = await tx.$queryRaw<Array<{ id: string; organization_id: string; payment_intent_id: string }>>`
      UPDATE "autonomous_card_purchase"
      SET "status" = 'REQUIRES_HUMAN',
          "result_code" = 'SUBMISSION_UNKNOWN',
          "lease_token" = NULL,
          "lease_expires_at" = NULL,
          "updated_at" = NOW()
      WHERE "status" = 'EXECUTING'
        AND "lease_expires_at" < NOW()
        AND "submission_started_at" IS NOT NULL
      RETURNING "id", "organization_id", "payment_intent_id"
    `;
    for (const row of stale) {
      await tx.auditEvent.create({ data: { organizationId: row.organization_id, actorType: "SYSTEM", action: "CARD_PURCHASE_SUBMISSION_UNKNOWN", targetType: "CARD_PURCHASE", targetId: row.id, result: "DENIED", metadata: { paymentIntentId: row.payment_intent_id, reason: "EXECUTOR_LEASE_EXPIRED_AFTER_SUBMIT" } } });
      await tx.outboxEvent.create({ data: { organizationId: row.organization_id, eventType: "CARD_PURCHASE_REQUIRES_HUMAN", aggregateType: "CARD_PURCHASE", aggregateId: row.id, payload: { paymentIntentId: row.payment_intent_id, resultCode: "SUBMISSION_UNKNOWN" } } });
    }

    const leaseToken = randomUUID();
    const leased = await tx.$queryRaw<Array<{ id: string }>>`
      WITH candidate AS (
        SELECT p."id"
        FROM "autonomous_card_purchase" p
        WHERE (
          p."status" = 'READY'
          OR (p."status" = 'EXECUTING' AND p."lease_expires_at" < NOW() AND p."submission_started_at" IS NULL)
        )
        AND p."executor_attempt" < ${input.maxAttempts}
        AND NOT EXISTS (
          SELECT 1 FROM "autonomous_card_purchase" active
          WHERE active."virtual_card_id" = p."virtual_card_id"
            AND active."status" = 'EXECUTING'
            AND active."lease_expires_at" >= NOW()
            AND active."id" <> p."id"
        )
        ORDER BY p."created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE "autonomous_card_purchase" AS p
      SET "status" = 'EXECUTING',
          "lease_token" = ${leaseToken}::uuid,
          "lease_expires_at" = NOW() + (${input.leaseSeconds} * INTERVAL '1 second'),
          "executor_attempt" = p."executor_attempt" + 1,
          "started_at" = COALESCE(p."started_at", NOW()),
          "updated_at" = NOW()
      FROM candidate
      WHERE p."id" = candidate."id"
      RETURNING p."id"
    `;
    return leased[0]?.id ?? null;
  }, { isolationLevel: "Serializable" });
  return result ? await getCardPurchase(result) : null;
}

export async function markCardPurchaseSubmitting(purchaseId: string, leaseToken: string) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string; organization_id: string; payment_intent_id: string }>>`
      UPDATE "autonomous_card_purchase"
      SET "submission_started_at" = NOW(), "updated_at" = NOW()
      WHERE "id" = ${purchaseId}::uuid
        AND "status" = 'EXECUTING'
        AND "lease_token" = ${leaseToken}::uuid
        AND "lease_expires_at" > NOW()
        AND "submission_started_at" IS NULL
      RETURNING "id", "organization_id", "payment_intent_id"
    `;
    const row = rows[0];
    if (!row) return false;
    await tx.auditEvent.create({ data: { organizationId: row.organization_id, actorType: "SYSTEM", action: "CARD_PURCHASE_SUBMISSION_STARTED", targetType: "CARD_PURCHASE", targetId: row.id, result: "SUCCESS", metadata: { paymentIntentId: row.payment_intent_id } } });
    return true;
  }, { isolationLevel: "Serializable" });
}

export async function hasCardPurchaseSubmissionStarted(purchaseId: string, leaseToken: string) {
  const rows = await db.$queryRaw<Array<{ started: boolean }>>`
    SELECT ("submission_started_at" IS NOT NULL) AS "started"
    FROM "autonomous_card_purchase"
    WHERE "id" = ${purchaseId}::uuid
      AND "status" = 'EXECUTING'
      AND "lease_token" = ${leaseToken}::uuid
      AND "lease_expires_at" > NOW()
    LIMIT 1
  `;
  return rows[0]?.started ?? false;
}
