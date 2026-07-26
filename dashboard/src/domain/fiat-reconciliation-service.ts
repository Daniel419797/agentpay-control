import { getCardProvider } from "@/domain/card-provider";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secret-box";

export function isRetryableFiatSubmission(status: string, externalTransferId: string) {
  return ["PENDING", "SUBMISSION_UNKNOWN"].includes(status) && externalTransferId.startsWith("pending_");
}

export async function reconcileUnknownFiatTransfers(limit = 25, now = new Date()) {
  const provider = getCardProvider();
  const transfers = await db.fiatTransfer.findMany({
    where: {
      provider: provider.name,
      status: { in: ["PENDING", "SUBMISSION_UNKNOWN"] },
      externalTransferId: { startsWith: "pending_" },
      instrumentIdEncrypted: { not: null },
      updatedAt: { lte: new Date(now.getTime() - 2 * 60_000) },
    },
    include: { fiatAccount: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  let reconciled = 0;
  for (const transfer of transfers) {
    try {
      const external = await provider.createFiatTransfer({
        direction: transfer.direction,
        financialAccountId: transfer.fiatAccount.externalAccountId,
        instrumentId: decryptSecret(transfer.instrumentIdEncrypted!),
        amountMinor: transfer.amountMinor.toString(),
        currency: transfer.currency,
        description: transfer.description ?? undefined,
      }, `fiat-transfer:${transfer.organizationId}:${transfer.idempotencyKey}`);
      const changed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${transfer.fiatAccountId}, 0))`;
        const current = await tx.fiatTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
        if (!current.externalTransferId.startsWith("pending_")) return false;
        await tx.fiatTransfer.update({ where: { id: current.id }, data: { externalTransferId: external.id, status: external.status, failureCode: null } });
        if (provider.name === "SANDBOX" && external.status === "SUCCEEDED") {
          await tx.fiatAccount.update({ where: { id: current.fiatAccountId }, data: { availableMinor: current.direction === "DEPOSIT" ? { increment: current.amountMinor } : { decrement: current.amountMinor } } });
        } else if (external.status === "PROCESSING") {
          await tx.fiatAccount.update({ where: { id: current.fiatAccountId }, data: { pendingMinor: { increment: current.amountMinor } } });
        }
        await tx.outboxEvent.create({ data: { organizationId: current.organizationId, eventType: `FIAT_${current.direction}_${external.status}`, aggregateType: "FIAT_TRANSFER", aggregateId: current.id, payload: { amountMinor: current.amountMinor.toString(), currency: current.currency, status: external.status, reconciled: true } } });
        return true;
      });
      if (changed) reconciled += 1;
    } catch (error) {
      await db.fiatTransfer.update({ where: { id: transfer.id }, data: { status: "SUBMISSION_UNKNOWN", failureCode: error instanceof Error ? error.message.slice(0, 120) : "RECONCILIATION_FAILED" } });
    }
  }
  return { scanned: transfers.length, reconciled };
}
