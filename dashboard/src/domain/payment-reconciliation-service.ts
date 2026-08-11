import { Prisma } from "@/generated/prisma/client";
import { paymentAccountForNetwork } from "@/domain/payment-routing";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { normalizeTransactionId, parseMirrorNodeJson, verifyHederaAssetPayment, type MirrorAtomicAmount, type MirrorTransaction } from "@/lib/hedera-payment";

export type HederaPaymentReconciliationOutcome = "CONFIRMED" | "FAILED" | "MISMATCH";
type HederaReconciliationResult = HederaPaymentReconciliationOutcome | "REPLAY" | "ALREADY_RECONCILED";

export function hederaPaymentReconciliationOutcome(
  transaction: MirrorTransaction,
  asset: { type: "NATIVE" | "TOKEN"; hederaTokenId?: string | null },
  payerAccountId: string,
  payeeAccountId: string,
  amountAtomic: string,
): HederaPaymentReconciliationOutcome {
  if (transaction.result !== "SUCCESS") return "FAILED";
  return verifyHederaAssetPayment(transaction, asset, payerAccountId, payeeAccountId, amountAtomic) ? "CONFIRMED" : "MISMATCH";
}

function mirrorUrlForNetwork(network: string) {
  const config = getConfig();
  if (network === "hedera:testnet") return config.HEDERA_MIRROR_NODE_URL;
  if (network === "hedera:mainnet") return config.HEDERA_MAINNET_MIRROR_NODE_URL;
  throw new Error("PAYMENT_RECONCILIATION_NETWORK_UNSUPPORTED");
}

function isAtomicAmount(value: unknown): value is MirrorAtomicAmount {
  return (typeof value === "string" && /^-?\d+$/.test(value)) || (typeof value === "number" && Number.isSafeInteger(value));
}

function isMirrorTransaction(value: unknown): value is MirrorTransaction {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.transaction_id === "string"
    && typeof row.result === "string"
    && typeof row.consensus_timestamp === "string"
    && Array.isArray(row.transfers)
    && row.transfers.every((item) => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).account === "string" && isAtomicAmount((item as Record<string, unknown>).amount))
    && (row.token_transfers === undefined || (Array.isArray(row.token_transfers) && row.token_transfers.every((item) => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).token_id === "string" && typeof (item as Record<string, unknown>).account === "string" && isAtomicAmount((item as Record<string, unknown>).amount))));
}

async function recordReconciliationIncident(
  tx: Prisma.TransactionClient,
  organizationId: string,
  paymentIntentId: string,
  title: string,
  description: string,
) {
  await tx.supportCase.upsert({
    where: { organizationId_sourceType_sourceId: { organizationId, sourceType: "PAYMENT_INTENT", sourceId: paymentIntentId } },
    create: { organizationId, createdBy: null, sourceType: "PAYMENT_INTENT", sourceId: paymentIntentId, title, description, category: "RECONCILIATION_INCIDENT", severity: "URGENT" },
    update: { title, description, severity: "URGENT", status: "OPEN" },
  });
}

export async function reconcileUnknownHederaPayments(limit = 25, now = new Date()) {
  const candidates = await db.paymentIntent.findMany({
    where: {
      status: "SUBMISSION_UNKNOWN",
      quote: { network: { in: ["hedera:testnet", "hedera:mainnet"] } },
      attempts: { some: { status: "UNKNOWN", candidateTransactionId: { not: null } } },
    },
    include: {
      quote: { include: { asset: true } },
      reservation: true,
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
    if (!quote || !attempt?.candidateTransactionId || !["hedera:testnet", "hedera:mainnet"].includes(quote.network)) continue;

    const candidateTransactionId = attempt.candidateTransactionId;
    try {
      const payer = paymentAccountForNetwork(intent.agent.accounts, quote.network);
      const normalized = normalizeTransactionId(candidateTransactionId);
      const mirrorResponse = await fetch(`${mirrorUrlForNetwork(quote.network).replace(/\/$/, "")}/api/v1/transactions/${encodeURIComponent(normalized)}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (mirrorResponse.status === 404) {
        results.push({ paymentIntentId: intent.id, outcome: "PENDING", transactionId: candidateTransactionId });
        continue;
      }
      if (!mirrorResponse.ok) throw new Error(`MIRROR_NODE_${mirrorResponse.status}`);
      const parsed = parseMirrorNodeJson(await mirrorResponse.text()) as { transactions?: unknown[] };
      const transaction = parsed.transactions?.find((row) => isMirrorTransaction(row) && normalizeTransactionId(row.transaction_id) === normalized);
      if (!transaction || !isMirrorTransaction(transaction)) {
        results.push({ paymentIntentId: intent.id, outcome: "PENDING", transactionId: candidateTransactionId });
        continue;
      }

      const outcome = hederaPaymentReconciliationOutcome(transaction, { type: quote.asset.type, hederaTokenId: quote.asset.hederaTokenId }, payer.accountId, quote.payToAccountId, quote.amountAtomic.toString());
      const reconciled: HederaReconciliationResult = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-reconcile:${intent.id}`}, 0))`;
        const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id }, select: { status: true } });
        if (current.status !== "SUBMISSION_UNKNOWN") return "ALREADY_RECONCILED" as const;

        const transactionId = transaction.transaction_id;
        const duplicate = await tx.settlement.findFirst({ where: { network: quote.network, transactionId } });
        if (duplicate && duplicate.paymentAttemptId !== attempt.id) {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: "SETTLEMENT_TRANSACTION_REPLAY" } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
          await recordReconciliationIncident(tx, intent.organizationId, intent.id, "Duplicate settlement transaction detected", `Transaction ${transactionId} is already associated with another payment attempt. The spend reservation remains consumed pending investigation.`);
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_REPLAY_DETECTED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId, network: quote.network } } });
          return "REPLAY" as const;
        }

        await tx.settlement.upsert({
          where: { paymentAttemptId: attempt.id },
          create: { paymentAttemptId: attempt.id, assetId: quote.assetId, status: outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED", network: quote.network, transactionId, consensusTimestamp: transaction.consensus_timestamp, payerAccountId: payer.accountId, payeeAccountId: quote.payToAccountId, amountAtomic: quote.amountAtomic, resultCode: outcome === "MISMATCH" ? "TRANSFER_MISMATCH" : transaction.result, submittedAt: attempt.createdAt, confirmedAt: now },
          update: { status: outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED", transactionId, consensusTimestamp: transaction.consensus_timestamp, resultCode: outcome === "MISMATCH" ? "TRANSFER_MISMATCH" : transaction.result, confirmedAt: now },
        });

        if (outcome === "CONFIRMED") {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", errorCode: null } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id }, data: { status: "SETTLED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "SETTLED_FULFILLMENT_UNAVAILABLE" }, update: { status: "FAILED", errorCode: "SETTLED_FULFILLMENT_UNAVAILABLE" } });
          await recordReconciliationIncident(tx, intent.organizationId, intent.id, "Payment settled but fulfillment evidence is unavailable", `Hedera transaction ${transactionId} confirms settlement after an ambiguous resource response. The payment is settled, but the original paid resource response could not be recovered automatically.`);
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLED_RECONCILED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId, network: quote.network, fulfillmentRecovered: false } } });
        } else if (outcome === "FAILED") {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: transaction.result.slice(0, 120) } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "RELEASED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: `SETTLEMENT_${transaction.result}` }, update: { status: "FAILED", errorCode: `SETTLEMENT_${transaction.result}` } });
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_FAILED_RECONCILED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId, network: quote.network, result: transaction.result } } });
        } else {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" }, update: { status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" } });
          await recordReconciliationIncident(tx, intent.organizationId, intent.id, "Settled Hedera transaction does not match payment quote", `Transaction ${transactionId} succeeded but its transfer evidence does not match the quoted payer, payee, asset, and amount. The reservation remains consumed pending investigation.`);
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_MISMATCH", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId, network: quote.network } } });
        }
        return outcome;
      });
      results.push({ paymentIntentId: intent.id, outcome: reconciled, transactionId: transaction.transaction_id });
    } catch (error) {
      results.push({ paymentIntentId: intent.id, outcome: "ERROR", transactionId: candidateTransactionId, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }
  return { scanned: results.length, results };
}
