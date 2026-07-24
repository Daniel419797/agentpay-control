import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { evaluatePolicy } from "@/domain/policy";
import { paymentFingerprint } from "@/domain/fingerprint";

export type PaidRequestInput = { resourceUrl: string; purpose?: string; maxAmountAtomic?: string };

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

export async function executeAuthorizedIntent(intentId: string) {
  const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: intentId }, include: { quote: { include: { asset: true } }, agent: { include: { accounts: true } } } });
  if (!intent.quote) throw new Error("PAYMENT_QUOTE_MISSING");
  const account = intent.agent.accounts.find((candidate) => candidate.status === "ACTIVE");
  if (!account) throw new Error("PAYMENT_ACCOUNT_UNAVAILABLE");
  const config = getConfig();
  if (!config.FACILITATOR_URL) throw new Error("LIVE_FACILITATOR_REQUIRED");
  const attemptNumber = (await db.paymentAttempt.count({ where: { paymentIntentId: intent.id } })) + 1;
  await db.paymentIntent.update({ where: { id: intent.id }, data: { status: "SIGNING" } });
  const attempt = await db.paymentAttempt.create({ data: { paymentIntentId: intent.id, attemptNumber, status: "SIGNED", facilitatorRequestId: randomUUID(), signatureFingerprint: hash({ intentId, attemptNumber }) } });

  const response = await fetch(`${config.FACILITATOR_URL}/managed-settle`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ intentId, fingerprint: intent.quote.fingerprint, payerAccountId: account.accountId, payeeAccountId: intent.quote.payToAccountId, amountAtomic: intent.quote.amountAtomic.toString(), asset: { type: intent.quote.asset.type, hederaTokenId: intent.quote.asset.hederaTokenId } }) });
  if (!response.ok) { await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: `FACILITATOR_${response.status}` } }); await db.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED_BEFORE_SUBMISSION" } }); throw new Error("FACILITATOR_REJECTED"); }
  const settlement = await response.json() as { transactionId: string; consensusTimestamp?: string; resultCode: string };
  await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED" } });
  await db.settlement.create({ data: { paymentAttemptId: attempt.id, assetId: intent.quote.assetId, status: "CONFIRMED", network: intent.quote.network, transactionId: settlement.transactionId, consensusTimestamp: settlement.consensusTimestamp, payerAccountId: account.accountId, payeeAccountId: intent.quote.payToAccountId, amountAtomic: intent.quote.amountAtomic, resultCode: settlement.resultCode, submittedAt: new Date(), confirmedAt: new Date() } });
  await db.spendReservation.updateMany({ where: { paymentIntentId: intent.id }, data: { status: "SETTLED" } });
  return db.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLED" }, include: { quote: { include: { asset: true } }, attempts: { include: { settlement: true } } } });
}

export async function createPaidRequest(agentId: string, idempotencyKey: string, input: PaidRequestInput) {
  const canonical = { agentId, resourceUrl: new URL(input.resourceUrl).toString(), purpose: input.purpose ?? null, maxAmountAtomic: input.maxAmountAtomic ?? null };
  const requestHash = hash(canonical);
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId }, include: { organization: true, effectivePolicy: true, accounts: { where: { status: "ACTIVE" }, include: { balances: { orderBy: { asOf: "desc" }, take: 1 } } } } });
  const existing = await db.paymentIntent.findUnique({ where: { organizationId_agentId_idempotencyKey: { organizationId: agent.organizationId, agentId, idempotencyKey } }, include: { quote: { include: { asset: true } }, approval: true, attempts: { include: { settlement: true } } } });
  if (existing) { if (existing.requestHash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT"); return existing; }
  const policy = agent.effectivePolicy;
  if (!policy) throw new Error("POLICY_NOT_PUBLISHED");
  const listing = await db.resourceListing.findFirst({ where: { OR: [{ endpoint: canonical.resourceUrl }, { slug: new URL(canonical.resourceUrl).pathname.split("/").filter(Boolean).at(-1) }], status: "ACTIVE" }, include: { provider: true, prices: { where: { assetId: policy.assetId }, take: 1 } } });
  if (!listing?.prices[0]) throw new Error("RESOURCE_PRICE_NOT_FOUND");
  const amountAtomic = listing.prices[0].atomicAmount.toString();
  if (input.maxAmountAtomic && BigInt(amountAtomic) > BigInt(input.maxAmountAtomic)) throw new Error("MAX_AMOUNT_EXCEEDED");
  const account = agent.accounts[0];
  const balanceAtomic = account?.balances[0]?.spendableAtomic.toString() ?? "0";
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  const reservations = await db.spendReservation.aggregate({ where: { agentId, assetId: policy.assetId, windowStart: { gte: dayStart }, status: { in: ["ACTIVE", "CONSUMED", "SETTLED"] } }, _sum: { amountAtomic: true } });
  const decision = evaluatePolicy({ agentStatus: agent.status, organizationKillSwitch: agent.organization.killSwitchEnabled, assetSupported: true, challengeExpired: false, merchantHost: new URL(canonical.resourceUrl).hostname, merchantMode: policy.merchantMode, allowedHosts: policy.allowedHosts, deniedHosts: policy.deniedHosts, amountAtomic, balanceAtomic, settledTodayAtomic: "0", reservedTodayAtomic: reservations._sum.amountAtomic?.toString() ?? "0", perTransactionLimitAtomic: policy.perTransactionLimitAtomic.toString(), dailyLimitAtomic: policy.dailyLimitAtomic.toString(), overLimitAction: policy.overLimitAction });
  const validUntil = new Date(Date.now() + 15 * 60_000);
  const fingerprint = paymentFingerprint({ network: agent.network, scheme: "exact", payerAccountId: account?.accountId ?? "unavailable", payeeAccountId: listing.provider.settlementAccountId, assetId: policy.assetId, amountAtomic, resourceUrl: canonical.resourceUrl, validUntil: validUntil.toISOString() });
  const status = decision.decision === "ALLOW" ? "AUTHORIZED" : decision.decision === "DENY" ? "DENIED" : "APPROVAL_PENDING";
  const intent = await db.paymentIntent.create({ data: { organizationId: agent.organizationId, agentId, idempotencyKey, requestHash, resourceUrl: canonical.resourceUrl, merchantHost: new URL(canonical.resourceUrl).hostname, purpose: input.purpose, status, quote: { create: { x402Version: 2, scheme: "exact", network: agent.network, resourceDescription: listing.description, payToAccountId: listing.provider.settlementAccountId, assetId: policy.assetId, amountAtomic, validUntil, fingerprint, rawChallenge: { x402Version: 2, accepts: [{ scheme: "exact", network: agent.network, amount: amountAtomic, payTo: listing.provider.settlementAccountId }] } } }, decisions: { create: { policyVersionId: policy.id, outcome: decision.decision, reasonCodes: decision.reasonCodes, factsHash: hash({ canonical, amountAtomic, balanceAtomic }), spendBeforeAtomic: "0", reservedBeforeAtomic: reservations._sum.amountAtomic ?? 0, projectedAtomic: decision.projectedSpendAtomic } }, reservation: decision.decision === "DENY" ? undefined : { create: { agentId, assetId: policy.assetId, amountAtomic, windowStart: dayStart, windowEnd: new Date(dayStart.getTime() + 86_400_000), expiresAt: validUntil } }, approval: decision.decision === "REQUIRE_APPROVAL" ? { create: { requestPurpose: input.purpose, expiresAt: validUntil } } : undefined } });
  if (status === "AUTHORIZED") return executeAuthorizedIntent(intent.id);
  return db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id }, include: { quote: { include: { asset: true } }, approval: true, attempts: { include: { settlement: true } } } });
}
