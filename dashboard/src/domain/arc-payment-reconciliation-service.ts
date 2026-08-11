import { z } from "zod";

import { paymentAccountForNetwork } from "@/domain/payment-routing";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

const ARC_NETWORK = "eip155:5042002";
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const receiptSchema = z.object({
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  status: hex,
  blockNumber: hex,
  logs: z.array(z.object({
    address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    topics: z.array(z.string().regex(/^0x[0-9a-fA-F]{64}$/)),
    data: hex,
  })),
});

export type ArcReceipt = z.infer<typeof receiptSchema>;
export type ArcPaymentReconciliationOutcome = "CONFIRMED" | "FAILED" | "MISMATCH";

function addressTopic(address: string) {
  return `0x${address.replace(/^0x/i, "").toLowerCase().padStart(64, "0")}`;
}

export function arcPaymentReconciliationOutcome(
  receipt: ArcReceipt,
  tokenAddress: string,
  payerAddress: string,
  payeeAddress: string,
  amountAtomic: string,
): ArcPaymentReconciliationOutcome {
  if (BigInt(receipt.status) !== 1n) return "FAILED";
  const payerTopic = addressTopic(payerAddress);
  const payeeTopic = addressTopic(payeeAddress);
  const token = tokenAddress.toLowerCase();
  const amount = BigInt(amountAtomic);
  const matched = receipt.logs.some((log) =>
    log.address.toLowerCase() === token
      && log.topics[0]?.toLowerCase() === ERC20_TRANSFER_TOPIC
      && log.topics[1]?.toLowerCase() === payerTopic
      && log.topics[2]?.toLowerCase() === payeeTopic
      && BigInt(log.data) === amount
  );
  return matched ? "CONFIRMED" : "MISMATCH";
}

async function rpc(method: string, params: unknown[]) {
  const url = getConfig().ARC_RPC_URL;
  if (!url) throw new Error("ARC_RPC_UNAVAILABLE");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`ARC_RPC_${response.status}`);
  const envelope = z.object({ result: z.unknown().nullable(), error: z.unknown().optional() }).parse(await response.json());
  if (envelope.error) throw new Error("ARC_RPC_ERROR");
  return envelope.result;
}

async function ensureIncident(organizationId: string, paymentIntentId: string, title: string, description: string) {
  await db.supportCase.upsert({
    where: { organizationId_sourceType_sourceId: { organizationId, sourceType: "PAYMENT_INTENT", sourceId: paymentIntentId } },
    create: { organizationId, createdBy: null, sourceType: "PAYMENT_INTENT", sourceId: paymentIntentId, title, description, category: "RECONCILIATION_INCIDENT", severity: "URGENT" },
    update: { title, description, severity: "URGENT", status: "OPEN" },
  });
}

export async function reconcileUnknownArcPayments(limit = 25, now = new Date()) {
  const config = getConfig();
  const candidates = await db.paymentIntent.findMany({
    where: { status: "SUBMISSION_UNKNOWN", attempts: { some: { status: "UNKNOWN", candidateTransactionId: { not: null } } } },
    include: {
      quote: { include: { asset: true } },
      agent: { include: { accounts: { where: { status: "ACTIVE" } } } },
      attempts: { where: { status: "UNKNOWN", candidateTransactionId: { not: null } }, orderBy: { attemptNumber: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "asc" },
    take: Math.max(limit * 3, limit),
  });

  const results: Array<{ paymentIntentId: string; outcome: string; transactionId?: string; error?: string }> = [];
  for (const intent of candidates) {
    if (results.length >= limit) break;
    const quote = intent.quote;
    const attempt = intent.attempts[0];
    if (!quote || quote.network !== ARC_NETWORK || !attempt?.candidateTransactionId) continue;

    const transactionHash = attempt.candidateTransactionId;
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
      results.push({ paymentIntentId: intent.id, outcome: "TRANSACTION_HASH_UNAVAILABLE" });
      continue;
    }

    try {
      const payer = paymentAccountForNetwork(intent.agent.accounts, quote.network);
      const [receiptValue, latestBlockValue, network] = await Promise.all([
        rpc("eth_getTransactionReceipt", [transactionHash]),
        rpc("eth_blockNumber", []),
        db.chainNetwork.findUnique({ where: { id: ARC_NETWORK }, select: { requiredConfirmations: true } }),
      ]);
      if (receiptValue === null) {
        results.push({ paymentIntentId: intent.id, outcome: "PENDING", transactionId: transactionHash });
        continue;
      }
      const receipt = receiptSchema.parse(receiptValue);
      if (receipt.transactionHash.toLowerCase() !== transactionHash.toLowerCase()) throw new Error("ARC_TRANSACTION_HASH_MISMATCH");
      const latestBlock = hex.parse(latestBlockValue);
      const confirmations = BigInt(latestBlock) - BigInt(receipt.blockNumber) + 1n;
      if (confirmations < BigInt(network?.requiredConfirmations ?? 1)) {
        results.push({ paymentIntentId: intent.id, outcome: "PENDING_CONFIRMATIONS", transactionId: transactionHash });
        continue;
      }

      const outcome = arcPaymentReconciliationOutcome(receipt, config.ARC_USDC_ADDRESS, payer.accountId, quote.payToAccountId, quote.amountAtomic.toString());
      const changed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-reconcile:${intent.id}`}, 0))`;
        const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id }, select: { status: true } });
        if (current.status !== "SUBMISSION_UNKNOWN") return false;

        const duplicate = await tx.settlement.findFirst({ where: { network: quote.network, transactionId: transactionHash } });
        if (duplicate && duplicate.paymentAttemptId !== attempt.id) {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: "SETTLEMENT_TRANSACTION_REPLAY" } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_REPLAY_DETECTED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: transactionHash, network: quote.network } } });
          return "REPLAY" as const;
        }

        await tx.settlement.upsert({
          where: { paymentAttemptId: attempt.id },
          create: {
            paymentAttemptId: attempt.id,
            assetId: quote.assetId,
            status: outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED",
            network: quote.network,
            transactionId: transactionHash,
            payerAccountId: payer.accountId,
            payeeAccountId: quote.payToAccountId,
            amountAtomic: quote.amountAtomic,
            resultCode: outcome === "CONFIRMED" ? "SUCCESS" : outcome === "FAILED" ? "EVM_TRANSACTION_FAILED" : "TRANSFER_MISMATCH",
            submittedAt: attempt.createdAt,
            confirmedAt: now,
          },
          update: {
            status: outcome === "CONFIRMED" ? "CONFIRMED" : "FAILED",
            transactionId: transactionHash,
            resultCode: outcome === "CONFIRMED" ? "SUCCESS" : outcome === "FAILED" ? "EVM_TRANSACTION_FAILED" : "TRANSFER_MISMATCH",
            confirmedAt: now,
          },
        });

        if (outcome === "CONFIRMED") {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", errorCode: null } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id }, data: { status: "SETTLED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "SETTLED_FULFILLMENT_UNAVAILABLE" }, update: { status: "FAILED", errorCode: "SETTLED_FULFILLMENT_UNAVAILABLE" } });
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLED_RECONCILED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: transactionHash, network: quote.network, fulfillmentRecovered: false } } });
        } else if (outcome === "FAILED") {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: "EVM_TRANSACTION_FAILED" } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "RELEASED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "EVM_TRANSACTION_FAILED" }, update: { status: "FAILED", errorCode: "EVM_TRANSACTION_FAILED" } });
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_FAILED_RECONCILED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: transactionHash, network: quote.network } } });
        } else {
          await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" } });
          await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLEMENT_FAILED" } });
          await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "CONSUMED" } });
          await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" }, update: { status: "FAILED", errorCode: "SETTLEMENT_TRANSFER_MISMATCH" } });
          await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLEMENT_MISMATCH", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: transactionHash, network: quote.network } } });
        }
        return outcome;
      });

      if (changed === "REPLAY") {
        await ensureIncident(intent.organizationId, intent.id, "Duplicate Arc settlement transaction detected", `Transaction ${transactionHash} is already associated with another payment attempt. The spend reservation remains consumed pending investigation.`);
        results.push({ paymentIntentId: intent.id, outcome: "REPLAY", transactionId: transactionHash });
        continue;
      }
      if (changed === "MISMATCH") {
        await ensureIncident(intent.organizationId, intent.id, "Arc settlement does not match payment quote", `Transaction ${transactionHash} succeeded but its USDC transfer does not match the quoted payer, payee, and amount. The reservation remains consumed pending investigation.`);
      } else if (changed === "CONFIRMED") {
        await ensureIncident(intent.organizationId, intent.id, "Payment settled but fulfillment evidence is unavailable", `Arc transaction ${transactionHash} confirms settlement after an ambiguous resource response. The original paid resource response could not be recovered automatically.`);
      }
      results.push({ paymentIntentId: intent.id, outcome: changed === false ? "ALREADY_RECONCILED" : changed, transactionId: transactionHash });
    } catch (error) {
      results.push({ paymentIntentId: intent.id, outcome: "ERROR", transactionId: transactionHash, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" });
    }
  }

  return { scanned: results.length, results };
}
