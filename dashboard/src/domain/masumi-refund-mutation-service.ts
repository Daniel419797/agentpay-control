import { createHash } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { isAmbiguousMasumiRefundError, masumiRefundTargetReached, masumiRefundTerminallyPrecluded, type MasumiRefundOperation } from "@/domain/masumi-refund-mutation";
import { db } from "@/lib/db";
import { authorizeMasumiRefund, findMasumiPurchase, requestMasumiRefund } from "@/lib/masumi-payment";
import type { MasumiNetwork } from "@/lib/masumi";

type MutationStatus = "PREPARED" | "SUBMISSION_UNKNOWN" | "CONFIRMED" | "FAILED";
type EscrowMutationRow = {
  id: string;
  organizationId: string;
  paymentIntentId: string | null;
  network: MasumiNetwork;
  blockchainIdentifier: string;
  state: string;
  refundRequestedAt: Date | null;
  refundAuthorizedAt: Date | null;
};
type ClaimRow = { id: string; status: MutationStatus; requestHash: string; failureCode: string | null };
type AccessMode = "BUYER" | "SELLER";

type AuditInput = {
  organizationId: string;
  actorType: "USER" | "SYSTEM";
  actorId?: string | null;
  action: string;
  claimId: string;
  escrowPurchaseId: string;
  operation: MasumiRefundOperation;
  result: "SUCCESS" | "FAILURE";
  metadata?: Record<string, unknown>;
};

function requestHash(operation: MasumiRefundOperation, escrow: EscrowMutationRow) {
  return createHash("sha256").update(JSON.stringify({ operation, escrowPurchaseId: escrow.id, network: escrow.network, blockchainIdentifier: escrow.blockchainIdentifier })).digest("hex");
}

function errorCode(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 160) : "MASUMI_REFUND_MUTATION_FAILED";
}

function initiationAction(operation: MasumiRefundOperation) {
  return operation === "REQUEST_REFUND" ? "MASUMI_REFUND_REQUEST_INITIATED" : "MASUMI_REFUND_AUTHORIZATION_INITIATED";
}

async function auditMutation(tx: Prisma.TransactionClient, input: AuditInput) {
  await tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: "MASUMI_ESCROW_MUTATION_CLAIM",
      targetId: input.claimId,
      result: input.result,
      metadata: {
        escrowPurchaseId: input.escrowPurchaseId,
        operation: input.operation,
        claimId: input.claimId,
        ...(input.metadata ?? {}),
      },
    },
  });
}

async function authorizedEscrow(tx: Prisma.TransactionClient, escrowPurchaseId: string, organizationId: string, access: AccessMode) {
  const rows = access === "BUYER"
    ? await tx.$queryRaw<EscrowMutationRow[]>`
        SELECT "id","organizationId","paymentIntentId","network","blockchainIdentifier","state","refundRequestedAt","refundAuthorizedAt"
        FROM "MasumiEscrowPurchase"
        WHERE "id"=${escrowPurchaseId}::uuid AND "organizationId"=${organizationId}::uuid
        LIMIT 1`
    : await tx.$queryRaw<EscrowMutationRow[]>`
        SELECT p."id",p."organizationId",p."paymentIntentId",p."network",p."blockchainIdentifier",p."state",p."refundRequestedAt",p."refundAuthorizedAt"
        FROM "MasumiEscrowPurchase" p
        JOIN "ResourceListing" r ON r."id"=p."resourceListingId"
        JOIN "ResourceProvider" rp ON rp."id"=r."providerId"
        WHERE p."id"=${escrowPurchaseId}::uuid AND rp."organizationId"=${organizationId}::uuid
        LIMIT 1`;
  return rows[0] ?? null;
}

async function claimFor(tx: Prisma.TransactionClient, escrowPurchaseId: string, operation: MasumiRefundOperation) {
  const rows = await tx.$queryRaw<ClaimRow[]>`
    SELECT "id","status","requestHash","failureCode"
    FROM "MasumiEscrowMutationClaim"
    WHERE "escrowPurchaseId"=${escrowPurchaseId}::uuid AND "operation"=${operation}
    LIMIT 1`;
  return rows[0] ?? null;
}

function locallyConfirmed(operation: MasumiRefundOperation, escrow: EscrowMutationRow) {
  if (operation === "REQUEST_REFUND") return Boolean(escrow.refundRequestedAt) || masumiRefundTargetReached(operation, escrow.state);
  return Boolean(escrow.refundAuthorizedAt) || masumiRefundTargetReached(operation, escrow.state);
}

function assertMutationAvailable(operation: MasumiRefundOperation, escrow: EscrowMutationRow) {
  if (operation === "REQUEST_REFUND") {
    if (!["ResultSubmitted", "FundsLocked"].includes(escrow.state)) throw new Error("MASUMI_REFUND_NOT_AVAILABLE");
    return;
  }
  if (escrow.state !== "RefundRequested") throw new Error("MASUMI_REFUND_NOT_REQUESTED");
}

async function reserveMutation(input: { escrowPurchaseId: string; organizationId: string; actorUserId?: string; operation: MasumiRefundOperation; access: AccessMode }) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`masumi-refund:${input.escrowPurchaseId}:${input.operation}`}, 0))`;
    const escrow = await authorizedEscrow(tx, input.escrowPurchaseId, input.organizationId, input.access);
    if (!escrow) throw new Error(input.access === "SELLER" ? "MASUMI_ESCROW_SELLER_NOT_AUTHORIZED" : "MASUMI_ESCROW_NOT_FOUND");
    const hash = requestHash(input.operation, escrow);
    const existing = await claimFor(tx, escrow.id, input.operation);
    if (existing && existing.requestHash !== hash) throw new Error("MASUMI_REFUND_MUTATION_BINDING_MISMATCH");

    if (locallyConfirmed(input.operation, escrow)) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "MasumiEscrowMutationClaim" ("id","escrowPurchaseId","operation","status","requestHash","failureCode","createdAt","updatedAt")
        VALUES (gen_random_uuid(),${escrow.id}::uuid,${input.operation},'CONFIRMED',${hash},NULL,now(),now())
        ON CONFLICT ("escrowPurchaseId","operation") DO UPDATE SET "status"='CONFIRMED',"failureCode"=NULL,"updatedAt"=now()
        RETURNING "id"`;
      const claimId = rows[0]?.id;
      if (!claimId) throw new Error("MASUMI_REFUND_MUTATION_CLAIM_WRITE_FAILED");
      if (!existing || existing.status !== "CONFIRMED") {
        await auditMutation(tx, {
          organizationId: escrow.organizationId,
          actorType: "SYSTEM",
          action: "MASUMI_REFUND_MUTATION_CONFIRMED",
          claimId,
          escrowPurchaseId: escrow.id,
          operation: input.operation,
          result: "SUCCESS",
          metadata: { providerState: escrow.state, source: "LOCAL_ESCROW_STATE" },
        });
      }
      return { mode: "CONFIRMED" as const, escrow, claimId };
    }

    if (existing?.status === "CONFIRMED") return { mode: "CONFIRMED" as const, escrow, claimId: existing.id };
    if (existing?.status === "PREPARED" || existing?.status === "SUBMISSION_UNKNOWN") {
      if (existing.status === "PREPARED") {
        await tx.$executeRaw`UPDATE "MasumiEscrowMutationClaim" SET "status"='SUBMISSION_UNKNOWN',"failureCode"='MASUMI_REFUND_PRIOR_ATTEMPT_OUTCOME_UNKNOWN',"updatedAt"=now() WHERE "id"=${existing.id}::uuid`;
        await auditMutation(tx, {
          organizationId: escrow.organizationId,
          actorType: "SYSTEM",
          action: "MASUMI_REFUND_MUTATION_OUTCOME_UNKNOWN",
          claimId: existing.id,
          escrowPurchaseId: escrow.id,
          operation: input.operation,
          result: "SUCCESS",
          metadata: { failureCode: "MASUMI_REFUND_PRIOR_ATTEMPT_OUTCOME_UNKNOWN" },
        });
      }
      return { mode: "RECONCILE" as const, escrow, claimId: existing.id };
    }

    assertMutationAvailable(input.operation, escrow);
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "MasumiEscrowMutationClaim" ("id","escrowPurchaseId","operation","status","requestHash","providerEvidence","failureCode","createdAt","updatedAt")
      VALUES (gen_random_uuid(),${escrow.id}::uuid,${input.operation},'PREPARED',${hash},NULL,NULL,now(),now())
      ON CONFLICT ("escrowPurchaseId","operation") DO UPDATE SET "status"='PREPARED',"providerEvidence"=NULL,"failureCode"=NULL,"updatedAt"=now()
      RETURNING "id"`;
    const claimId = rows[0]?.id;
    if (!claimId) throw new Error("MASUMI_REFUND_MUTATION_CLAIM_WRITE_FAILED");
    await auditMutation(tx, {
      organizationId: input.organizationId,
      actorType: input.actorUserId ? "USER" : "SYSTEM",
      actorId: input.actorUserId,
      action: initiationAction(input.operation),
      claimId,
      escrowPurchaseId: escrow.id,
      operation: input.operation,
      result: "SUCCESS",
      metadata: { access: input.access, buyerOrganizationId: escrow.organizationId, previousClaimStatus: existing?.status ?? null },
    });
    return { mode: "SEND" as const, escrow, claimId };
  }, { isolationLevel: "Serializable" });
}

async function markMutation(input: { escrowPurchaseId: string; organizationId: string; operation: MasumiRefundOperation; status: MutationStatus; failureCode?: string | null; providerEvidence?: unknown }) {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`masumi-refund:${input.escrowPurchaseId}:${input.operation}`}, 0))`;
    const existing = await claimFor(tx, input.escrowPurchaseId, input.operation);
    if (!existing) throw new Error("MASUMI_REFUND_MUTATION_CLAIM_NOT_FOUND");
    await tx.$executeRaw`
      UPDATE "MasumiEscrowMutationClaim"
      SET "status"=${input.status},"failureCode"=${input.failureCode ?? null},
          "providerEvidence"=COALESCE(${input.providerEvidence === undefined ? null : JSON.stringify(input.providerEvidence)}::jsonb,"providerEvidence"),"updatedAt"=now()
      WHERE "id"=${existing.id}::uuid`;
    if (existing.status !== input.status) {
      await auditMutation(tx, {
        organizationId: input.organizationId,
        actorType: "SYSTEM",
        action: input.status === "FAILED" ? "MASUMI_REFUND_MUTATION_FAILED" : input.status === "SUBMISSION_UNKNOWN" ? "MASUMI_REFUND_MUTATION_OUTCOME_UNKNOWN" : "MASUMI_REFUND_MUTATION_STATUS_CHANGED",
        claimId: existing.id,
        escrowPurchaseId: input.escrowPurchaseId,
        operation: input.operation,
        result: input.status === "FAILED" ? "FAILURE" : "SUCCESS",
        metadata: { previousStatus: existing.status, mutationStatus: input.status, failureCode: input.failureCode ?? null },
      });
    }
  });
}

async function recordConfirmed(input: { escrow: EscrowMutationRow; operation: MasumiRefundOperation; providerState: string; providerEvidence: unknown }) {
  if (!masumiRefundTargetReached(input.operation, input.providerState)) throw new Error("MASUMI_REFUND_PROVIDER_TARGET_NOT_REACHED");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`masumi-refund:${input.escrow.id}:${input.operation}`}, 0))`;
    const hash = requestHash(input.operation, input.escrow);
    const existing = await claimFor(tx, input.escrow.id, input.operation);
    if (existing && existing.requestHash !== hash) throw new Error("MASUMI_REFUND_MUTATION_BINDING_MISMATCH");
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "MasumiEscrowMutationClaim" ("id","escrowPurchaseId","operation","status","requestHash","providerEvidence","failureCode","createdAt","updatedAt")
      VALUES (gen_random_uuid(),${input.escrow.id}::uuid,${input.operation},'CONFIRMED',${hash},${JSON.stringify(input.providerEvidence)}::jsonb,NULL,now(),now())
      ON CONFLICT ("escrowPurchaseId","operation") DO UPDATE SET "status"='CONFIRMED',"providerEvidence"=EXCLUDED."providerEvidence","failureCode"=NULL,"updatedAt"=now()
      RETURNING "id"`;
    const claimId = rows[0]?.id;
    if (!claimId) throw new Error("MASUMI_REFUND_MUTATION_CLAIM_WRITE_FAILED");
    await tx.$executeRaw`
      UPDATE "MasumiEscrowPurchase"
      SET "state"=${input.providerState},"providerState"=${input.providerState},
          "refundRequestedAt"=CASE WHEN ${input.providerState} IN ('RefundRequested','RefundAuthorized') AND "refundRequestedAt" IS NULL THEN now() ELSE "refundRequestedAt" END,
          "refundAuthorizedAt"=CASE WHEN ${input.providerState}='RefundAuthorized' AND "refundAuthorizedAt" IS NULL THEN now() ELSE "refundAuthorizedAt" END,
          "providerEvidence"=${JSON.stringify(input.providerEvidence)}::jsonb,"failureCode"=NULL,"lastReconciledAt"=now(),"updatedAt"=now()
      WHERE "id"=${input.escrow.id}::uuid`;
    if (input.providerState === "RefundAuthorized") {
      if (input.escrow.paymentIntentId) {
        await tx.paymentIntent.updateMany({
          where: { id: input.escrow.paymentIntentId, status: { notIn: ["SETTLED", "CANCELED"] } },
          data: { status: "SETTLEMENT_FAILED" },
        });
      }
      await tx.$executeRaw`
        UPDATE "MasumiEscrowPurchase"
        SET "inputEncrypted"='',"inputPurgedAt"=COALESCE("inputPurgedAt",now()),"updatedAt"=now()
        WHERE "id"=${input.escrow.id}::uuid AND "inputPurgedAt" IS NULL`;
    }
    if (!existing || existing.status !== "CONFIRMED") {
      await auditMutation(tx, {
        organizationId: input.escrow.organizationId,
        actorType: "SYSTEM",
        action: "MASUMI_REFUND_MUTATION_CONFIRMED",
        claimId,
        escrowPurchaseId: input.escrow.id,
        operation: input.operation,
        result: "SUCCESS",
        metadata: { previousStatus: existing?.status ?? null, providerState: input.providerState, paymentIntentId: input.escrow.paymentIntentId },
      });
    }
    return { escrowPurchaseId: input.escrow.id, state: input.providerState, mutation: input.operation, mutationStatus: "CONFIRMED" as const };
  }, { isolationLevel: "Serializable" });
}

async function claimAndEscrow(escrowPurchaseId: string, operation: MasumiRefundOperation) {
  const rows = await db.$queryRaw<Array<EscrowMutationRow & { claimId: string; claimStatus: MutationStatus; requestHash: string }>>`
    SELECT p."id",p."organizationId",p."paymentIntentId",p."network",p."blockchainIdentifier",p."state",p."refundRequestedAt",p."refundAuthorizedAt",
           c."id" AS "claimId",c."status" AS "claimStatus",c."requestHash"
    FROM "MasumiEscrowMutationClaim" c
    JOIN "MasumiEscrowPurchase" p ON p."id"=c."escrowPurchaseId"
    WHERE c."escrowPurchaseId"=${escrowPurchaseId}::uuid AND c."operation"=${operation}
    LIMIT 1`;
  return rows[0] ?? null;
}

export async function reconcileMasumiRefundMutation(escrowPurchaseId: string, operation: MasumiRefundOperation) {
  const row = await claimAndEscrow(escrowPurchaseId, operation);
  if (!row) throw new Error("MASUMI_REFUND_MUTATION_CLAIM_NOT_FOUND");
  if (row.requestHash !== requestHash(operation, row)) throw new Error("MASUMI_REFUND_MUTATION_BINDING_MISMATCH");
  if (row.claimStatus === "CONFIRMED") return { escrowPurchaseId, state: row.state, mutation: operation, mutationStatus: "CONFIRMED" as const };

  const purchase = await findMasumiPurchase(row.network, row.blockchainIdentifier);
  if (!purchase) {
    await markMutation({ escrowPurchaseId, organizationId: row.organizationId, operation, status: "SUBMISSION_UNKNOWN", failureCode: "MASUMI_REFUND_PROVIDER_EVIDENCE_PENDING" });
    return { escrowPurchaseId, state: row.state, mutation: operation, mutationStatus: "SUBMISSION_UNKNOWN" as const };
  }

  const providerState = purchase.NextAction.requestedAction;
  if (masumiRefundTargetReached(operation, providerState)) return recordConfirmed({ escrow: row, operation, providerState, providerEvidence: purchase });
  if (masumiRefundTerminallyPrecluded(operation, providerState)) {
    await markMutation({ escrowPurchaseId, organizationId: row.organizationId, operation, status: "FAILED", failureCode: `MASUMI_REFUND_MUTATION_PRECLUDED_${providerState}`, providerEvidence: purchase });
    return { escrowPurchaseId, state: providerState, mutation: operation, mutationStatus: "FAILED" as const };
  }

  await markMutation({ escrowPurchaseId, organizationId: row.organizationId, operation, status: "SUBMISSION_UNKNOWN", failureCode: "MASUMI_REFUND_PROVIDER_TRANSITION_PENDING", providerEvidence: purchase });
  return { escrowPurchaseId, state: row.state, providerState, mutation: operation, mutationStatus: "SUBMISSION_UNKNOWN" as const };
}

async function executeMutation(input: { escrowPurchaseId: string; organizationId: string; actorUserId?: string; operation: MasumiRefundOperation; access: AccessMode }) {
  const reserved = await reserveMutation(input);
  if (reserved.mode === "CONFIRMED") return { escrowPurchaseId: reserved.escrow.id, state: reserved.escrow.state, mutation: input.operation, mutationStatus: "CONFIRMED" as const };
  if (reserved.mode === "RECONCILE") return reconcileMasumiRefundMutation(reserved.escrow.id, input.operation);

  try {
    const purchase = input.operation === "REQUEST_REFUND"
      ? await requestMasumiRefund(reserved.escrow.network, reserved.escrow.blockchainIdentifier)
      : await authorizeMasumiRefund(reserved.escrow.network, reserved.escrow.blockchainIdentifier);
    const providerState = purchase.NextAction.requestedAction;
    if (masumiRefundTargetReached(input.operation, providerState)) return recordConfirmed({ escrow: reserved.escrow, operation: input.operation, providerState, providerEvidence: purchase });
    if (masumiRefundTerminallyPrecluded(input.operation, providerState)) {
      await markMutation({ escrowPurchaseId: reserved.escrow.id, organizationId: reserved.escrow.organizationId, operation: input.operation, status: "FAILED", failureCode: `MASUMI_REFUND_MUTATION_PRECLUDED_${providerState}`, providerEvidence: purchase });
      return { escrowPurchaseId: reserved.escrow.id, state: reserved.escrow.state, providerState, mutation: input.operation, mutationStatus: "FAILED" as const };
    }
    await markMutation({ escrowPurchaseId: reserved.escrow.id, organizationId: reserved.escrow.organizationId, operation: input.operation, status: "SUBMISSION_UNKNOWN", failureCode: "MASUMI_REFUND_PROVIDER_TRANSITION_PENDING", providerEvidence: purchase });
    return { escrowPurchaseId: reserved.escrow.id, state: reserved.escrow.state, providerState, mutation: input.operation, mutationStatus: "SUBMISSION_UNKNOWN" as const };
  } catch (error) {
    if (isAmbiguousMasumiRefundError(error)) {
      await markMutation({ escrowPurchaseId: reserved.escrow.id, organizationId: reserved.escrow.organizationId, operation: input.operation, status: "SUBMISSION_UNKNOWN", failureCode: errorCode(error) });
      return { escrowPurchaseId: reserved.escrow.id, state: reserved.escrow.state, mutation: input.operation, mutationStatus: "SUBMISSION_UNKNOWN" as const };
    }
    await markMutation({ escrowPurchaseId: reserved.escrow.id, organizationId: reserved.escrow.organizationId, operation: input.operation, status: "FAILED", failureCode: errorCode(error) });
    throw error;
  }
}

export async function requestEscrowRefundDurably(escrowPurchaseId: string, organizationId: string, actorUserId?: string) {
  return executeMutation({ escrowPurchaseId, organizationId, actorUserId, operation: "REQUEST_REFUND", access: "BUYER" });
}

export async function authorizeEscrowRefundDurably(escrowPurchaseId: string, organizationId: string, actorUserId?: string) {
  return executeMutation({ escrowPurchaseId, organizationId, actorUserId, operation: "AUTHORIZE_REFUND", access: "SELLER" });
}

export async function reconcilePendingMasumiRefundMutations(limit = 25) {
  const rows = await db.$queryRaw<Array<{ escrowPurchaseId: string; operation: MasumiRefundOperation }>>`
    SELECT "escrowPurchaseId","operation"
    FROM "MasumiEscrowMutationClaim"
    WHERE "status" IN ('PREPARED','SUBMISSION_UNKNOWN')
    ORDER BY "updatedAt" ASC
    LIMIT ${Math.max(1, Math.min(limit, 100))}`;
  const results = [];
  for (const row of rows) {
    try { results.push(await reconcileMasumiRefundMutation(row.escrowPurchaseId, row.operation)); }
    catch (error) { results.push({ escrowPurchaseId: row.escrowPurchaseId, mutation: row.operation, mutationStatus: "ERROR", error: errorCode(error) }); }
  }
  return results;
}
