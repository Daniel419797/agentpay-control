import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { evaluatePolicy, policyScheduleViolation } from "@/domain/policy";
import { paymentFingerprint } from "@/domain/fingerprint";
import { managedPayerMatches, paymentAccountForNetwork, providerPayeeForNetwork, x402AssetIdentifier } from "@/domain/payment-routing";
import { createManagedPaymentPayload, discoverX402, fulfillX402Resource, parsePaymentRequired, selectRequirement, X402SubmissionUnknownError } from "@/domain/x402-client";
import { assertSafeResourceUrl } from "@/lib/safe-url";
import { retrySerializable } from "@/lib/retry";
import { assertPlanLimit } from "@/domain/entitlement-service";

export type PaidRequestInput = { resourceUrl: string; purpose?: string; maxAmountAtomic?: string };

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function failBeforeSigning(intentId: string, organizationId: string, code: string) {
  const status = ["PAYMENT_QUOTE_EXPIRED", "POLICY_EXPIRED", "SPEND_RESERVATION_INVALID"].includes(code) ? "EXPIRED" : "FAILED_BEFORE_SUBMISSION";
  await db.$transaction(async (tx) => {
    const changed = await tx.paymentIntent.updateMany({ where: { id: intentId, status: "AUTHORIZED" }, data: { status } });
    if (changed.count !== 1) return;
    await tx.spendReservation.updateMany({ where: { paymentIntentId: intentId, status: "ACTIVE" }, data: { status: status === "EXPIRED" ? "EXPIRED" : "RELEASED" } });
    await tx.outboxEvent.create({ data: { organizationId, eventType: "PAYMENT_PRE_SIGN_REJECTED", aggregateType: "PAYMENT_INTENT", aggregateId: intentId, payload: { code } } });
  });
}

async function markSubmissionUnknown(
  intent: { id: string; organizationId: string },
  attemptId: string,
  network: string,
  code: string,
  candidateTransactionId?: string,
) {
  await db.$transaction([
    db.paymentAttempt.update({
      where: { id: attemptId },
      data: {
        status: "UNKNOWN",
        errorCode: code,
        ...(candidateTransactionId ? { candidateTransactionId } : {}),
      },
    }),
    db.paymentIntent.update({ where: { id: intent.id }, data: { status: "SUBMISSION_UNKNOWN" } }),
    db.resourceFulfillment.upsert({
      where: { paymentIntentId: intent.id },
      create: { paymentIntentId: intent.id, status: "PENDING", errorCode: code },
      update: { status: "PENDING", errorCode: code },
    }),
    db.outboxEvent.create({
      data: {
        organizationId: intent.organizationId,
        eventType: "PAYMENT_RECONCILIATION_REQUIRED",
        aggregateType: "PAYMENT_INTENT",
        aggregateId: intent.id,
        payload: { attemptId, network, candidateTransactionId: candidateTransactionId ?? null, code },
      },
    }),
  ]);
  return db.paymentIntent.findUniqueOrThrow({ where: { id: intent.id }, include: { quote: { include: { asset: true } }, fulfillment: true, attempts: { include: { settlement: true } } } });
}

export async function executeAuthorizedIntent(intentId: string) {
  const intent = await db.paymentIntent.findUniqueOrThrow({
    where: { id: intentId },
    include: {
      quote: { include: { asset: true } },
      approval: true,
      reservation: true,
      decisions: { orderBy: { evaluatedAt: "desc" }, take: 1 },
      organization: true,
      agent: { include: { accounts: true, effectivePolicy: true } },
    },
  });
  if (intent.status !== "AUTHORIZED") throw new Error("PAYMENT_NOT_AUTHORIZED");
  let preSignError: string | undefined;
  if (!intent.quote) preSignError = "PAYMENT_QUOTE_MISSING";
  else if (intent.organization.killSwitchEnabled) preSignError = "ORGANIZATION_KILL_SWITCH_ENABLED";
  else if (intent.agent.status !== "ACTIVE") preSignError = "AGENT_NOT_ACTIVE";
  else if (intent.quote.validUntil <= new Date()) preSignError = "PAYMENT_QUOTE_EXPIRED";
  else if (!intent.reservation || intent.reservation.status !== "ACTIVE" || intent.reservation.expiresAt <= new Date()) preSignError = "SPEND_RESERVATION_INVALID";
  else if (intent.approval && intent.approval.status !== "CONSUMED") preSignError = "APPROVAL_NOT_CONSUMED";
  else if (!intent.decisions[0] || intent.decisions[0].outcome === "DENY") preSignError = "POLICY_AUTHORIZATION_MISSING";
  else if (intent.agent.effectivePolicyId !== intent.decisions[0].policyVersionId) preSignError = "POLICY_CHANGED";
  else if (!intent.agent.effectivePolicy) preSignError = "POLICY_NOT_PUBLISHED";
  if (preSignError) {
    await failBeforeSigning(intent.id, intent.organizationId, preSignError);
    throw new Error(preSignError);
  }

  const effectivePolicy = intent.agent.effectivePolicy!;
  const scheduleViolation = policyScheduleViolation({
    evaluatedAt: new Date(),
    activeFrom: effectivePolicy.activeFrom,
    activeUntil: effectivePolicy.activeUntil,
    allowedWeekdays: effectivePolicy.allowedWeekdays,
    allowedStartMinute: effectivePolicy.allowedStartMinute,
    allowedEndMinute: effectivePolicy.allowedEndMinute,
  });
  if (scheduleViolation) {
    await failBeforeSigning(intent.id, intent.organizationId, scheduleViolation);
    throw new Error(scheduleViolation);
  }

  const account = paymentAccountForNetwork(intent.agent.accounts, intent.quote!.network);
  if (account.custodyType !== "PLATFORM_MANAGED_TESTNET" || account.signingMode !== "AUTONOMOUS_MANAGED") throw new Error("MANAGED_SIGNER_REQUIRED");
  const config = getConfig();
  if (!managedPayerMatches(account, config)) throw new Error("MANAGED_PAYER_MISMATCH");
  if (account.network === "eip155:5042002") {
    if (!config.ARC_FACILITATOR_URL || !config.ARC_FACILITATOR_SIGNING_API_KEY) throw new Error("LIVE_FACILITATOR_REQUIRED");
  } else if (account.network === "hedera:testnet") {
    if (!config.FACILITATOR_URL || !config.FACILITATOR_SIGNING_API_KEY) throw new Error("LIVE_FACILITATOR_REQUIRED");
  } else {
    throw new Error("MANAGED_SIGNER_NETWORK_UNSUPPORTED");
  }

  const required = parsePaymentRequired(intent.quote!.rawChallenge);
  const requirement = selectRequirement(required, {
    network: intent.quote!.network,
    asset: x402AssetIdentifier(intent.quote!.asset, intent.quote!.network, config),
    amount: intent.quote!.amountAtomic.toString(),
    payTo: intent.quote!.payToAccountId,
    resourceUrl: intent.resourceUrl,
  });
  const claimed = await db.paymentIntent.updateMany({ where: { id: intent.id, status: "AUTHORIZED" }, data: { status: "SIGNING" } });
  if (claimed.count !== 1) throw new Error("PAYMENT_ALREADY_CLAIMED");
  const attemptNumber = (await db.paymentAttempt.count({ where: { paymentIntentId: intent.id } })) + 1;
  const attempt = await db.paymentAttempt.create({ data: { paymentIntentId: intent.id, attemptNumber, status: "STARTED", facilitatorRequestId: randomUUID() } });

  let confirmedSettlement: { transactionId: string; network: string } | undefined;
  try {
    const signed = await createManagedPaymentPayload(requirement);
    await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "SIGNED", signatureFingerprint: hash(signed.paymentPayload), candidateTransactionId: signed.transactionId } });

    const fulfillment = await fulfillX402Resource(intent.resourceUrl, requirement, signed.paymentPayload, config.APP_ENV === "production");
    confirmedSettlement = { transactionId: fulfillment.transactionId, network: fulfillment.network };

    // Persist the strongest settlement evidence before the larger bookkeeping
    // transaction. If later DB/audit writes fail, reconciliation can still use
    // the exact chain transaction returned by the resource server.
    await db.paymentAttempt.update({
      where: { id: attempt.id },
      data: { status: "SUBMITTED", candidateTransactionId: fulfillment.transactionId },
    });

    if (fulfillment.network !== requirement.network) throw new Error("SETTLEMENT_NETWORK_MISMATCH");

    return db.$transaction(async (tx) => {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED" } });
      await tx.settlement.create({ data: { paymentAttemptId: attempt.id, assetId: intent.quote!.assetId, status: "CONFIRMED", network: fulfillment.network, transactionId: fulfillment.transactionId, payerAccountId: account.accountId, payeeAccountId: intent.quote!.payToAccountId, amountAtomic: intent.quote!.amountAtomic, resultCode: "SUCCESS", submittedAt: new Date(), confirmedAt: new Date() } });
      const responseBody = JSON.parse(JSON.stringify(fulfillment.body));
      await tx.resourceFulfillment.upsert({ where: { paymentIntentId: intent.id }, create: { paymentIntentId: intent.id, status: "FULFILLED", contentType: fulfillment.contentType, contentHash: fulfillment.contentHash, contentBytes: fulfillment.contentBytes, responseBody, fulfilledAt: new Date() }, update: { status: "FULFILLED", contentType: fulfillment.contentType, contentHash: fulfillment.contentHash, contentBytes: fulfillment.contentBytes, responseBody, errorCode: null, fulfilledAt: new Date() } });
      await tx.spendReservation.updateMany({ where: { paymentIntentId: intent.id }, data: { status: "SETTLED" } });
      await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_SETTLED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { transactionId: fulfillment.transactionId, network: fulfillment.network, resourceUrl: intent.resourceUrl } } });
      return tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SETTLED" }, include: { quote: { include: { asset: true } }, fulfillment: true, attempts: { include: { settlement: true } } } });
    });
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 120) : "PAYMENT_FAILED";
    if (error instanceof X402SubmissionUnknownError || confirmedSettlement) {
      const candidateTransactionId = confirmedSettlement?.transactionId
        ?? (error instanceof X402SubmissionUnknownError ? error.candidateTransactionId : undefined);
      return markSubmissionUnknown(
        intent,
        attempt.id,
        requirement.network,
        confirmedSettlement ? `POST_SETTLEMENT_${errorCode}` : errorCode,
        candidateTransactionId,
      );
    }

    await db.$transaction([
      db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode } }),
      db.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED_BEFORE_SUBMISSION" } }),
      db.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "RELEASED" } }),
    ]);
    throw error;
  }
}

export async function createPaidRequest(agentId: string, idempotencyKey: string, input: PaidRequestInput) {
  const config = getConfig();
  const resourceUrl = await assertSafeResourceUrl(input.resourceUrl, config.APP_ENV === "production");
  const canonical = { agentId, resourceUrl: resourceUrl.toString(), purpose: input.purpose ?? null, maxAmountAtomic: input.maxAmountAtomic ?? null };
  const requestHash = hash(canonical);
  const preexisting = await db.paymentIntent.findFirst({ where: { agentId, idempotencyKey }, include: { quote: { include: { asset: true } }, approval: true, fulfillment: true, attempts: { include: { settlement: true } } } });
  if (preexisting) { if (preexisting.requestHash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT"); return preexisting; }

  const required = await discoverX402(resourceUrl, config.APP_ENV === "production");
  const result = await retrySerializable(() => db.$transaction(async (tx) => {
    const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId }, include: { organization: true, effectivePolicy: { include: { asset: true } }, accounts: { where: { status: "ACTIVE" }, include: { balances: { orderBy: { asOf: "desc" }, take: 1 } } } } });
    const existing = await tx.paymentIntent.findUnique({ where: { organizationId_agentId_idempotencyKey: { organizationId: agent.organizationId, agentId, idempotencyKey } }, include: { quote: { include: { asset: true } }, approval: true, attempts: { include: { settlement: true } } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT");
      return { intent: existing, shouldExecute: false };
    }

    await assertPlanLimit(tx, agent.organizationId, "PAYMENT_INTENTS");
    const policy = agent.effectivePolicy;
    if (!policy) throw new Error("POLICY_NOT_PUBLISHED");
    const listing = await tx.resourceListing.findFirst({ where: { endpoint: canonical.resourceUrl, status: "ACTIVE" }, include: { provider: true, prices: { where: { assetId: policy.assetId }, take: 1 } } });
    if (!listing?.prices[0]) throw new Error("RESOURCE_PRICE_NOT_FOUND");

    const expectedPayee = providerPayeeForNetwork(listing.provider, agent.network, config);
    const requirement = selectRequirement(required, { network: agent.network, asset: x402AssetIdentifier(policy.asset, agent.network, config), amount: listing.prices[0].atomicAmount.toString(), payTo: expectedPayee, resourceUrl: canonical.resourceUrl });
    const amountAtomic = requirement.amount;
    if (input.maxAmountAtomic && BigInt(amountAtomic) > BigInt(input.maxAmountAtomic)) throw new Error("MAX_AMOUNT_EXCEEDED");

    const account = paymentAccountForNetwork(agent.accounts, requirement.network);
    if (account.custodyType !== "PLATFORM_MANAGED_TESTNET" || account.signingMode !== "AUTONOMOUS_MANAGED") throw new Error("MANAGED_SIGNER_REQUIRED");

    const now = new Date();
    const balanceSnapshot = account.balances[0];
    const rawBalanceAtomic = balanceSnapshot?.spendableAtomic.toString() ?? "0";
    const balanceAsOf = balanceSnapshot?.asOf ?? new Date(0);
    const dayStart = new Date(now); dayStart.setUTCHours(0, 0, 0, 0);
    const hourStart = new Date(now); hourStart.setUTCMinutes(0, 0, 0);
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const sharedTreasury = account.custodyType === "PLATFORM_MANAGED_TESTNET";
    const scope = sharedTreasury ? { agent: { organizationId: agent.organizationId } } : { agentId };
    const spentStatuses = ["ACTIVE", "CONSUMED", "SETTLED"] as const;
    const [daily, hourly, monthly, balanceCommitted, lastReservation] = await Promise.all([
      tx.spendReservation.aggregate({ where: { ...scope, assetId: policy.assetId, createdAt: { gte: dayStart }, status: { in: [...spentStatuses] } }, _sum: { amountAtomic: true } }),
      tx.spendReservation.aggregate({ where: { ...scope, assetId: policy.assetId, createdAt: { gte: hourStart }, status: { in: [...spentStatuses] } }, _sum: { amountAtomic: true }, _count: { _all: true } }),
      tx.spendReservation.aggregate({ where: { ...scope, assetId: policy.assetId, createdAt: { gte: monthStart }, status: { in: [...spentStatuses] } }, _sum: { amountAtomic: true } }),
      tx.spendReservation.aggregate({
        where: {
          ...scope,
          assetId: policy.assetId,
          OR: [
            { status: { in: ["ACTIVE", "CONSUMED"] } },
            { status: "SETTLED", updatedAt: { gt: balanceAsOf } },
          ],
        },
        _sum: { amountAtomic: true },
      }),
      tx.spendReservation.findFirst({ where: { ...scope, assetId: policy.assetId, status: { in: [...spentStatuses] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const availableBalance = BigInt(rawBalanceAtomic) - BigInt(balanceCommitted._sum.amountAtomic?.toString() ?? "0");
    const balanceAtomic = (availableBalance > 0n ? availableBalance : 0n).toString();
    const decision = evaluatePolicy({
      agentStatus: agent.status,
      organizationKillSwitch: agent.organization.killSwitchEnabled,
      assetSupported: true,
      challengeExpired: false,
      merchantHost: resourceUrl.hostname,
      merchantCategory: listing.category,
      merchantMode: policy.merchantMode,
      allowedHosts: policy.allowedHosts,
      deniedHosts: policy.deniedHosts,
      allowedMerchantCategories: policy.allowedMerchantCategories,
      evaluatedAt: now,
      activeFrom: policy.activeFrom,
      activeUntil: policy.activeUntil,
      allowedWeekdays: policy.allowedWeekdays,
      allowedStartMinute: policy.allowedStartMinute,
      allowedEndMinute: policy.allowedEndMinute,
      amountAtomic,
      balanceAtomic,
      settledTodayAtomic: "0",
      reservedTodayAtomic: daily._sum.amountAtomic?.toString() ?? "0",
      perTransactionLimitAtomic: policy.perTransactionLimitAtomic.toString(),
      dailyLimitAtomic: policy.dailyLimitAtomic.toString(),
      hourlySpendAtomic: hourly._sum.amountAtomic?.toString() ?? "0",
      hourlyLimitAtomic: policy.hourlyLimitAtomic?.toString(),
      monthlySpendAtomic: monthly._sum.amountAtomic?.toString() ?? "0",
      monthlyLimitAtomic: policy.monthlyLimitAtomic?.toString(),
      transactionsLastHour: hourly._count._all,
      maxTransactionsPerHour: policy.maxTransactionsPerHour,
      lastTransactionAt: lastReservation?.createdAt,
      cooldownSeconds: policy.cooldownSeconds,
      overLimitAction: policy.overLimitAction,
    });
    const challengeValidUntil = new Date(now.getTime() + requirement.maxTimeoutSeconds * 1000);
    const validUntil = policy.activeUntil && policy.activeUntil < challengeValidUntil ? policy.activeUntil : challengeValidUntil;
    const fingerprint = paymentFingerprint({ network: requirement.network, scheme: requirement.scheme, payerAccountId: account.accountId, payeeAccountId: requirement.payTo, assetId: policy.assetId, amountAtomic, resourceUrl: canonical.resourceUrl, validUntil: validUntil.toISOString() });
    const status = decision.decision === "ALLOW" ? "AUTHORIZED" : decision.decision === "DENY" ? "DENIED" : "APPROVAL_PENDING";
    const rawChallenge = JSON.parse(JSON.stringify(required));
    const intent = await tx.paymentIntent.create({
      data: {
        organizationId: agent.organizationId,
        agentId,
        idempotencyKey,
        requestHash,
        resourceUrl: canonical.resourceUrl,
        merchantHost: resourceUrl.hostname,
        purpose: input.purpose,
        status,
        quote: { create: { x402Version: 2, scheme: requirement.scheme, network: requirement.network, resourceDescription: required.resource.description ?? listing.description, payToAccountId: requirement.payTo, assetId: policy.assetId, amountAtomic, validUntil, fingerprint, rawChallenge } },
        decisions: { create: { policyVersionId: policy.id, outcome: decision.decision, reasonCodes: decision.reasonCodes, factsHash: hash({ canonical, amountAtomic, balanceAtomic, network: requirement.network, payerAccountId: account.accountId, payeeAccountId: requirement.payTo, policyVersionId: policy.id }), spendBeforeAtomic: daily._sum.amountAtomic ?? 0, reservedBeforeAtomic: balanceCommitted._sum.amountAtomic ?? 0, projectedAtomic: decision.projectedSpendAtomic } },
        reservation: decision.decision === "DENY" ? undefined : { create: { agentId, assetId: policy.assetId, amountAtomic, windowStart: dayStart, windowEnd: new Date(dayStart.getTime() + 86_400_000), expiresAt: validUntil } },
        approval: decision.decision === "REQUIRE_APPROVAL" ? { create: { requestPurpose: input.purpose, expiresAt: validUntil, requiredApprovals: policy.approvalThreshold, requiredRejections: policy.rejectionThreshold } } : undefined,
      },
      include: { quote: { include: { asset: true } }, approval: true, fulfillment: true, attempts: { include: { settlement: true } } },
    });
    return { intent, shouldExecute: status === "AUTHORIZED" };
  }, { isolationLevel: "Serializable" }));
  return result.shouldExecute ? executeAuthorizedIntent(result.intent.id) : result.intent;
}
