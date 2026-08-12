import { Prisma } from "@/generated/prisma/client";
import { paymentAccountForNetwork, x402AssetIdentifier } from "@/domain/payment-routing";
import { cardanoExactPaymentMatches, cardanoTransactionEvidence, type CardanoNetwork } from "@/lib/cardano";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

const CARDANO_NETWORKS = ["cardano:preprod", "cardano:mainnet"] as const;
// Blockfrost depth counts the inclusion block as 1. Requiring depth 2 means the
// payment block plus at least one newer canonical block, matching an x402 L1
// confirmation policy of one newer block.
const REQUIRED_BLOCK_DEPTH = 2;

type ReconciliationResult = "CONFIRMED" | "MISMATCH" | "REPLAY" | "ALREADY_RECONCILED";

async function ensureIncident(tx: Prisma.TransactionClient, organizationId: string, paymentIntentId: string, title: string, description: string) {
  await tx.supportCase.upsert({
    where: { organizationId_sourceType_sourceId: { organizationId, sourceType: "PAYMENT_INTENT", sourceId: paymentIntentId } },
    create: { organizationId, createdBy: null, sourceType: "PAYMENT_INTENT", sourceId: paymentIntentId, title, description, category: "RECONCILIATION_INCIDENT", severity: "URGENT" },
    update: { title, description, severity: "URGENT", status: "OPEN" },
  });
}

export async function reconcileUnknownCardanoPayments(limit = 25, now = new Date()) {
  const candidates = await db.paymentIntent.findMany({
    where: {
      status: "SUBMISSION_UNKNOWN",
      quote: { network: { in: [...CARDANO_NETWORKS] } },
      attempts: { some: { status: "UNKNOWN", candidateTransactionId: { not: null } } },
    },
    include: {
      quote: { include: { asset: true } },
      agent: { include: { accounts: { where: { status: "ACTIVE" } } } },
      attempts: { where: { status: "UNKNOWN", candidateTransactionId: { not: null } }, orderBy: { attemptNumber: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });

  const results: Array<{ paymentIntentId: string; outcome: string; transactionId?: string; error?: string }> = [];
  for (const intent of candidates) {
    const quote = intent.quote;
    const attempt = intent.attempts[0];
    if (!quote || !CARDANO_NETWORKS.includes(quote.network as CardanoNetwork) || !attempt?.candidateTransactionId) continue;
    const network = quote.network as CardanoNetwork;
    const transactionHash = attempt.candidateTransactionId.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(transactionHash)) {
      results.push({ paymentIntentId: intent.id, outcome: "TRANSACTION_HASH_UNAVAILABLE" });
      continue;
    }

    try {
      const payer = paymentAccountForNetwork(intent.agent.accounts, network);
      const evidence = await cardanoTransactionEvidence(network, transactionHash);
      if (!evidence) {
        results.push({ paymentIntentId: intent.id, outcome: "PENDING", transactionId: transactionHash });
        continue;
      }
      if (evidence.confirmations < REQUIRED_BLOCK_DEPTH) {
        results.push({ paymentIntentId: intent.id, outcome: "PENDING_CONFIRMATIONS", transactionId: transactionHash });
        continue;
      }

      const asset = x402AssetIdentifier(quote.asset, network, getConfig());
      const outcome = cardanoExactPaymentMatches(evidence, payer.accountId, quote.payToAccountId, asset, quote.amountAtomic.toString()) ? "CONFIRMED" : "MISMATCH";
      const reconciled: ReconciliationResult = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-reconcile:${intent.id}`}, 0))`;
        const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id }, select: { status: true } });
        if (current.status !== "SUBMISSION_UNKNOWN") return "ALREADY_RECONCILED" as const;

        const duplicate = await tx.settlement.findFirst({ where: { network, transactionId: transactionHash } });
        if (duplicate && duplicate.paymentAttemptId !== attempt.id) {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: "SETTLEMENT_TRANSACTION_REPLAY" } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
          await ensureIncident(tx, intent.organizationId, intent.id, "Duplicate Cardano settlement transaction detected", `Transaction ${transactionHash} is already associated with another payment attempt. The spend reservation remains consumed pending investigation.`);
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_REPLAY_DETECTED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: transactionHash, network } } });
          return "REPLAY" as const;
        }

        await tx.settlement.upsert({
          where: { paymentAttemptId: attempt.id },
          create: {
            paymentAttemptId: attempt.id,
            assetId: quote.assetId,
            status: outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED",
            network,
            transactionId: transactionHash,
            payerAccountId: payer.accountId,
            payeeAccountId: quote.payToAccountId,
            amountAtomic: quote.amountAtomic,
            resultCode: outcome === "CONFIRMED" ? "SUCCESS" : "CARDANO_TRANSFER_MISMATCH",
            submittedAt: attempt.createdAt,
            confirmedAt: now,
          },
          update: {
            status: outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED",
            transactionId: transactionHash,
            resultCode: outcome === "CONFIRMED" ? "SUCCESS" : "CARDANO_TRANSFER_MISMATCH",
            confirmedAt: now,
          },
        });

        if (outcome === "CONFIRMED") {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", errorCode: null } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id }, data: { status: "SETTLED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "SETTLED_FULFILLMENT_UNAVAILABLE" }, update: { status: "FAILED", errorCode: "SETTLED_FULFILLMENT_UNAVAILABLE" } });
          await ensureIncident(tx, intent.organizationId, intent.id, "Payment settled but fulfillment evidence is unavailable", `Cardano transaction ${transactionHash} confirms settlement after an ambiguous resource response. The original paid resource response could not be recovered automatically.`);
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLED_RECONCILED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: transactionHash, network, fulfillmentRecovered: false } } });
        } else {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" }, update: { status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" } });
          await ensureIncident(tx, intent.organizationId, intent.id, "Cardano settlement does not match payment quote", `Transaction ${transactionHash} is confirmed but does not match the configured payer, exact payee, asset, and amount. The reservation remains consumed pending investigation.`);
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_MISMATCH", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: transactionHash, network } } });
        }
        return outcome;
      });

      results.push({ paymentIntentId: intent.id, outcome: reconciled, transactionId: transactionHash });
    } catch (error) {
      results.push({ paymentIntentId: intent.id, outcome: "ERROR", transactionId: transactionHash, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }

  return { scanned: results.length, results };
}
