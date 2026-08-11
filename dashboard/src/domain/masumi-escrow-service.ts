import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { combinePolicyOutcomes, evaluateUsdPolicy, loadCatalystPolicyContext, valueWithPyth } from "@/domain/catalyst-policy";
import { evaluatePolicy } from "@/domain/policy";
import { x402AssetIdentifier } from "@/domain/payment-routing";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { assertMasumiEntryMatches, fetchMasumiAgent, type MasumiNetwork } from "@/lib/masumi";
import {
  authorizeMasumiRefund,
  createMasumiPurchase,
  fetchMasumiJobStatus,
  findMasumiPurchase,
  masumiInputHash,
  requestMasumiRefund,
  startMasumiJob,
  verifyMasumiResultHash,
} from "@/lib/masumi-payment";

const fixedPricingSchema = z.object({
  pricingType: z.literal("Fixed"),
  Pricing: z.array(z.object({ unit: z.string(), amount: z.string().regex(/^[1-9]\d*$/) })).min(1).max(25),
});
const escrowRowSchema = z.object({
  id: z.string().uuid(), organizationId: z.string().uuid(), agentId: z.string().uuid(), resourceListingId: z.string().uuid().nullable(),
  paymentIntentId: z.string().uuid().nullable(), idempotencyKey: z.string(), requestHash: z.string(), network: z.enum(["Preprod", "Mainnet"]),
  agentIdentifier: z.string(), masumiPurchaseId: z.string().nullable(), jobId: z.string(), blockchainIdentifier: z.string(), identifierFromPurchaser: z.string(),
  sellerAddress: z.string(), sellerPaymentKeyHash: z.string(), paymentType: z.string(), inputHash: z.string(), inputEncrypted: z.string(),
  resultHash: z.string().nullable(), resultVerifiedAt: z.coerce.date().nullable(), state: z.string(), providerState: z.string().nullable(), amounts: z.unknown(),
  providerEvidence: z.unknown().nullable(), refundRequestedAt: z.coerce.date().nullable(), refundAuthorizedAt: z.coerce.date().nullable(), disputedAt: z.coerce.date().nullable(),
  completedAt: z.coerce.date().nullable(), lastReconciledAt: z.coerce.date().nullable(), failureCode: z.string().nullable(), createdAt: z.coerce.date(), updatedAt: z.coerce.date(),
});

export type MasumiReputation = { scoreBps: number; completedVerified: number; refunds: number; disputes: number; failures: number; observations: number };

function hash(value: unknown) {
  const stable = (item: unknown): string => item === null || typeof item !== "object" ? JSON.stringify(item) : Array.isArray(item)
    ? `[${item.map(stable).join(",")}]`
    : `{${Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(",")}}`;
  return createHash("sha256").update(stable(value)).digest("hex");
}

function cardanoNetwork(network: string): MasumiNetwork {
  if (network === "cardano:preprod") return "Preprod";
  if (network === "cardano:mainnet") return "Mainnet";
  throw new Error("MASUMI_CARDANO_NETWORK_REQUIRED");
}

function masumiUnitForAsset(asset: { type: string; symbol: string; hederaTokenId?: string | null }, network: string) {
  const identifier = x402AssetIdentifier(asset as { type: "NATIVE" | "TOKEN"; symbol: string; hederaTokenId?: string | null }, network, getConfig());
  return identifier === "lovelace" ? "" : identifier;
}

function priceForPolicy(entryPricing: unknown, expectedUnit: string) {
  const pricing = fixedPricingSchema.parse(entryPricing);
  const exact = pricing.Pricing.filter((price) => price.unit.toLowerCase() === expectedUnit.toLowerCase());
  if (exact.length !== 1) throw new Error(exact.length ? "MASUMI_PRICE_AMBIGUOUS" : "MASUMI_POLICY_ASSET_NOT_PRICED");
  return exact[0];
}

function dayStart(now: Date) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); }
function monthStart(now: Date) { return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)); }

async function atomicSpend(agentId: string, assetId: string, now: Date) {
  const hour = new Date(now.getTime() - 60 * 60_000);
  const day = dayStart(now), month = monthStart(now);
  const sum = async (start: Date, statuses: Array<"ACTIVE" | "CONSUMED" | "SETTLED">) => {
    const row = await db.spendReservation.aggregate({ where: { agentId, assetId, createdAt: { gte: start }, status: { in: statuses } }, _sum: { amountAtomic: true } });
    return BigInt(row._sum.amountAtomic?.toString() ?? "0");
  };
  const [hourly, settledToday, reservedToday, monthly] = await Promise.all([
    sum(hour, ["ACTIVE", "CONSUMED", "SETTLED"]), sum(day, ["SETTLED"]), sum(day, ["ACTIVE", "CONSUMED"]), sum(month, ["ACTIVE", "CONSUMED", "SETTLED"]),
  ]);
  const transactionsLastHour = await db.paymentIntent.count({ where: { agentId, createdAt: { gte: hour }, status: { notIn: ["DENIED", "REJECTED", "CANCELED", "FAILED_BEFORE_SUBMISSION"] } } });
  const last = await db.paymentIntent.findFirst({ where: { agentId, status: { in: ["AUTHORIZED", "SIGNING", "SUBMITTED", "SUBMISSION_UNKNOWN", "SETTLED"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  return { hourly, settledToday, reservedToday, monthly, transactionsLastHour, lastTransactionAt: last?.createdAt ?? null };
}

async function usdSpend(agentId: string, now: Date) {
  const rows = await db.$queryRaw<Array<{ hourly: bigint; daily: bigint; monthly: bigint }>>`
    SELECT
      COALESCE(SUM(CASE WHEN s."createdAt" >= ${new Date(now.getTime() - 60 * 60_000)} THEN u."usdMicros" ELSE 0 END), 0)::bigint AS hourly,
      COALESCE(SUM(CASE WHEN s."createdAt" >= ${dayStart(now)} THEN u."usdMicros" ELSE 0 END), 0)::bigint AS daily,
      COALESCE(SUM(CASE WHEN s."createdAt" >= ${monthStart(now)} THEN u."usdMicros" ELSE 0 END), 0)::bigint AS monthly
    FROM "SpendReservation" s
    JOIN "UsdSpendReservationSnapshot" u ON u."spendReservationId" = s."id"
    WHERE s."agentId" = ${agentId}::uuid AND s."status" IN ('ACTIVE','CONSUMED','SETTLED')
  `;
  return { hourlyUsdMicros: BigInt(rows[0]?.hourly ?? 0), dailyUsdMicros: BigInt(rows[0]?.daily ?? 0), monthlyUsdMicros: BigInt(rows[0]?.monthly ?? 0) };
}

export async function masumiReputation(agentIdentifier: string, network: MasumiNetwork): Promise<MasumiReputation> {
  const rows = await db.$queryRaw<Array<{ completed: bigint; refunds: bigint; disputes: bigint; failures: bigint }>>`
    SELECT
      COUNT(*) FILTER (WHERE "state" = 'Completed' AND "resultVerifiedAt" IS NOT NULL)::bigint AS completed,
      COUNT(*) FILTER (WHERE "state" = 'RefundAuthorized')::bigint AS refunds,
      COUNT(*) FILTER (WHERE "state" = 'Disputed')::bigint AS disputes,
      COUNT(*) FILTER (WHERE "state" = 'FAILED')::bigint AS failures
    FROM "MasumiEscrowPurchase"
    WHERE lower("agentIdentifier") = lower(${agentIdentifier}) AND "network" = ${network}
  `;
  const completedVerified = Number(rows[0]?.completed ?? 0), refunds = Number(rows[0]?.refunds ?? 0), disputes = Number(rows[0]?.disputes ?? 0), failures = Number(rows[0]?.failures ?? 0);
  const observations = completedVerified + refunds + disputes + failures;
  const scoreBps = observations === 0 ? 0 : Math.floor((completedVerified * 10000) / observations);
  return { scoreBps, completedVerified, refunds, disputes, failures, observations };
}

async function assertReputation(policyVersionId: string, agentIdentifier: string, network: MasumiNetwork) {
  const rows = await db.$queryRaw<Array<{ minimumReputationBps: number | null; minimumCompletedPurchases: number }>>`
    SELECT "minimumReputationBps", "minimumCompletedPurchases" FROM "MasumiPolicyTrust" WHERE "policyVersionId" = ${policyVersionId}::uuid LIMIT 1
  `;
  const limits = rows[0];
  if (!limits || (limits.minimumReputationBps == null && !limits.minimumCompletedPurchases)) return null;
  const reputation = await masumiReputation(agentIdentifier, network);
  if (reputation.completedVerified < limits.minimumCompletedPurchases) throw new Error("MASUMI_REPUTATION_HISTORY_INSUFFICIENT");
  if (limits.minimumReputationBps != null && reputation.scoreBps < limits.minimumReputationBps) throw new Error("MASUMI_REPUTATION_BELOW_POLICY");
  return reputation;
}

async function assertKeriResourceTrust(policyVersionId: string, resourceListingId: string, agentIdentifier: string, now = new Date()) {
  const policies = await db.$queryRaw<Array<{ required: boolean; trustedIssuerAids: string[]; allowedSchemaSaids: string[]; maxVerificationAgeSeconds: number }>>`
    SELECT * FROM "KeriPolicyTrust" WHERE "policyVersionId" = ${policyVersionId}::uuid LIMIT 1
  `;
  if (!policies[0]?.required) return null;
  const identities = await db.$queryRaw<Array<{ masumiAgentIdentifier: string; aid: string; credentialSaid: string; issuerAid: string; schemaSaid: string; verifiedAt: Date; expiresAt: Date | null; claimsHash: string }>>`
    SELECT "masumiAgentIdentifier", "aid", "credentialSaid", "issuerAid", "schemaSaid", "verifiedAt", "expiresAt", "claimsHash"
    FROM "KeriResourceIdentity" WHERE "resourceListingId" = ${resourceListingId}::uuid LIMIT 1
  `;
  const identity = identities[0];
  if (!identity) throw new Error("VERIDIAN_RESOURCE_IDENTITY_REQUIRED");
  if (identity.masumiAgentIdentifier.toLowerCase() !== agentIdentifier.toLowerCase()) throw new Error("VERIDIAN_MASUMI_IDENTITY_MISMATCH");
  if (policies[0].trustedIssuerAids.length && !policies[0].trustedIssuerAids.includes(identity.issuerAid)) throw new Error("VERIDIAN_ISSUER_NOT_TRUSTED");
  if (policies[0].allowedSchemaSaids.length && !policies[0].allowedSchemaSaids.includes(identity.schemaSaid)) throw new Error("VERIDIAN_SCHEMA_NOT_ALLOWED");
  if (now.getTime() - new Date(identity.verifiedAt).getTime() > policies[0].maxVerificationAgeSeconds * 1000) throw new Error("VERIDIAN_VERIFICATION_STALE");
  if (identity.expiresAt && new Date(identity.expiresAt) <= now) throw new Error("VERIDIAN_CREDENTIAL_EXPIRED");
  return identity;
}

async function escrowRowForIntent(paymentIntentId: string) {
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "MasumiEscrowPurchase" WHERE "paymentIntentId" = ${paymentIntentId}::uuid LIMIT 1`;
  return rows[0] ? escrowRowSchema.parse(rows[0]) : null;
}

export async function prepareMasumiEscrowPayment(input: {
  organizationId: string; agentId: string; resourceListingId: string; idempotencyKey: string; inputData: unknown; purpose?: string; initiatedByUserId?: string;
}) {
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 100) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
  const existing = await db.paymentIntent.findFirst({ where: { organizationId: input.organizationId, agentId: input.agentId, idempotencyKey: input.idempotencyKey }, include: { quote: true, approval: true } });
  const requestHash = hash({ agentId: input.agentId, resourceListingId: input.resourceListingId, inputData: input.inputData, purpose: input.purpose ?? null, settlement: "MASUMI_ESCROW" });
  if (existing) { if (existing.requestHash !== requestHash) throw new Error("IDEMPOTENCY_CONFLICT"); return existing; }

  const agent = await db.agent.findFirst({ where: { id: input.agentId, organizationId: input.organizationId }, include: { organization: true, effectivePolicy: { include: { asset: true } } } });
  if (!agent || agent.status !== "ACTIVE") throw new Error("AGENT_NOT_ACTIVE");
  if (agent.organization.status !== "ACTIVE" || agent.organization.killSwitchEnabled) throw new Error(agent.organization.killSwitchEnabled ? "ORGANIZATION_KILL_SWITCH_ENABLED" : "ORGANIZATION_NOT_ACTIVE");
  if (!agent.effectivePolicy) throw new Error("POLICY_NOT_PUBLISHED");
  const resource = await db.resourceListing.findFirst({ where: { id: input.resourceListingId, status: "ACTIVE" }, include: { provider: true } });
  if (!resource || resource.provider.status !== "ACTIVE" || resource.provider.verificationStatus !== "VERIFIED") throw new Error("RESOURCE_PROVIDER_NOT_VERIFIED");
  const network = cardanoNetwork(agent.network);
  const bindingRows = await db.$queryRaw<Array<{ agentIdentifier: string; expiresAt: Date }>>`SELECT "agentIdentifier", "expiresAt" FROM "MasumiResourceBinding" WHERE "resourceListingId" = ${resource.id}::uuid LIMIT 1`;
  if (!bindingRows[0] || new Date(bindingRows[0].expiresAt) <= new Date()) throw new Error("MASUMI_RESOURCE_BINDING_REQUIRED");
  const entry = await fetchMasumiAgent(bindingRows[0].agentIdentifier, network);
  assertMasumiEntryMatches(entry, { network, agentIdentifier: bindingRows[0].agentIdentifier, resourceUrl: resource.endpoint });
  const expectedUnit = masumiUnitForAsset(agent.effectivePolicy.asset, agent.network);
  const price = priceForPolicy(entry.AgentPricing, expectedUnit);
  const reputation = await assertReputation(agent.effectivePolicy.id, entry.agentIdentifier, network);
  const keri = await assertKeriResourceTrust(agent.effectivePolicy.id, resource.id, entry.agentIdentifier);
  const balance = await db.balanceSnapshot.findFirst({ where: { assetId: agent.effectivePolicy.assetId, paymentAccount: { agentId: agent.id, network: agent.network, status: "ACTIVE" } }, orderBy: { asOf: "desc" } });
  if (!balance) throw new Error("BALANCE_NOT_AVAILABLE");
  const now = new Date(), spend = await atomicSpend(agent.id, agent.effectivePolicy.assetId, now);
  const base = evaluatePolicy({
    agentStatus: agent.status, organizationKillSwitch: agent.organization.killSwitchEnabled, assetSupported: true, challengeExpired: false,
    merchantHost: new URL(resource.endpoint).hostname, merchantMode: agent.effectivePolicy.merchantMode, allowedHosts: agent.effectivePolicy.allowedHosts, deniedHosts: agent.effectivePolicy.deniedHosts,
    merchantCategory: resource.category, allowedMerchantCategories: agent.effectivePolicy.allowedMerchantCategories, evaluatedAt: now,
    activeFrom: agent.effectivePolicy.activeFrom, activeUntil: agent.effectivePolicy.activeUntil, allowedWeekdays: agent.effectivePolicy.allowedWeekdays,
    allowedStartMinute: agent.effectivePolicy.allowedStartMinute, allowedEndMinute: agent.effectivePolicy.allowedEndMinute, amountAtomic: price.amount,
    balanceAtomic: balance.spendableAtomic.toString(), settledTodayAtomic: spend.settledToday.toString(), reservedTodayAtomic: spend.reservedToday.toString(),
    perTransactionLimitAtomic: agent.effectivePolicy.perTransactionLimitAtomic.toString(), dailyLimitAtomic: agent.effectivePolicy.dailyLimitAtomic.toString(), hourlySpendAtomic: spend.hourly.toString(),
    hourlyLimitAtomic: agent.effectivePolicy.hourlyLimitAtomic?.toString(), monthlySpendAtomic: spend.monthly.toString(), monthlyLimitAtomic: agent.effectivePolicy.monthlyLimitAtomic?.toString(),
    transactionsLastHour: spend.transactionsLastHour, maxTransactionsPerHour: agent.effectivePolicy.maxTransactionsPerHour, lastTransactionAt: spend.lastTransactionAt, cooldownSeconds: agent.effectivePolicy.cooldownSeconds,
    overLimitAction: agent.effectivePolicy.overLimitAction,
  });
  const catalyst = await loadCatalystPolicyContext(agent.effectivePolicy.id);
  let oracleValuation: Awaited<ReturnType<typeof valueWithPyth>> | null = null;
  let decision = base;
  if (catalyst.oracle) {
    oracleValuation = await valueWithPyth({ oracle: catalyst.oracle, assetSymbol: agent.effectivePolicy.asset.symbol, assetDecimals: agent.effectivePolicy.asset.decimals, amountAtomic: price.amount });
    const usd = evaluateUsdPolicy({ requestedUsdMicros: oracleValuation.usdMicros, spend: await usdSpend(agent.id, now), limits: catalyst.oracle, overLimitAction: agent.effectivePolicy.overLimitAction });
    decision = { ...combinePolicyOutcomes(base, usd), projectedSpendAtomic: base.projectedSpendAtomic };
  }

  const intentId = randomUUID(), quoteId = randomUUID(), escrowId = randomUUID();
  const validUntil = new Date(now.getTime() + 15 * 60_000);
  const created = await db.$transaction(async (tx) => {
    const currentOrg = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId }, select: { status: true, killSwitchEnabled: true } });
    if (currentOrg.status !== "ACTIVE" || currentOrg.killSwitchEnabled) throw new Error(currentOrg.killSwitchEnabled ? "ORGANIZATION_KILL_SWITCH_ENABLED" : "ORGANIZATION_NOT_ACTIVE");
    const intent = await tx.paymentIntent.create({ data: { id: intentId, organizationId: input.organizationId, agentId: input.agentId, idempotencyKey: input.idempotencyKey, requestHash, resourceUrl: resource.endpoint, merchantHost: new URL(resource.endpoint).hostname, purpose: input.purpose, status: decision.decision === "DENY" ? "DENIED" : decision.decision === "REQUIRE_APPROVAL" ? "APPROVAL_PENDING" : "AUTHORIZED" } });
    await tx.paymentQuote.create({ data: { id: quoteId, paymentIntentId: intent.id, x402Version: 2, scheme: "masumi-escrow", network: agent.network, resourceDescription: resource.description, payToAccountId: entry.sellerWallet.address, assetId: agent.effectivePolicy!.assetId, amountAtomic: price.amount, validUntil, fingerprint: hash({ scheme: "masumi-escrow", network: agent.network, seller: entry.sellerWallet.address, amount: price.amount, unit: price.unit, resource: resource.endpoint, agentIdentifier: entry.agentIdentifier }), rawChallenge: { settlement: "masumi-escrow", agentIdentifier: entry.agentIdentifier, sellerVkey: entry.sellerWallet.vkey, unit: price.unit, reputation, keri } } });
    await tx.policyDecision.create({ data: { paymentIntentId: intent.id, policyVersionId: agent.effectivePolicy!.id, outcome: decision.decision, reasonCodes: decision.reasonCodes, factsHash: hash({ decision, reputation, keri, oracle: oracleValuation?.observation ?? null }), spendBeforeAtomic: spend.settledToday.toString(), reservedBeforeAtomic: spend.reservedToday.toString(), projectedAtomic: base.projectedSpendAtomic } });
    let reservationId: string | null = null;
    if (decision.decision !== "DENY") {
      const reservation = await tx.spendReservation.create({ data: { paymentIntentId: intent.id, agentId: agent.id, assetId: agent.effectivePolicy!.assetId, amountAtomic: price.amount, windowStart: dayStart(now), windowEnd: new Date(dayStart(now).getTime() + 24 * 60 * 60_000), status: "ACTIVE", expiresAt: validUntil } });
      reservationId = reservation.id;
      if (oracleValuation) await tx.$executeRaw`INSERT INTO "UsdSpendReservationSnapshot" ("spendReservationId","usdMicros","feedId","price","confidence","exponent","publishTime") VALUES (${reservation.id}::uuid, ${oracleValuation.usdMicros}, ${oracleValuation.observation.feedId}, ${oracleValuation.observation.price}, ${oracleValuation.observation.confidence}, ${oracleValuation.observation.exponent}, ${new Date(oracleValuation.observation.publishTime * 1000)})`;
    }
    if (decision.decision === "REQUIRE_APPROVAL") await tx.approvalRequest.create({ data: { paymentIntentId: intent.id, requestPurpose: input.purpose, expiresAt: validUntil, requiredApprovals: agent.effectivePolicy!.approvalThreshold, requiredRejections: agent.effectivePolicy!.rejectionThreshold } });
    await tx.$executeRaw`INSERT INTO "MasumiEscrowPurchase" ("id","organizationId","agentId","resourceListingId","paymentIntentId","idempotencyKey","requestHash","network","agentIdentifier","jobId","blockchainIdentifier","identifierFromPurchaser","sellerAddress","sellerPaymentKeyHash","paymentType","inputHash","inputEncrypted","state","amounts","providerEvidence") VALUES (${escrowId}::uuid,${input.organizationId}::uuid,${input.agentId}::uuid,${resource.id}::uuid,${intent.id}::uuid,${input.idempotencyKey},${requestHash},${network},${entry.agentIdentifier},'pending','pending','pending',${entry.sellerWallet.address},${entry.sellerWallet.vkey.toLowerCase()},${entry.paymentType ?? "Web3CardanoV1"},${masumiInputHash(input.inputData)},${encryptSecret(JSON.stringify(input.inputData))},'PREPARED',${JSON.stringify([{ amount: price.amount, unit: price.unit }])}::jsonb,${JSON.stringify({ reservationId, reputation, keri, oracle: oracleValuation?.observation ?? null })}::jsonb)`;
    if (input.initiatedByUserId) await tx.auditEvent.create({ data: { organizationId: input.organizationId, actorType: "USER", actorId: input.initiatedByUserId, action: "PAYMENT_REQUEST_INITIATED", targetType: "PAYMENT_INTENT", targetId: intent.id, result: decision.decision === "DENY" ? "DENIED" : "SUCCESS", metadata: { scheme: "masumi-escrow", resourceListingId: resource.id, agentIdentifier: entry.agentIdentifier } } });
    return intent;
  }, { isolationLevel: "Serializable" });
  return decision.decision === "ALLOW" ? executeAuthorizedMasumiIntent(created.id) : db.paymentIntent.findUniqueOrThrow({ where: { id: created.id }, include: { quote: { include: { asset: true } }, approval: true } });
}

export async function executeAuthorizedMasumiIntent(paymentIntentId: string) {
  const intent = await db.paymentIntent.findUniqueOrThrow({ where: { id: paymentIntentId }, include: { quote: { include: { asset: true } }, reservation: true, approval: true, organization: true, agent: { include: { effectivePolicy: true } } } });
  if (intent.quote?.scheme !== "masumi-escrow") throw new Error("MASUMI_ESCROW_QUOTE_REQUIRED");
  if (intent.status !== "AUTHORIZED") throw new Error("PAYMENT_NOT_AUTHORIZED");
  if (intent.organization.status !== "ACTIVE" || intent.organization.killSwitchEnabled) throw new Error(intent.organization.killSwitchEnabled ? "ORGANIZATION_KILL_SWITCH_ENABLED" : "ORGANIZATION_NOT_ACTIVE");
  if (!intent.reservation || intent.reservation.status !== "ACTIVE" || intent.reservation.expiresAt <= new Date()) throw new Error("SPEND_RESERVATION_INVALID");
  if (intent.approval && intent.approval.status !== "CONSUMED") throw new Error("APPROVAL_NOT_CONSUMED");
  if (!intent.agent.effectivePolicy || intent.agent.effectivePolicyId !== intent.agent.effectivePolicy.id) throw new Error("POLICY_CHANGED");
  const escrow = await escrowRowForIntent(intent.id); if (!escrow) throw new Error("MASUMI_ESCROW_RECORD_MISSING");
  const entry = await fetchMasumiAgent(escrow.agentIdentifier, escrow.network);
  assertMasumiEntryMatches(entry, { network: escrow.network, agentIdentifier: escrow.agentIdentifier, resourceUrl: intent.resourceUrl });
  await assertReputation(intent.agent.effectivePolicy.id, entry.agentIdentifier, escrow.network);
  if (escrow.resourceListingId) await assertKeriResourceTrust(intent.agent.effectivePolicy.id, escrow.resourceListingId, entry.agentIdentifier);
  const inputData = JSON.parse(decryptSecret(escrow.inputEncrypted));
  if (masumiInputHash(inputData) !== escrow.inputHash) throw new Error("MASUMI_ENCRYPTED_INPUT_HASH_MISMATCH");
  const job = await startMasumiJob(entry, inputData);
  const amounts = z.array(z.object({ amount: z.string().regex(/^\d+$/), unit: z.string() })).parse(escrow.amounts);
  const claimed = await db.paymentIntent.updateMany({ where: { id: intent.id, status: "AUTHORIZED" }, data: { status: "SIGNING" } });
  if (claimed.count !== 1) throw new Error("PAYMENT_ALREADY_CLAIMED");
  await db.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "jobId"=${job.id},"blockchainIdentifier"=${job.blockchainIdentifier},"identifierFromPurchaser"=${job.identifierFromPurchaser},"inputHash"=${job.input_hash.toLowerCase()},"updatedAt"=now() WHERE "id"=${escrow.id}::uuid`;
  const attempt = await db.paymentAttempt.create({ data: { paymentIntentId: intent.id, attemptNumber: (await db.paymentAttempt.count({ where: { paymentIntentId: intent.id } })) + 1, status: "STARTED", facilitatorRequestId: `masumi:${escrow.id}` } });
  try {
    const purchase = await createMasumiPurchase({ network: escrow.network, entry, job, inputData, amounts, metadata: JSON.stringify({ agentPayPaymentIntentId: intent.id }) });
    await db.$transaction(async (tx) => {
      await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "SUBMITTED", candidateTransactionId: purchase.id } });
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { status: "SUBMITTED" } });
      await tx.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "masumiPurchaseId"=${purchase.id},"state"=${purchase.NextAction.requestedAction},"providerState"=${purchase.NextAction.requestedAction},"providerEvidence"=${JSON.stringify(purchase)}::jsonb,"lastReconciledAt"=now(),"updatedAt"=now() WHERE "id"=${escrow.id}::uuid`;
      await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "MASUMI_ESCROW_SUBMITTED", aggregateType: "PAYMENT_INTENT", aggregateId: intent.id, payload: { blockchainIdentifier: job.blockchainIdentifier, masumiPurchaseId: purchase.id, network: escrow.network } } });
    });
    return reconcileMasumiEscrowPurchase(escrow.id);
  } catch (error) {
    const ambiguous = Boolean(error && typeof error === "object" && "ambiguous" in error && (error as { ambiguous?: boolean }).ambiguous);
    if (ambiguous || (error instanceof Error && error.message === "MASUMI_PURCHASE_SUBMISSION_UNKNOWN")) {
      await db.$transaction([db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "UNKNOWN", errorCode: "MASUMI_PURCHASE_SUBMISSION_UNKNOWN", candidateTransactionId: job.blockchainIdentifier } }), db.paymentIntent.update({ where: { id: intent.id }, data: { status: "SUBMISSION_UNKNOWN" } })]);
      await db.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "state"='SUBMISSION_UNKNOWN',"failureCode"='MASUMI_PURCHASE_SUBMISSION_UNKNOWN',"updatedAt"=now() WHERE "id"=${escrow.id}::uuid`;
      return { paymentIntentId: intent.id, escrowPurchaseId: escrow.id, state: "SUBMISSION_UNKNOWN", blockchainIdentifier: job.blockchainIdentifier };
    }
    await db.$transaction([db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", errorCode: error instanceof Error ? error.message.slice(0, 120) : "MASUMI_PURCHASE_FAILED" } }), db.paymentIntent.update({ where: { id: intent.id }, data: { status: "FAILED_BEFORE_SUBMISSION" } }), db.spendReservation.updateMany({ where: { paymentIntentId: intent.id, status: "ACTIVE" }, data: { status: "RELEASED" } })]);
    await db.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "state"='FAILED',"failureCode"=${error instanceof Error ? error.message.slice(0, 120) : "MASUMI_PURCHASE_FAILED"},"updatedAt"=now() WHERE "id"=${escrow.id}::uuid`;
    throw error;
  }
}

export async function reconcileMasumiEscrowPurchase(escrowPurchaseId: string) {
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "MasumiEscrowPurchase" WHERE "id"=${escrowPurchaseId}::uuid LIMIT 1`;
  const escrow = rows[0] ? escrowRowSchema.parse(rows[0]) : null; if (!escrow) throw new Error("MASUMI_ESCROW_NOT_FOUND");
  if (escrow.state === "PREPARED") return escrow;
  const purchase = await findMasumiPurchase(escrow.network, escrow.blockchainIdentifier);
  if (!purchase) return { ...escrow, reconciliation: "PENDING_PROVIDER_EVIDENCE" };
  const state = purchase.NextAction.requestedAction;
  const allowed = new Set(["FundsLockingRequested","FundsLocked","ResultSubmitted","Completed","RefundRequested","RefundAuthorized","Disputed"]);
  if (!allowed.has(state)) throw new Error("MASUMI_ESCROW_STATE_UNKNOWN");
  let resultVerifiedAt: Date | null = escrow.resultVerifiedAt, resultHash: string | null = escrow.resultHash;
  if (state === "ResultSubmitted" || state === "Completed") {
    const entry = await fetchMasumiAgent(escrow.agentIdentifier, escrow.network);
    const jobStatus = await fetchMasumiJobStatus(entry, escrow.jobId);
    const verified = verifyMasumiResultHash(purchase, jobStatus);
    resultVerifiedAt = new Date(); resultHash = verified.resultHash;
  }
  await db.$transaction(async (tx) => {
    const terminal = state === "Completed" || state === "RefundAuthorized" || state === "Disputed";
    await tx.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "masumiPurchaseId"=${purchase.id},"state"=${state},"providerState"=${state},"resultHash"=${resultHash},"resultVerifiedAt"=${resultVerifiedAt},"refundRequestedAt"=CASE WHEN ${state}='RefundRequested' AND "refundRequestedAt" IS NULL THEN now() ELSE "refundRequestedAt" END,"refundAuthorizedAt"=CASE WHEN ${state}='RefundAuthorized' AND "refundAuthorizedAt" IS NULL THEN now() ELSE "refundAuthorizedAt" END,"disputedAt"=CASE WHEN ${state}='Disputed' AND "disputedAt" IS NULL THEN now() ELSE "disputedAt" END,"completedAt"=CASE WHEN ${state}='Completed' AND "completedAt" IS NULL THEN now() ELSE "completedAt" END,"providerEvidence"=${JSON.stringify(purchase)}::jsonb,"lastReconciledAt"=now(),"failureCode"=NULL,"updatedAt"=now() WHERE "id"=${escrow.id}::uuid`;
    if (escrow.paymentIntentId) {
      if (state === "Completed" && resultVerifiedAt) {
        await tx.paymentIntent.updateMany({ where: { id: escrow.paymentIntentId, status: { in: ["SUBMITTED", "SUBMISSION_UNKNOWN", "SIGNING"] } }, data: { status: "SETTLED" } });
        await tx.spendReservation.updateMany({ where: { paymentIntentId: escrow.paymentIntentId, status: { in: ["ACTIVE", "CONSUMED"] } }, data: { status: "SETTLED" } });
        const attempt = await tx.paymentAttempt.findFirst({ where: { paymentIntentId: escrow.paymentIntentId }, orderBy: { attemptNumber: "desc" } });
        if (attempt) await tx.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "CONFIRMED", candidateTransactionId: purchase.id } });
      } else if ((state === "RefundAuthorized" || state === "Disputed") && terminal) {
        await tx.paymentIntent.updateMany({ where: { id: escrow.paymentIntentId, status: { notIn: ["SETTLED", "CANCELED"] } }, data: { status: "SETTLEMENT_FAILED" } });
        await tx.spendReservation.updateMany({ where: { paymentIntentId: escrow.paymentIntentId, status: "ACTIVE" }, data: { status: "CONSUMED" } });
      }
    }
  });
  if ((state === "Completed" || state === "RefundAuthorized") && escrow.inputEncrypted) await db.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "inputEncrypted"='',"inputPurgedAt"=now(),"updatedAt"=now() WHERE "id"=${escrow.id}::uuid AND "inputPurgedAt" IS NULL`;
  return { escrowPurchaseId: escrow.id, paymentIntentId: escrow.paymentIntentId, state, blockchainIdentifier: escrow.blockchainIdentifier, resultHash, resultVerified: Boolean(resultVerifiedAt), purchase };
}

export async function requestEscrowRefund(escrowPurchaseId: string, organizationId: string) {
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM "MasumiEscrowPurchase" WHERE "id"=${escrowPurchaseId}::uuid AND "organizationId"=${organizationId}::uuid LIMIT 1`;
  const escrow = rows[0] ? escrowRowSchema.parse(rows[0]) : null; if (!escrow) throw new Error("MASUMI_ESCROW_NOT_FOUND");
  if (!["ResultSubmitted", "FundsLocked"].includes(escrow.state)) throw new Error("MASUMI_REFUND_NOT_AVAILABLE");
  const purchase = await requestMasumiRefund(escrow.network, escrow.blockchainIdentifier);
  await db.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "state"=${purchase.NextAction.requestedAction},"providerState"=${purchase.NextAction.requestedAction},"refundRequestedAt"=now(),"providerEvidence"=${JSON.stringify(purchase)}::jsonb,"updatedAt"=now() WHERE "id"=${escrow.id}::uuid`;
  return reconcileMasumiEscrowPurchase(escrow.id);
}

export async function authorizeEscrowRefund(escrowPurchaseId: string, organizationId: string) {
  const rows = await db.$queryRaw<Array<Record<string, unknown>>>`SELECT p.* FROM "MasumiEscrowPurchase" p JOIN "ResourceListing" r ON r."id"=p."resourceListingId" JOIN "ResourceProvider" rp ON rp."id"=r."providerId" WHERE p."id"=${escrowPurchaseId}::uuid AND rp."organizationId"=${organizationId}::uuid LIMIT 1`;
  const escrow = rows[0] ? escrowRowSchema.parse(rows[0]) : null; if (!escrow) throw new Error("MASUMI_ESCROW_SELLER_NOT_AUTHORIZED");
  if (escrow.state !== "RefundRequested") throw new Error("MASUMI_REFUND_NOT_REQUESTED");
  const purchase = await authorizeMasumiRefund(escrow.network, escrow.blockchainIdentifier);
  await db.$executeRaw`UPDATE "MasumiEscrowPurchase" SET "state"=${purchase.NextAction.requestedAction},"providerState"=${purchase.NextAction.requestedAction},"refundAuthorizedAt"=now(),"providerEvidence"=${JSON.stringify(purchase)}::jsonb,"updatedAt"=now() WHERE "id"=${escrow.id}::uuid`;
  return reconcileMasumiEscrowPurchase(escrow.id);
}

export async function reconcilePendingMasumiEscrows(limit = 25) {
  const rows = await db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "MasumiEscrowPurchase" WHERE "state" IN ('SUBMISSION_UNKNOWN','FundsLockingRequested','FundsLocked','ResultSubmitted','RefundRequested') ORDER BY "updatedAt" ASC LIMIT ${Math.max(1, Math.min(limit, 100))}`;
  const results = [];
  for (const row of rows) { try { results.push(await reconcileMasumiEscrowPurchase(row.id)); } catch (error) { results.push({ escrowPurchaseId: row.id, state: "ERROR", error: error instanceof Error ? error.message : "UNKNOWN" }); } }
  return results;
}
