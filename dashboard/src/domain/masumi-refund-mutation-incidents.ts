import { db } from "@/lib/db";

export async function openUnresolvedMasumiRefundMutationIncidents(limit = 100, now = new Date(), thresholdMs = 15 * 60_000) {
  const boundedLimit = Math.max(1, Math.min(limit, 500));
  const cutoff = new Date(now.getTime() - thresholdMs);
  const [rows, resolvedRows] = await Promise.all([
    db.$queryRaw<Array<{ claimId: string; escrowPurchaseId: string; organizationId: string; operation: string; status: string }>>`
      SELECT c."id" AS "claimId",c."escrowPurchaseId",p."organizationId",c."operation",c."status"
      FROM "MasumiEscrowMutationClaim" c
      JOIN "MasumiEscrowPurchase" p ON p."id"=c."escrowPurchaseId"
      WHERE c."status" IN ('PREPARED','SUBMISSION_UNKNOWN') AND c."updatedAt" <= ${cutoff}
      ORDER BY c."updatedAt" ASC
      LIMIT ${boundedLimit}`,
    db.$queryRaw<Array<{ claimId: string; escrowPurchaseId: string; organizationId: string; operation: string; supportCaseId: string }>>`
      SELECT c."id" AS "claimId",c."escrowPurchaseId",p."organizationId",c."operation",s."id" AS "supportCaseId"
      FROM "MasumiEscrowMutationClaim" c
      JOIN "MasumiEscrowPurchase" p ON p."id"=c."escrowPurchaseId"
      JOIN "SupportCase" s ON s."organizationId"=p."organizationId" AND s."sourceType"='MASUMI_REFUND_MUTATION' AND s."sourceId"=c."id"::text
      WHERE c."status"='CONFIRMED' AND s."status" IN ('OPEN','IN_PROGRESS','WAITING_ON_CUSTOMER')
      ORDER BY c."updatedAt" ASC
      LIMIT ${boundedLimit}`,
  ]);

  let resolved = 0;
  for (const row of resolvedRows) {
    const didResolve = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incident:MASUMI_REFUND_MUTATION:${row.claimId}`}, 0))`;
      const changed = await tx.supportCase.updateMany({
        where: { id: row.supportCaseId, organizationId: row.organizationId, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER"] } },
        data: { status: "RESOLVED" },
      });
      if (changed.count !== 1) return false;
      await tx.auditEvent.create({
        data: {
          organizationId: row.organizationId,
          actorType: "SYSTEM",
          action: "RECONCILIATION_INCIDENT_RESOLVED",
          targetType: "SUPPORT_CASE",
          targetId: row.supportCaseId,
          result: "SUCCESS",
          metadata: { sourceType: "MASUMI_REFUND_MUTATION", sourceId: row.claimId, escrowPurchaseId: row.escrowPurchaseId, operation: row.operation, mutationStatus: "CONFIRMED" },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: row.organizationId,
          eventType: "RECONCILIATION_INCIDENT_RESOLVED",
          aggregateType: "MASUMI_REFUND_MUTATION",
          aggregateId: row.claimId,
          payload: { supportCaseId: row.supportCaseId, escrowPurchaseId: row.escrowPurchaseId, operation: row.operation, mutationStatus: "CONFIRMED" },
        },
      });
      return true;
    });
    if (didResolve) resolved += 1;
  }

  let opened = 0;
  for (const row of rows) {
    const didOpen = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incident:MASUMI_REFUND_MUTATION:${row.claimId}`}, 0))`;
      const existing = await tx.supportCase.findUnique({
        where: { organizationId_sourceType_sourceId: { organizationId: row.organizationId, sourceType: "MASUMI_REFUND_MUTATION", sourceId: row.claimId } },
        select: { id: true },
      });
      if (existing) return false;
      const supportCase = await tx.supportCase.create({
        data: {
          organizationId: row.organizationId,
          createdBy: null,
          sourceType: "MASUMI_REFUND_MUTATION",
          sourceId: row.claimId,
          title: "Masumi refund mutation remains unresolved",
          description: `${row.operation} for escrow ${row.escrowPurchaseId} remains ${row.status}. AgentPay will reconcile provider state and will not blindly resend the mutation.`,
          category: "RECONCILIATION_INCIDENT",
          severity: "URGENT",
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: row.organizationId,
          actorType: "SYSTEM",
          action: "RECONCILIATION_INCIDENT_OPENED",
          targetType: "SUPPORT_CASE",
          targetId: supportCase.id,
          result: "SUCCESS",
          metadata: { sourceType: "MASUMI_REFUND_MUTATION", sourceId: row.claimId, escrowPurchaseId: row.escrowPurchaseId, operation: row.operation, mutationStatus: row.status },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: row.organizationId,
          eventType: "RECONCILIATION_INCIDENT_OPENED",
          aggregateType: "MASUMI_REFUND_MUTATION",
          aggregateId: row.claimId,
          payload: { supportCaseId: supportCase.id, escrowPurchaseId: row.escrowPurchaseId, operation: row.operation, mutationStatus: row.status, severity: "URGENT" },
        },
      });
      return true;
    });
    if (didOpen) opened += 1;
  }
  return { scanned: rows.length, opened, resolved };
}
