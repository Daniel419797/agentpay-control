import { Prisma } from "@/generated/prisma/client";
import { getCardProvider } from "@/domain/card-provider";
import { db } from "@/lib/db";

const EXPIRABLE_INTENT_STATUSES = ["CREATED", "QUOTED", "APPROVAL_PENDING", "AUTHORIZED"] as const;

async function expireIntent(intentId: string, reason: string, now: Date) {
  return db.$transaction(async (tx) => {
    const changed = await tx.paymentIntent.updateMany({ where: { id: intentId, status: { in: [...EXPIRABLE_INTENT_STATUSES] } }, data: { status: "EXPIRED" } });
    if (changed.count !== 1) return false;
    await tx.spendReservation.updateMany({ where: { paymentIntentId: intentId, status: "ACTIVE" }, data: { status: "EXPIRED" } });
    await tx.approvalRequest.updateMany({ where: { paymentIntentId: intentId, status: "PENDING" }, data: { status: "EXPIRED", decidedAt: now, decisionNote: reason } });
    const intent = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId }, select: { organizationId: true } });
    await tx.outboxEvent.create({ data: { organizationId: intent.organizationId, eventType: "PAYMENT_EXPIRED", aggregateType: "PAYMENT_INTENT", aggregateId: intentId, payload: { reason, expiredAt: now.toISOString() } } });
    return true;
  });
}

export async function runPaymentMaintenance(limit = 100, now = new Date()) {
  const [expiredQuotes, expiredApprovals, expiredReservations] = await Promise.all([
    db.paymentQuote.findMany({ where: { validUntil: { lte: now }, paymentIntent: { status: { in: [...EXPIRABLE_INTENT_STATUSES] } } }, select: { paymentIntentId: true }, take: limit }),
    db.approvalRequest.findMany({ where: { status: "PENDING", expiresAt: { lte: now } }, select: { paymentIntentId: true }, take: limit }),
    db.spendReservation.findMany({ where: { status: "ACTIVE", expiresAt: { lte: now } }, select: { paymentIntentId: true }, take: limit }),
  ]);
  const candidates = new Map<string, string>();
  for (const row of expiredQuotes) candidates.set(row.paymentIntentId, "QUOTE_EXPIRED");
  for (const row of expiredApprovals) candidates.set(row.paymentIntentId, "APPROVAL_EXPIRED");
  for (const row of expiredReservations) candidates.set(row.paymentIntentId, "RESERVATION_EXPIRED");
  let expiredIntents = 0;
  for (const [intentId, reason] of candidates) if (await expireIntent(intentId, reason, now)) expiredIntents += 1;
  const deletedRateLimitBuckets = await db.rateLimitBucket.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  const deletedWalletChallenges = await db.walletAuthChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  return { scanned: candidates.size, expiredIntents, deletedRateLimitBuckets: deletedRateLimitBuckets.count, deletedWalletChallenges: deletedWalletChallenges.count };
}

type IncidentCandidate = { organizationId: string; sourceType: string; sourceId: string; title: string; description: string };

async function ensureOperationalIncident(candidate: IncidentCandidate) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`incident:${candidate.sourceType}:${candidate.sourceId}`}, 0))`;
    const existing = await tx.supportCase.findUnique({ where: { organizationId_sourceType_sourceId: { organizationId: candidate.organizationId, sourceType: candidate.sourceType, sourceId: candidate.sourceId } }, select: { id: true } });
    if (existing) return false;
    const incident = await tx.supportCase.create({ data: { organizationId: candidate.organizationId, createdBy: null, sourceType: candidate.sourceType, sourceId: candidate.sourceId, title: candidate.title, description: candidate.description, category: "RECONCILIATION_INCIDENT", severity: "URGENT" } });
    await tx.auditEvent.create({ data: { organizationId: candidate.organizationId, actorType: "SYSTEM", action: "RECONCILIATION_INCIDENT_OPENED", targetType: "SUPPORT_CASE", targetId: incident.id, result: "SUCCESS", metadata: { sourceType: candidate.sourceType, sourceId: candidate.sourceId } } });
    await tx.outboxEvent.create({ data: { organizationId: candidate.organizationId, eventType: "RECONCILIATION_INCIDENT_OPENED", aggregateType: candidate.sourceType, aggregateId: candidate.sourceId, payload: { supportCaseId: incident.id, title: candidate.title, severity: "URGENT" } } });
    return true;
  });
}

export async function openUnresolvedSubmissionIncidents(limit = 100, now = new Date(), thresholdMs = 15 * 60_000) {
  const cutoff = new Date(now.getTime() - thresholdMs);
  const [payments, fiatTransfers, crossChainTransfers, automations] = await Promise.all([
    db.paymentIntent.findMany({ where: { status: "SUBMISSION_UNKNOWN", updatedAt: { lte: cutoff } }, select: { id: true, organizationId: true }, take: limit }),
    db.fiatTransfer.findMany({ where: { status: "SUBMISSION_UNKNOWN", updatedAt: { lte: cutoff } }, select: { id: true, organizationId: true }, take: limit }),
    db.crossChainTransfer.findMany({ where: { status: { in: ["SUBMITTED", "BRIDGING"] }, updatedAt: { lte: cutoff } }, select: { id: true, organizationId: true, status: true }, take: limit }),
    db.automationExecution.findMany({ where: { status: "SUBMISSION_UNKNOWN", updatedAt: { lte: cutoff } }, select: { id: true, organizationId: true }, take: limit }),
  ]);
  const candidates: IncidentCandidate[] = [
    ...payments.map((row) => ({ organizationId: row.organizationId, sourceType: "PAYMENT_INTENT", sourceId: row.id, title: "Payment submission remains unresolved", description: "An x402 payment submission could not be confirmed or rejected within the operational reconciliation threshold." })),
    ...fiatTransfers.map((row) => ({ organizationId: row.organizationId, sourceType: "FIAT_TRANSFER", sourceId: row.id, title: "Fiat transfer submission remains unresolved", description: "The fiat provider has not supplied a terminal transfer outcome within the operational reconciliation threshold." })),
    ...crossChainTransfers.map((row) => ({ organizationId: row.organizationId, sourceType: "CROSS_CHAIN_TRANSFER", sourceId: row.id, title: "Cross-chain transfer remains unresolved", description: `The cross-chain transfer remains ${row.status.toLowerCase()} beyond the operational reconciliation threshold.` })),
    ...automations.map((row) => ({ organizationId: row.organizationId, sourceType: "AUTOMATION_EXECUTION", sourceId: row.id, title: "Contract automation submission remains unresolved", description: "A contract execution submission could not be confirmed or rejected within the operational reconciliation threshold." })),
  ];
  let opened = 0;
  for (const candidate of candidates.slice(0, limit)) if (await ensureOperationalIncident(candidate)) opened += 1;
  return { scanned: candidates.length, opened };
}

export async function runRetentionMaintenance(now = new Date()) {
  const policies = await db.dataRetentionPolicy.findMany();
  let redactedFulfillments = 0;
  let deletedNotificationDeliveries = 0;
  for (const policy of policies) {
    const fulfillmentCutoff = new Date(now.getTime() - policy.fulfillmentBodyDays * 86_400_000);
    const notificationCutoff = new Date(now.getTime() - policy.notificationDays * 86_400_000);
    redactedFulfillments += (await db.resourceFulfillment.updateMany({ where: { paymentIntent: { organizationId: policy.organizationId }, fulfilledAt: { lt: fulfillmentCutoff }, responseBody: { not: Prisma.DbNull } }, data: { responseBody: Prisma.DbNull } })).count;
    deletedNotificationDeliveries += (await db.notificationDelivery.deleteMany({ where: { outboxEvent: { organizationId: policy.organizationId }, status: { in: ["DELIVERED", "DEAD_LETTER"] }, updatedAt: { lt: notificationCutoff } } })).count;
  }
  return { organizations: policies.length, redactedFulfillments, deletedAuditEvents: 0, auditEventsRetainedForChainIntegrity: true, deletedNotificationDeliveries };
}

type DeletionCard = { id: string; provider: "SANDBOX" | "STRIPE"; externalCardId: string };

async function prepareDeletionRequest(requestId: string, now: Date) {
  let cards: DeletionCard[] = [];
  const prepared = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deletion-finalize:${requestId}`}, 0))`;
    const request = await tx.deletionRequest.findUnique({ where: { id: requestId } });
    if (!request || !["REQUESTED", "PROCESSING"].includes(request.status) || request.scheduledFor > now) return false;
    if (request.status === "REQUESTED") await tx.deletionRequest.update({ where: { id: request.id }, data: { status: "PROCESSING" } });

    await tx.organization.update({ where: { id: request.organizationId }, data: { status: "SUSPENDED", killSwitchEnabled: true } });
    await tx.agent.updateMany({ where: { organizationId: request.organizationId, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED" } });
    await tx.agentCredential.updateMany({ where: { agent: { organizationId: request.organizationId }, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: now } });
    cards = await tx.virtualCard.findMany({ where: { organizationId: request.organizationId, status: { not: "CANCELED" } }, select: { id: true, provider: true, externalCardId: true } });
    if (cards.length) await tx.virtualCard.updateMany({ where: { id: { in: cards.map((card) => card.id) }, status: { not: "CANCELED" } }, data: { status: "FROZEN", version: { increment: 1 } } });
    await tx.automationRule.updateMany({ where: { organizationId: request.organizationId, status: { in: ["DRAFT", "ACTIVE", "PAUSED"] } }, data: { status: "ARCHIVED", version: { increment: 1 }, nextRunAt: null } });
    await tx.automationExecution.updateMany({ where: { organizationId: request.organizationId, status: { in: ["PENDING", "AWAITING_APPROVAL"] } }, data: { status: "CANCELED", completedAt: now, errorCode: "ORGANIZATION_DELETED" } });
    await tx.crossChainRouteQuote.updateMany({ where: { organizationId: request.organizationId, status: "ACTIVE" }, data: { status: "CANCELED" } });
    // Already exported self-custody transactions are intentionally not marked safe/canceled here.
    // Evidence ingestion/reconciliation must remain available if the external wallet broadcasts later.
    await tx.agentInvoice.updateMany({ where: { issuerOrganizationId: request.organizationId, status: { in: ["DRAFT", "SENT", "VIEWED", "APPROVAL_PENDING", "PAYMENT_PENDING", "OVERDUE"] } }, data: { status: "VOID", voidedAt: now } });
    await tx.fiatAccount.updateMany({ where: { organizationId: request.organizationId, status: { in: ["PENDING", "ACTIVE"] } }, data: { status: "RESTRICTED" } });
    await tx.notificationEndpoint.updateMany({ where: { organizationId: request.organizationId }, data: { status: "PAUSED" } });
    await tx.membership.updateMany({ where: { organizationId: request.organizationId }, data: { status: "SUSPENDED", suspendedAt: now } });
    return true;
  }, { isolationLevel: "Serializable" });
  return prepared ? cards : null;
}

async function recordDeletionProviderFailure(request: { id: string; organizationId: string }, failedCards: number, reason: string) {
  await db.$transaction(async (tx) => {
    await tx.auditEvent.create({ data: { organizationId: request.organizationId, actorType: "SYSTEM", action: "DELETION_CARD_PROVIDER_SYNC_FAILED", targetType: "DELETION_REQUEST", targetId: request.id, result: "FAILURE", metadata: { failedCards, reason } } });
    await tx.supportCase.upsert({
      where: { organizationId_sourceType_sourceId: { organizationId: request.organizationId, sourceType: "DELETION_REQUEST", sourceId: request.id } },
      create: { organizationId: request.organizationId, createdBy: null, sourceType: "DELETION_REQUEST", sourceId: request.id, title: "Workspace deletion waiting on card-provider termination", description: `AgentPay locally suspended the workspace, but ${failedCards} external card termination operation(s) remain unresolved. Reason: ${reason}.`, category: "DELETION_PROVIDER_SYNC", severity: "URGENT" },
      update: { status: "OPEN", severity: "URGENT", description: `AgentPay locally suspended the workspace, but ${failedCards} external card termination operation(s) remain unresolved. Reason: ${reason}.` },
    });
  });
}

async function completeDeletionRequest(requestId: string, now: Date) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`deletion-finalize:${requestId}`}, 0))`;
    const request = await tx.deletionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.status !== "PROCESSING") return false;
    const memberships = await tx.membership.findMany({ where: { organizationId: request.organizationId }, select: { userId: true } });
    await tx.virtualCard.updateMany({ where: { organizationId: request.organizationId, status: { not: "CANCELED" } }, data: { status: "CANCELED", version: { increment: 1 } } });
    for (const membership of memberships) {
      const otherMemberships = await tx.membership.count({ where: { userId: membership.userId, organizationId: { not: request.organizationId }, status: { in: ["ACTIVE", "INVITED"] } } });
      if (otherMemberships === 0) {
        await tx.walletIdentity.deleteMany({ where: { userId: membership.userId } });
        await tx.user.update({ where: { id: membership.userId }, data: { email: null, displayName: `Deleted user ${membership.userId.slice(0, 8)}` } });
      }
    }
    await tx.auditEvent.create({ data: { organizationId: request.organizationId, actorType: "SYSTEM", actorId: null, action: "ORGANIZATION_DELETION_COMPLETED", targetType: "ORGANIZATION", targetId: request.organizationId, result: "SUCCESS", metadata: { retainedFinancialRecords: true, providerCardsTerminated: true } } });
    await tx.deletionRequest.update({ where: { id: request.id }, data: { status: "COMPLETED", completedAt: now } });
    await tx.supportCase.updateMany({ where: { organizationId: request.organizationId, sourceType: "DELETION_REQUEST", sourceId: request.id, status: { in: ["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER"] } }, data: { status: "RESOLVED", resolvedAt: now } });
    return true;
  }, { isolationLevel: "Serializable" });
}

export async function finalizeDeletionRequests(limit = 10, now = new Date()) {
  const requests = await db.deletionRequest.findMany({ where: { status: { in: ["REQUESTED", "PROCESSING"] }, scheduledFor: { lte: now } }, orderBy: { scheduledFor: "asc" }, take: limit });
  const completed: string[] = [];
  for (const request of requests) {
    const cards = await prepareDeletionRequest(request.id, now);
    if (cards === null) continue;

    const stripeCards = cards.filter((card) => card.provider === "STRIPE");
    if (stripeCards.length) {
      const provider = getCardProvider();
      if (provider.name !== "STRIPE") {
        await recordDeletionProviderFailure(request, stripeCards.length, "STRIPE_PROVIDER_NOT_CONFIGURED");
        continue;
      }
      const results = await Promise.allSettled(stripeCards.map((card) => provider.updateCardStatus(card.externalCardId, "CANCELED", `org-delete:${request.id}:${card.id}`)));
      const failures = results.filter((result) => result.status === "rejected").length;
      if (failures) {
        await recordDeletionProviderFailure(request, failures, "STRIPE_CARD_CANCELLATION_FAILED");
        continue;
      }
    }

    if (await completeDeletionRequest(request.id, now)) completed.push(request.id);
  }
  return { scanned: requests.length, completed };
}
