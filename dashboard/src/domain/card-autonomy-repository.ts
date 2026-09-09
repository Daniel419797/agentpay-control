import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";

export type CardAutonomyMode = "DISABLED" | "APPROVAL_REQUIRED" | "LIMITED" | "MERCHANT_ALLOWLIST" | "BROAD";
export type CardAutonomyOverLimitAction = "DENY" | "REQUIRE_APPROVAL";
export type CardPurchaseStatus = "APPROVAL_PENDING" | "READY" | "EXECUTING" | "CHECKOUT_SUCCEEDED" | "CHECKOUT_FAILED" | "REQUIRES_HUMAN" | "REJECTED" | "CANCELED" | "EXPIRED";

export type CardAutonomyPolicy = {
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
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type CardPurchaseRecord = {
  id: string;
  organizationId: string;
  agentId: string;
  virtualCardId: string;
  paymentIntentId: string;
  idempotencyKey: string;
  requestHash: string;
  merchantUrl: string;
  merchantHost: string;
  amountMinor: string;
  currency: string;
  merchantCategory: string | null;
  merchantCountry: string | null;
  purpose: string | null;
  checkoutPlanEncrypted: string;
  policyVersion: number;
  status: CardPurchaseStatus;
  executorAttempt: number;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  resultCode: string | null;
  resultUrl: string | null;
  resultSummary: unknown;
  createdAt: Date;
  updatedAt: Date;
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

function pgTextArray(values: string[]) {
  return `{${values.map((value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(",")}}`;
}

export async function getCardAutonomyPolicy(virtualCardId: string) {
  const rows = await db.$queryRaw<PolicyRow[]>`
    SELECT * FROM "card_autonomy_policy" WHERE "virtual_card_id" = ${virtualCardId}::uuid LIMIT 1
  `;
  return rows[0] ? mapPolicy(rows[0]) : null;
}

export async function putCardAutonomyPolicy(input: {
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
      const canceled = await tx.$queryRaw<Array<{ payment_intent_id: string }>>`
        UPDATE "autonomous_card_purchase"
        SET "status" = 'CANCELED', "lease_token" = NULL, "lease_expires_at" = NULL,
            "result_code" = 'AUTONOMY_DISABLED', "completed_at" = NOW(), "updated_at" = NOW()
        WHERE "virtual_card_id" = ${input.virtualCardId}::uuid
          AND "status" IN ('READY','EXECUTING','APPROVAL_PENDING')
        RETURNING "payment_intent_id"
      `;
      if (canceled.length) {
        await tx.paymentIntent.updateMany({
          where: { id: { in: canceled.map((row) => row.payment_intent_id) }, status: { in: ["AUTHORIZED", "APPROVAL_PENDING"] } },
          data: { status: "CANCELED" },
        });
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

export async function findPurchaseByIdempotency(organizationId: string, agentId: string, idempotencyKey: string) {
  const rows = await db.$queryRaw<PurchaseRow[]>`
    SELECT * FROM "autonomous_card_purchase"
    WHERE "organization_id" = ${organizationId}::uuid AND "agent_id" = ${agentId}::uuid AND "idempotency_key" = ${idempotencyKey}
    LIMIT 1
  `;
  return rows[0] ? mapPurchase(rows[0]) : null;
}

export async function getCardPurchase(purchaseId: string) {
  const rows = await db.$queryRaw<PurchaseRow[]>`
    SELECT * FROM "autonomous_card_purchase" WHERE "id" = ${purchaseId}::uuid LIMIT 1
  `;
  return rows[0] ? mapPurchase(rows[0]) : null;
}

export async function getCardPurchaseByPaymentIntent(paymentIntentId: string) {
  const rows = await db.$queryRaw<PurchaseRow[]>`
    SELECT * FROM "autonomous_card_purchase" WHERE "payment_intent_id" = ${paymentIntentId}::uuid LIMIT 1
  `;
  return rows[0] ? mapPurchase(rows[0]) : null;
}

export async function listAgentCardPurchases(agentId: string, limit = 50) {
  const rows = await db.$queryRaw<PurchaseRow[]>`
    SELECT * FROM "autonomous_card_purchase"
    WHERE "agent_id" = ${agentId}::uuid
    ORDER BY "created_at" DESC
    LIMIT ${Math.min(Math.max(limit, 1), 100)}
  `;
  return rows.map(mapPurchase);
}

export async function createCardPurchaseRecord(input: {
  organizationId: string;
  agentId: string;
  virtualCardId: string;
  idempotencyKey: string;
  requestHash: string;
  merchantUrl: string;
  merchantHost: string;
  amountMinor: string;
  currency: string;
  merchantCategory?: string;
  merchantCountry?: string;
  purpose?: string;
  checkoutPlanEncrypted: string;
  policyVersion: number;
  requiresApproval: boolean;
  initiatedByUserId?: string;
  approvalExpiresAt?: Date;
}) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`card-purchase:${input.organizationId}:${input.agentId}:${input.idempotencyKey}`}, 0))`;
    const existingRows = await tx.$queryRaw<PurchaseRow[]>`
      SELECT * FROM "autonomous_card_purchase"
      WHERE "organization_id" = ${input.organizationId}::uuid AND "agent_id" = ${input.agentId}::uuid AND "idempotency_key" = ${input.idempotencyKey}
      LIMIT 1
    `;
    if (existingRows[0]) {
      const existing = mapPurchase(existingRows[0]);
      if (existing.requestHash !== input.requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
      return { purchase: existing, approvalId: null as string | null, existing: true };
    }

    const paymentIntent = await tx.paymentIntent.create({
      data: {
        organizationId: input.organizationId,
        agentId: input.agentId,
        idempotencyKey: `card:${input.idempotencyKey}`,
        requestHash: input.requestHash,
        resourceUrl: input.merchantUrl,
        merchantHost: input.merchantHost,
        purpose: input.purpose,
        status: input.requiresApproval ? "APPROVAL_PENDING" : "AUTHORIZED",
      },
    });
    const id = randomUUID();
    const status: CardPurchaseStatus = input.requiresApproval ? "APPROVAL_PENDING" : "READY";
    const rows = await tx.$queryRaw<PurchaseRow[]>`
      INSERT INTO "autonomous_card_purchase" (
        "id", "organization_id", "agent_id", "virtual_card_id", "payment_intent_id", "idempotency_key",
        "request_hash", "merchant_url", "merchant_host", "amount_minor", "currency", "merchant_category",
        "merchant_country", "purpose", "checkout_plan_encrypted", "policy_version", "status"
      ) VALUES (
        ${id}::uuid, ${input.organizationId}::uuid, ${input.agentId}::uuid, ${input.virtualCardId}::uuid,
        ${paymentIntent.id}::uuid, ${input.idempotencyKey}, ${input.requestHash}, ${input.merchantUrl}, ${input.merchantHost},
        ${input.amountMinor}::numeric, ${input.currency}, ${input.merchantCategory ?? null}, ${input.merchantCountry ?? null},
        ${input.purpose ?? null}, ${input.checkoutPlanEncrypted}, ${input.policyVersion}, ${status}
      ) RETURNING *
    `;
    let approvalId: string | null = null;
    if (input.requiresApproval) {
      const approval = await tx.approvalRequest.create({
        data: {
          paymentIntentId: paymentIntent.id,
          status: "PENDING",
          requestPurpose: input.purpose,
          expiresAt: input.approvalExpiresAt ?? new Date(Date.now() + 30 * 60_000),
          requiredApprovals: 1,
          requiredRejections: 1,
        },
      });
      approvalId = approval.id;
    }
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: input.initiatedByUserId ? "USER" : "AGENT",
        actorId: input.initiatedByUserId ?? input.agentId,
        action: "PAYMENT_REQUEST_INITIATED",
        targetType: "PAYMENT_INTENT",
        targetId: paymentIntent.id,
        result: "SUCCESS",
        metadata: { rail: "VIRTUAL_CARD", cardPurchaseId: id, virtualCardId: input.virtualCardId, amountMinor: input.amountMinor, currency: input.currency, merchantHost: input.merchantHost },
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        actorType: input.initiatedByUserId ? "USER" : "AGENT",
        actorId: input.initiatedByUserId ?? input.agentId,
        action: input.requiresApproval ? "CARD_PURCHASE_APPROVAL_REQUIRED" : "CARD_PURCHASE_AUTHORIZED",
        targetType: "CARD_PURCHASE",
        targetId: id,
        result: "SUCCESS",
        metadata: { paymentIntentId: paymentIntent.id, policyVersion: input.policyVersion, merchantHost: input.merchantHost, amountMinor: input.amountMinor, currency: input.currency },
      },
    });
    if (!input.requiresApproval) {
      await tx.outboxEvent.create({
        data: { organizationId: input.organizationId, eventType: "CARD_PURCHASE_READY", aggregateType: "CARD_PURCHASE", aggregateId: id, payload: { paymentIntentId: paymentIntent.id, agentId: input.agentId, virtualCardId: input.virtualCardId, merchantHost: input.merchantHost, amountMinor: input.amountMinor, currency: input.currency } },
      });
    }
    return { purchase: mapPurchase(rows[0]!), approvalId, existing: false };
  }, { isolationLevel: "Serializable" });
}

export async function sumReservedCardPurchases(virtualCardId: string, excludePurchaseId?: string) {
  const rows = await db.$queryRaw<Array<{ total: unknown }>>`
    SELECT COALESCE(SUM("amount_minor"), 0) AS "total"
    FROM "autonomous_card_purchase"
    WHERE "virtual_card_id" = ${virtualCardId}::uuid
      AND "status" IN ('READY','EXECUTING')
      AND (${excludePurchaseId ?? null}::uuid IS NULL OR "id" <> ${excludePurchaseId ?? null}::uuid)
  `;
  return BigInt(String(rows[0]?.total ?? 0));
}

export async function markPurchaseReadyAfterApproval(paymentIntentId: string, expectedPolicyVersion: number) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<PurchaseRow[]>`
      UPDATE "autonomous_card_purchase"
      SET "status" = 'READY', "updated_at" = NOW()
      WHERE "payment_intent_id" = ${paymentIntentId}::uuid
        AND "status" = 'APPROVAL_PENDING'
        AND "policy_version" = ${expectedPolicyVersion}
      RETURNING *
    `;
    if (!rows[0]) return null;
    const purchase = mapPurchase(rows[0]);
    await tx.outboxEvent.create({ data: { organizationId: purchase.organizationId, eventType: "CARD_PURCHASE_READY", aggregateType: "CARD_PURCHASE", aggregateId: purchase.id, payload: { paymentIntentId, agentId: purchase.agentId, virtualCardId: purchase.virtualCardId, merchantHost: purchase.merchantHost, amountMinor: purchase.amountMinor, currency: purchase.currency } } });
    await tx.auditEvent.create({ data: { organizationId: purchase.organizationId, actorType: "SYSTEM", action: "CARD_PURCHASE_APPROVAL_CONSUMED", targetType: "CARD_PURCHASE", targetId: purchase.id, result: "SUCCESS", metadata: { paymentIntentId, policyVersion: purchase.policyVersion } } });
    return purchase;
  }, { isolationLevel: "Serializable" });
}

export async function rejectCardPurchaseByPaymentIntent(paymentIntentId: string) {
  const rows = await db.$queryRaw<PurchaseRow[]>`
    UPDATE "autonomous_card_purchase"
    SET "status" = 'REJECTED', "result_code" = 'HUMAN_REJECTED', "completed_at" = NOW(), "updated_at" = NOW()
    WHERE "payment_intent_id" = ${paymentIntentId}::uuid AND "status" = 'APPROVAL_PENDING'
    RETURNING *
  `;
  return rows[0] ? mapPurchase(rows[0]) : null;
}

export async function leaseCardPurchase(input: { leaseSeconds: number; maxAttempts: number }) {
  const leaseToken = randomUUID();
  const rows = await db.$queryRaw<PurchaseRow[]>`
    WITH candidate AS (
      SELECT "id"
      FROM "autonomous_card_purchase"
      WHERE (
        "status" = 'READY'
        OR ("status" = 'EXECUTING' AND "lease_expires_at" < NOW())
      )
      AND "executor_attempt" < ${input.maxAttempts}
      ORDER BY "created_at" ASC
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
    RETURNING p.*
  `;
  return rows[0] ? mapPurchase(rows[0]) : null;
}

export async function heartbeatCardPurchase(purchaseId: string, leaseToken: string, leaseSeconds: number) {
  const rows = await db.$queryRaw<PurchaseRow[]>`
    UPDATE "autonomous_card_purchase"
    SET "lease_expires_at" = NOW() + (${leaseSeconds} * INTERVAL '1 second'), "updated_at" = NOW()
    WHERE "id" = ${purchaseId}::uuid AND "status" = 'EXECUTING' AND "lease_token" = ${leaseToken}::uuid AND "lease_expires_at" > NOW()
    RETURNING *
  `;
  return rows[0] ? mapPurchase(rows[0]) : null;
}

export async function cancelLeasedPurchase(purchaseId: string, leaseToken: string, resultCode: string) {
  const rows = await db.$queryRaw<PurchaseRow[]>`
    UPDATE "autonomous_card_purchase"
    SET "status" = 'CANCELED', "result_code" = ${resultCode}, "lease_token" = NULL, "lease_expires_at" = NULL,
        "completed_at" = NOW(), "updated_at" = NOW()
    WHERE "id" = ${purchaseId}::uuid AND "status" = 'EXECUTING' AND "lease_token" = ${leaseToken}::uuid
    RETURNING *
  `;
  if (rows[0]) await db.paymentIntent.updateMany({ where: { id: rows[0].payment_intent_id, status: "AUTHORIZED" }, data: { status: "CANCELED" } });
  return rows[0] ? mapPurchase(rows[0]) : null;
}

export async function completeLeasedCardPurchase(input: {
  purchaseId: string;
  leaseToken: string;
  status: "CHECKOUT_SUCCEEDED" | "CHECKOUT_FAILED" | "REQUIRES_HUMAN";
  resultCode: string;
  resultUrl?: string;
  resultSummary?: unknown;
}) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<PurchaseRow[]>`
      UPDATE "autonomous_card_purchase"
      SET "status" = ${input.status}, "result_code" = ${input.resultCode}, "result_url" = ${input.resultUrl ?? null},
          "result_summary" = ${JSON.stringify(input.resultSummary ?? {})}::jsonb,
          "lease_token" = NULL, "lease_expires_at" = NULL,
          "completed_at" = CASE WHEN ${input.status} = 'REQUIRES_HUMAN' THEN NULL ELSE NOW() END,
          "updated_at" = NOW()
      WHERE "id" = ${input.purchaseId}::uuid AND "status" = 'EXECUTING'
        AND "lease_token" = ${input.leaseToken}::uuid AND "lease_expires_at" > NOW()
      RETURNING *
    `;
    if (!rows[0]) return null;
    const purchase = mapPurchase(rows[0]);
    if (input.status === "CHECKOUT_SUCCEEDED") {
      await tx.paymentIntent.updateMany({ where: { id: purchase.paymentIntentId, status: "AUTHORIZED" }, data: { status: "SUBMITTED" } });
    } else if (input.status === "CHECKOUT_FAILED") {
      await tx.paymentIntent.updateMany({ where: { id: purchase.paymentIntentId, status: "AUTHORIZED" }, data: { status: "FAILED_BEFORE_SUBMISSION" } });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: purchase.organizationId,
        actorType: "SYSTEM",
        action: `CARD_PURCHASE_${input.status}`,
        targetType: "CARD_PURCHASE",
        targetId: purchase.id,
        result: input.status === "CHECKOUT_FAILED" ? "FAILURE" : "SUCCESS",
        metadata: { paymentIntentId: purchase.paymentIntentId, resultCode: input.resultCode, resultUrl: input.resultUrl ?? null, executorAttempt: purchase.executorAttempt },
      },
    });
    await tx.outboxEvent.create({
      data: { organizationId: purchase.organizationId, eventType: `CARD_PURCHASE_${input.status}`, aggregateType: "CARD_PURCHASE", aggregateId: purchase.id, payload: { paymentIntentId: purchase.paymentIntentId, agentId: purchase.agentId, merchantHost: purchase.merchantHost, amountMinor: purchase.amountMinor, currency: purchase.currency, resultCode: input.resultCode } },
    });
    return purchase;
  }, { isolationLevel: "Serializable" });
}
