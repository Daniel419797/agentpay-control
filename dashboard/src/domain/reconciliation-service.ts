import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { normalizeTransactionId } from "@/lib/hedera-payment";

type MirrorTransfer = { account: string; amount: number };
type MirrorTransaction = {
  transaction_id: string;
  consensus_timestamp: string;
  result: string;
  transfers?: MirrorTransfer[];
  token_transfers?: Array<MirrorTransfer & { token_id: string }>;
};

export function matchMirrorSettlement(
  transactions: MirrorTransaction[],
  expected: { payer: string; payee: string; amountAtomic: bigint; tokenId?: string | null },
) {
  return transactions.find((transaction) => {
    if (transaction.result !== "SUCCESS") return false;
    const transfers = expected.tokenId
      ? transaction.token_transfers?.filter((transfer) => transfer.token_id === expected.tokenId) ?? []
      : transaction.transfers ?? [];
    return transfers.some((transfer) => transfer.account === expected.payer && BigInt(transfer.amount) === -expected.amountAtomic) &&
      transfers.some((transfer) => transfer.account === expected.payee && BigInt(transfer.amount) === expected.amountAtomic);
  });
}

async function reconcileIntent(intentId: string) {
  const intent = await db.paymentIntent.findUniqueOrThrow({
    where: { id: intentId },
    include: {
      quote: { include: { asset: true } },
      agent: { include: { accounts: { where: { status: "ACTIVE" }, take: 1 } } },
      attempts: { where: { status: "UNKNOWN" }, orderBy: { attemptNumber: "desc" }, take: 1 },
    },
  });
  const quote = intent.quote;
  const account = intent.agent.accounts[0];
  const attempt = intent.attempts[0];
  if (!quote || !account || !attempt) return { intentId, outcome: "NOT_RECONCILABLE" as const };
  const timestamp = `${Math.floor(attempt.createdAt.getTime() / 1000)}.000000000`;
  const normalizedCandidateId = attempt.candidateTransactionId ? normalizeTransactionId(attempt.candidateTransactionId) : null;
  const url = normalizedCandidateId
    ? new URL(`/api/v1/transactions/${encodeURIComponent(normalizedCandidateId)}`, getConfig().HEDERA_MIRROR_NODE_URL)
    : new URL("/api/v1/transactions", getConfig().HEDERA_MIRROR_NODE_URL);
  if (!normalizedCandidateId) {
    url.searchParams.set("account.id", account.accountId);
    url.searchParams.set("timestamp", `gte:${timestamp}`);
    url.searchParams.set("order", "asc");
    url.searchParams.set("limit", "100");
  }
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`MIRROR_NODE_${response.status}`);
  const body = await response.json() as { transactions?: MirrorTransaction[] };
  const candidates = normalizedCandidateId
    ? (body.transactions ?? []).filter((transaction) => normalizeTransactionId(transaction.transaction_id) === normalizedCandidateId)
    : body.transactions ?? [];
  const match = matchMirrorSettlement(candidates, {
    payer: account.accountId,
    payee: quote.payToAccountId,
    amountAtomic: BigInt(quote.amountAtomic.toString()),
    tokenId: quote.asset.hederaTokenId,
  });
  if (!match) return { intentId, outcome: "STILL_UNKNOWN" as const };
  const recorded = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-reconcile:${intent.id}`}, 0))`;
    const current = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intent.id }, select: { status: true } });
    if (current.status === "SETTLED") return false;
    if (current.status !== "SUBMISSION_UNKNOWN") return false;
    await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", errorCode: null } });
    await tx.settlement.upsert({
      where: { paymentAttemptId: attempt.id },
      create: { paymentAttemptId: attempt.id, assetId: quote.assetId, status: "CONFIRMED", network: quote.network, transactionId: match.transaction_id, consensusTimestamp: match.consensus_timestamp, payerAccountId: account.accountId, payeeAccountId: quote.payToAccountId, amountAtomic: quote.amountAtomic, resultCode: match.result, submittedAt: attempt.createdAt, confirmedAt: new Date() },
      update: { status: "CONFIRMED", transactionId: match.transaction_id, consensusTimestamp: match.consensus_timestamp, resultCode: match.result, confirmedAt: new Date() },
    });
    await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLED" } });
    await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id }, data: { status: "SETTLED" } });
    await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FAILED", errorCode: "RESPONSE_LOST_AFTER_SETTLEMENT" }, update: { status: "FAILED", errorCode: "RESPONSE_LOST_AFTER_SETTLEMENT" } });
    await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "RESOURCE_FULFILLMENT_INCIDENT", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: match.transaction_id, reason: "RESPONSE_LOST_AFTER_SETTLEMENT" } } });
    return true;
  });
  return recorded
    ? { intentId, outcome: "SETTLED" as const, transactionId: match.transaction_id }
    : { intentId, outcome: "ALREADY_RECONCILED" as const };
}

export async function reconcileUnknownPayments(limit = 25) {
  const intents = await db.paymentIntent.findMany({
    where: { status: "SUBMISSION_UNKNOWN" },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  const results = [];
  for (const intent of intents) {
    try { results.push(await reconcileIntent(intent.id)); }
    catch (error) { results.push({ intentId: intent.id, outcome: "ERROR" as const, error: error instanceof Error ? error.message : "UNKNOWN_ERROR" }); }
  }
  return results;
}
