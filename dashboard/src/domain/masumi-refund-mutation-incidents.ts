import { db } from "@/lib/db";

export async function openUnresolvedMasumiRefundMutationIncidents(limit = 100, now = new Date(), thresholdMs = 15 * 60_000) {
  const cutoff = new Date(now.getTime() - thresholdMs);
  const rows = await db.$queryRaw<Array<{ claimId: string; escrowPurchaseId: string; organizationId: string; operation: string; status: string }>>`
    SELECT c."id" AS "claimId",c."escrowPurchaseId",p."organizationId",c."operation",c."status"
    FROM "MasumiEscrowMutationClaim" c
    JOIN "MasumiEscrowPurchase" p ON p."id"=c."escrowPurchaseId"
    WHERE c."status" IN ('PREPARED','SUBMISSION_UNKNOWN') AND c."updatedAt" <= ${cutoff}
    ORDER BY c."updatedAt" ASC
    LIMIT ${Math.max(1, Math.min(limit, 500))}`;

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
  return { scanned: rows.length, opened };
}
