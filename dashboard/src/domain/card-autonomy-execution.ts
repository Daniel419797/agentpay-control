import { db } from "@/lib/db";

import type { CardAutonomyMode, CardAutonomyOverLimitAction, CardAutonomyPolicy, CardPurchaseRecord, CardPurchaseStatus } from "@/domain/card-autonomy-repository";

export type CardPurchaseExecutionState = {
  id: string;
  organizationId: string;
  paymentIntentId: string;
  status: CardPurchaseStatus;
  submissionStartedAt: Date | null;
  cardAuthorizationId: string | null;
};

type ExecutionRow = {
  id: string;
  organization_id: string;
  payment_intent_id: string;
  status: CardPurchaseStatus;
  submission_started_at: Date | null;
  card_authorization_id: string | null;
};

type PurchaseRow = {
  id: string;
  organization_id: string;
  agent_id: string;
  virtual_card_id: string;
  payment_intent_id: string;
  idempotency_key: string;
  request_hash: string;
  merchant_url: string;
  merchant_host: string;
  amount_minor: unknown;
  currency: string;
  merchant_category: string | null;
  merchant_country: string | null;
  purpose: string | null;
  checkout_plan_encrypted: string;
  policy_version: number;
  status: CardPurchaseStatus;
  executor_attempt: number;
  lease_token: string | null;
  lease_expires_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  result_code: string | null;
  result_url: string | null;
  result_summary: unknown;
  created_at: Date;
  updated_at: Date;
};

type PolicyRow = {
  virtual_card_id: string;
  organization_id: string;
  agent_id: string;
  mode: CardAutonomyMode;
  per_purchase_auto_limit_minor: unknown;
  over_limit_action: CardAutonomyOverLimitAction;
  allowed_hosts: string[];
  denied_hosts: string[];
  require_purpose: boolean;
  max_checkout_seconds: number;
  version: number;
  created_at: Date;
  updated_at: Date;
};

function mapPurchase(row: PurchaseRow): CardPurchaseRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    virtualCardId: row.virtual_card_id,
    paymentIntentId: row.payment_intent_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    merchantUrl: row.merchant_url,
    merchantHost: row.merchant_host,
    amountMinor: String(row.amount_minor),
    currency: row.currency,
    merchantCategory: row.merchant_category,
    merchantCountry: row.merchant_country,
    purpose: row.purpose,
    checkoutPlanEncrypted: row.checkout_plan_encrypted,
    policyVersion: row.policy_version,
    status: row.status,
    executorAttempt: row.executor_attempt,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultCode: row.result_code,
    resultUrl: row.result_url,
    resultSummary: row.result_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPolicy(row: PolicyRow): CardAutonomyPolicy {
  return {
    virtualCardId: row.virtual_card_id,
    organizationId: row.organization_id,
    agentId: row.agent_id,
    mode: row.mode,
    perPurchaseAutoLimitMinor: row.per_purchase_auto_limit_minor === null ? null : String(row.per_purchase_auto_limit_minor),
    overLimitAction: row.over_limit_action,
    allowedHosts: row.allowed_hosts ?? [],
    deniedHosts: row.denied_hosts ?? [],
    requirePurpose: row.require_purpose,
    maxCheckoutSeconds: row.max_checkout_seconds,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function pgTextArray(values: string[]) {
  return `{${values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
}

export async function getCardPurchaseExecutionState(purchaseId: string): Promise<CardPurchaseExecutionState | null> {
  const rows = await db.$queryRaw<ExecutionRow[]>`
    SELECT "id", "organization_id", "payment_intent_id", "status", "submission_started_at", "card_authorization_id"
    FROM "autonomous_card_purchase"
    WHERE "id" = ${purchaseId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  return row ? {
    id: row.id,
    organizationId: row.organization_id,
    paymentIntentId: row.payment_intent_id,
    status: row.status,
    submissionStartedAt: row.submission_started_at,
    cardAuthorizationId: row.card_authorization_id,
  } : null;
}

export async function putCardAutonomyPolicySafely(input: {
  virtualCardId: string;
  organizationId: string;
  agentId: string;
  mode: CardAutonomyMode;
  perPurchaseAutoLimitMinor: string | null;
  overLimitAction: CardAutonomyOverLimitAction;
  allowedHosts: string[];
  deniedHosts: string[];
  requirePurpose: boolean;
  maxCheckoutSeconds: number;
  actorUserId: string;
}) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`card-autonomy-policy:${input.virtualCardId}`}, 0))`;
    const rows = await tx.$queryRaw<PolicyRow[]>`
      INSERT INTO "card_autonomy_policy" (
        "virtual_card_id", "organization_id", "agent_id", "mode", "per_purchase_auto_limit_minor",
        "over_limit_action", "allowed_hosts", "denied_hosts", "require_purpose", "max_checkout_seconds"
      ) VALUES (
        ${input.virtualCardId}::uuid, ${input.organizationId}::uuid, ${input.agentId}::uuid, ${input.mode},
        ${input.perPurchaseAutoLimitMinor}::numeric, ${input.overLimitAction}, ${pgTextArray(input.allowedHosts)}::text[],
        ${pgTextArray(input.deniedHosts)}::text[], ${input.requirePurpose}, ${input.maxCheckoutSeconds}
      )
      ON CONFLICT ("virtual_card_id") DO UPDATE SET
        "mode" = EXCLUDED."mode",
        "per_purchase_auto_limit_minor" = EXCLUDED."per_purchase_auto_limit_minor",
        "over_limit_action" = EXCLUDED."over_limit_action",
        "allowed_hosts" = EXCLUDED."allowed_hosts",
        "denied_hosts" = EXCLUDED."denied_hosts",
        "require_purpose" = EXCLUDED."require_purpose",
        "max_checkout_seconds" = EXCLUDED."max_checkout_seconds",
        "version" = "card_autonomy_policy"."version" + 1,
        "updated_at" = NOW()
      RETURNING *
    `;
    const policy = mapPolicy(rows[0]!);

    if (input.mode === "DISABLED") {
      const canceled = await tx.$queryRaw<Array<{ id: string; payment_intent_id: string }>>`
        UPDATE "autonomous_card_purchase"
        SET "status" = 'CANCELED',
            "lease_token" = NULL,
            "lease_expires_at" = NULL,
            "result_code" = 'AUTONOMY_DISABLED',
            "completed_at" = NOW(),
            "updated_at" = NOW()
        WHERE "virtual_card_id" = ${input.virtualCardId}::uuid
          AND (
            "status" IN ('READY','APPROVAL_PENDING')
            OR ("status" = 'EXECUTING' AND "submission_started_at" IS NULL)
          )
        RETURNING "id", "payment_intent_id"
      `;
      if (canceled.length) {
        await tx.paymentIntent.updateMany({
          where: { id: { in: canceled.map((row) => row.payment_intent_id) }, status: { in: ["AUTHORIZED", "APPROVAL_PENDING"] } },
          data: { status: "CANCELED" },
        });
      }

      const ambiguous = await tx.$queryRaw<Array<{ id: string; payment_intent_id: string }>>`
        UPDATE "autonomous_card_purchase"
        SET "status" = 'REQUIRES_HUMAN',
            "lease_token" = NULL,
            "lease_expires_at" = NULL,
            "result_code" = 'SUBMISSION_UNKNOWN',
            "completed_at" = NULL,
            "updated_at" = NOW()
        WHERE "virtual_card_id" = ${input.virtualCardId}::uuid
          AND "status" = 'EXECUTING'
          AND "submission_started_at" IS NOT NULL
        RETURNING "id", "payment_intent_id"
      `;
      if (ambiguous.length) {
        await tx.paymentIntent.updateMany({
          where: { id: { in: ambiguous.map((row) => row.payment_intent_id) }, status: "AUTHORIZED" },
          data: { status: "SUBMISSION_UNKNOWN" },
        });
        for (const row of ambiguous) {
          await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorType: "SYSTEM", action: "CARD_PURCHASE_SUBMISSION_UNKNOWN", targetType: "CARD_PURCHASE", targetId: row.id, result: "DENIED", metadata: { paymentIntentId: row.payment_intent_id, reason: "AUTONOMY_DISABLED_AFTER_CREDENTIAL_BOUNDARY" } } });
          await tx.outboxEvent.create({ data: { organizationId: input.organizationId, eventType: "CARD_PURCHASE_REQUIRES_HUMAN", aggregateType: "CARD_PURCHASE", aggregateId: row.id, payload: { paymentIntentId: row.payment_intent_id, resultCode: "SUBMISSION_UNKNOWN" } } });
        }
      }
    }

    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: "USER",
        actorId: input.actorUserId,
        action: "CARD_AUTONOMY_POLICY_UPDATED",
        targetType: "VIRTUAL_CARD",
        targetId: input.virtualCardId,
        result: "SUCCESS",
        metadata: {
          mode: policy.mode,
          version: policy.version,
          perPurchaseAutoLimitMinor: policy.perPurchaseAutoLimitMinor,
          overLimitAction: policy.overLimitAction,
          allowedHosts: policy.allowedHosts,
          deniedHosts: policy.deniedHosts,
          requirePurpose: policy.requirePurpose,
          maxCheckoutSeconds: policy.maxCheckoutSeconds,
        },
      },
    });
    return policy;
  }, { isolationLevel: "Serializable" });
}

export async function cancelLeasedCardPurchaseSafely(purchaseId: string, leaseToken: string, resultCode: string) {
  return db.$transaction(async (tx) => {
    const states = await tx.$queryRaw<ExecutionRow[]>`
      SELECT "id", "organization_id", "payment_intent_id", "status", "submission_started_at", "card_authorization_id"
      FROM "autonomous_card_purchase"
      WHERE "id" = ${purchaseId}::uuid
        AND "status" = 'EXECUTING'
        AND "lease_token" = ${leaseToken}::uuid
      FOR UPDATE
    `;
    const state = states[0];
    if (!state) return null;
    const ambiguous = state.submission_started_at !== null;
    const rows = await tx.$queryRaw<PurchaseRow[]>`
      UPDATE "autonomous_card_purchase"
      SET "status" = ${ambiguous ? "REQUIRES_HUMAN" : "CANCELED"},
          "result_code" = ${ambiguous ? "SUBMISSION_UNKNOWN" : resultCode},
          "lease_token" = NULL,
          "lease_expires_at" = NULL,
          "completed_at" = ${ambiguous ? null : new Date()},
          "updated_at" = NOW()
      WHERE "id" = ${purchaseId}::uuid
        AND "status" = 'EXECUTING'
        AND "lease_token" = ${leaseToken}::uuid
      RETURNING *
    `;
    const row = rows[0];
    if (!row) return null;
    if (ambiguous) {
      await tx.paymentIntent.updateMany({ where: { id: state.payment_intent_id, status: "AUTHORIZED" }, data: { status: "SUBMISSION_UNKNOWN" } });
      await tx.auditEvent.create({ data: { organizationId: state.organization_id, actorType: "SYSTEM", action: "CARD_PURCHASE_SUBMISSION_UNKNOWN", targetType: "CARD_PURCHASE", targetId: purchaseId, result: "DENIED", metadata: { paymentIntentId: state.payment_intent_id, reason: resultCode } } });
    } else {
      await tx.paymentIntent.updateMany({ where: { id: state.payment_intent_id, status: "AUTHORIZED" }, data: { status: "CANCELED" } });
    }
    return mapPurchase(row);
  }, { isolationLevel: "Serializable" });
}

export async function completeLeasedCardPurchaseSafely(input: {
  purchaseId: string;
  leaseToken: string;
  status: "CHECKOUT_SUCCEEDED" | "CHECKOUT_FAILED" | "REQUIRES_HUMAN";
  resultCode: string;
  resultUrl?: string;
  resultSummary?: unknown;
}) {
  return db.$transaction(async (tx) => {
    const states = await tx.$queryRaw<ExecutionRow[]>`
      SELECT "id", "organization_id", "payment_intent_id", "status", "submission_started_at", "card_authorization_id"
      FROM "autonomous_card_purchase"
      WHERE "id" = ${input.purchaseId}::uuid
        AND "status" = 'EXECUTING'
        AND "lease_token" = ${input.leaseToken}::uuid
        AND "lease_expires_at" > NOW()
      FOR UPDATE
    `;
    const state = states[0];
    if (!state) return null;

    let effectiveStatus = input.status;
    let effectiveCode = input.resultCode;
    if (input.status === "CHECKOUT_SUCCEEDED" && !state.submission_started_at) {
      effectiveStatus = "REQUIRES_HUMAN";
      effectiveCode = "SUBMISSION_CHECKPOINT_MISSING";
    } else if (input.status === "CHECKOUT_FAILED" && state.submission_started_at) {
      effectiveStatus = "REQUIRES_HUMAN";
      effectiveCode = "SUBMISSION_UNKNOWN";
    }

    const rows = await tx.$queryRaw<PurchaseRow[]>`
      UPDATE "autonomous_card_purchase"
      SET "status" = ${effectiveStatus},
          "result_code" = ${effectiveCode},
          "result_url" = ${input.resultUrl ?? null},
          "result_summary" = ${JSON.stringify(input.resultSummary ?? {})}::jsonb,
          "lease_token" = NULL,
          "lease_expires_at" = NULL,
          "completed_at" = CASE WHEN ${effectiveStatus} = 'REQUIRES_HUMAN' THEN NULL ELSE NOW() END,
          "updated_at" = NOW()
      WHERE "id" = ${input.purchaseId}::uuid
        AND "status" = 'EXECUTING'
        AND "lease_token" = ${input.leaseToken}::uuid
      RETURNING *
    `;
    const row = rows[0];
    if (!row) return null;
    const purchase = mapPurchase(row);

    if (effectiveStatus === "CHECKOUT_SUCCEEDED") {
      await tx.paymentIntent.updateMany({ where: { id: purchase.paymentIntentId, status: "AUTHORIZED" }, data: { status: "SUBMITTED" } });
    } else if (effectiveStatus === "CHECKOUT_FAILED") {
      await tx.paymentIntent.updateMany({ where: { id: purchase.paymentIntentId, status: "AUTHORIZED" }, data: { status: "FAILED_BEFORE_SUBMISSION" } });
    } else if (state.submission_started_at) {
      await tx.paymentIntent.updateMany({ where: { id: purchase.paymentIntentId, status: { in: ["AUTHORIZED", "SUBMITTED"] } }, data: { status: "SUBMISSION_UNKNOWN" } });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: purchase.organizationId,
        actorType: "SYSTEM",
        action: `CARD_PURCHASE_${effectiveStatus}`,
        targetType: "CARD_PURCHASE",
        targetId: purchase.id,
        result: effectiveStatus === "CHECKOUT_FAILED" ? "FAILURE" : effectiveStatus === "REQUIRES_HUMAN" ? "DENIED" : "SUCCESS",
        metadata: { paymentIntentId: purchase.paymentIntentId, resultCode: effectiveCode, resultUrl: input.resultUrl ?? null, executorAttempt: purchase.executorAttempt, submissionStarted: Boolean(state.submission_started_at), cardAuthorizationId: state.card_authorization_id },
      },
    });
    await tx.outboxEvent.create({
      data: { organizationId: purchase.organizationId, eventType: `CARD_PURCHASE_${effectiveStatus}`, aggregateType: "CARD_PURCHASE", aggregateId: purchase.id, payload: { paymentIntentId: purchase.paymentIntentId, agentId: purchase.agentId, merchantHost: purchase.merchantHost, amountMinor: purchase.amountMinor, currency: purchase.currency, resultCode: effectiveCode } },
    });
    return purchase;
  }, { isolationLevel: "Serializable" });
}
