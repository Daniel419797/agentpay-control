import { createHash } from "node:crypto";

import { evaluateCardAuthorization, spendingWindow } from "@/domain/card-authorization-service";
import {
  cancelLeasedPurchase,
  createCardPurchaseRecord,
  findPurchaseByIdempotency,
  getCardAutonomyPolicy,
  getCardPurchase,
  getCardPurchaseByPaymentIntent,
  listAgentCardPurchases,
  markPurchaseReadyAfterApproval,
  rejectCardPurchaseByPaymentIntent,
  sumReservedCardPurchases,
  type CardAutonomyPolicy,
  type CardPurchaseRecord,
} from "@/domain/card-autonomy-repository";
import { checkoutPlanSchema, hostMatchesPattern, planSummary, type CheckoutPlan } from "@/lib/card-checkout-plan";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { assertSafeResourceUrl } from "@/lib/safe-url";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";

export type CardAutonomyOutcome = "ALLOW" | "DENY" | "REQUIRE_APPROVAL";

export type CreateCardPurchaseInput = {
  virtualCardId?: string;
  merchantUrl: string;
  amountMinor: string;
  currency: string;
  merchantCategory?: string;
  merchantCountry?: string;
  purpose?: string;
  checkoutPlan: unknown;
};

export function evaluateCardAutonomy(input: {
  policy: CardAutonomyPolicy | null;
  merchantHost: string;
  amountMinor: bigint;
  purpose?: string;
  cardApproved: boolean;
  cardReasons: string[];
}) {
  const reasons: string[] = [];
  const policy = input.policy;
  if (!input.cardApproved) reasons.push(...input.cardReasons);
  if (!policy || policy.mode === "DISABLED") reasons.push("CARD_AUTONOMY_DISABLED");
  if (!policy) return { outcome: "DENY" as const, reasonCodes: [...new Set(reasons)] };

  const host = input.merchantHost.toLowerCase();
  if (policy.deniedHosts.some((pattern) => hostMatchesPattern(host, pattern))) reasons.push("MERCHANT_HOST_DENIED");
  if (policy.allowedHosts.length && !policy.allowedHosts.some((pattern) => hostMatchesPattern(host, pattern))) reasons.push("MERCHANT_HOST_NOT_ALLOWED");
  if (policy.mode === "MERCHANT_ALLOWLIST" && !policy.allowedHosts.length) reasons.push("MERCHANT_ALLOWLIST_EMPTY");
  if (policy.requirePurpose && !input.purpose?.trim()) reasons.push("PURPOSE_REQUIRED");

  if (reasons.length) return { outcome: "DENY" as const, reasonCodes: [...new Set(reasons)] };
  if (policy.mode === "APPROVAL_REQUIRED") return { outcome: "REQUIRE_APPROVAL" as const, reasonCodes: ["POLICY_REQUIRES_APPROVAL"] };
  if (policy.perPurchaseAutoLimitMinor !== null && input.amountMinor > BigInt(policy.perPurchaseAutoLimitMinor)) {
    return policy.overLimitAction === "REQUIRE_APPROVAL"
      ? { outcome: "REQUIRE_APPROVAL" as const, reasonCodes: ["AUTONOMOUS_PURCHASE_LIMIT_EXCEEDED"] }
      : { outcome: "DENY" as const, reasonCodes: ["AUTONOMOUS_PURCHASE_LIMIT_EXCEEDED"] };
  }
  return { outcome: "ALLOW" as const, reasonCodes: ["CARD_AUTONOMY_POLICY_ALLOWED"] };
}

function requestHash(input: {
  virtualCardId: string;
  merchantUrl: string;
  amountMinor: string;
  currency: string;
  merchantCategory?: string;
  merchantCountry?: string;
  purpose?: string;
  plan: CheckoutPlan;
}) {
  return createHash("sha256").update(JSON.stringify({
    virtualCardId: input.virtualCardId,
    merchantUrl: input.merchantUrl,
    amountMinor: input.amountMinor,
    currency: input.currency,
    merchantCategory: input.merchantCategory ?? null,
    merchantCountry: input.merchantCountry ?? null,
    purpose: input.purpose?.trim() || null,
    checkoutPlan: input.plan,
  })).digest("hex");
}

export function sanitizeCardPurchase(purchase: CardPurchaseRecord) {
  const { checkoutPlanEncrypted: _plan, merchantUrl: _url, leaseToken: _lease, ...safe } = purchase;
  void _plan; void _url; void _lease;
  return safe;
}

async function resolveCard(agentId: string, requestedCardId?: string, existingCardId?: string) {
  const where = requestedCardId ?? existingCardId;
  if (where) {
    const card = await db.virtualCard.findFirst({
      where: { id: where, agentId },
      include: { organization: { select: { status: true, killSwitchEnabled: true } }, agent: { select: { status: true } } },
    });
    if (!card) throw new Error("CARD_NOT_ASSIGNED_TO_AGENT");
    return card;
  }
  const cards = await db.virtualCard.findMany({
    where: { agentId, status: "ACTIVE" },
    include: { organization: { select: { status: true, killSwitchEnabled: true } }, agent: { select: { status: true } } },
    orderBy: { createdAt: "asc" }, take: 2,
  });
  if (cards.length === 0) throw new Error("ACTIVE_AGENT_CARD_NOT_FOUND");
  if (cards.length > 1) throw new Error("VIRTUAL_CARD_ID_REQUIRED");
  return cards[0]!;
}

async function currentCardAuthorizationFacts(card: Awaited<ReturnType<typeof resolveCard>>, amountMinor: bigint, merchantCategory?: string, merchantCountry?: string, excludePurchaseId?: string) {
  const now = new Date();
  const window = spendingWindow(card.spendingInterval, now);
  const prior = card.spendingInterval === "per_authorization" ? [] : await db.cardAuthorization.findMany({
    where: {
      virtualCardId: card.id,
      approved: true,
      status: { in: ["PENDING", "APPROVED", "CLOSED"] },
      requestedAt: { gte: window.start, lt: window.end },
    },
    select: { amountMinor: true },
  });
  const settledOrAuthorized = prior.reduce((sum, item) => sum + BigInt(item.amountMinor.toString()), 0n);
  const reserved = card.spendingInterval === "per_authorization" ? 0n : await sumReservedCardPurchases(card.id, excludePurchaseId);
  return evaluateCardAuthorization({
    cardStatus: card.status,
    organizationActive: card.organization.status === "ACTIVE",
    killSwitchEnabled: card.organization.killSwitchEnabled,
    cardCurrency: card.currency,
    amountMinor,
    spentMinor: settledOrAuthorized + reserved,
    spendingLimitMinor: card.spendingLimitMinor ? BigInt(card.spendingLimitMinor.toString()) : undefined,
    spendingInterval: card.spendingInterval ?? undefined,
    allowedCategories: card.allowedCategories,
    blockedCategories: card.blockedCategories,
    allowedCountries: card.allowedCountries,
    merchantCategory,
    merchantCountry,
  });
}

function assertCardOperational(card: Awaited<ReturnType<typeof resolveCard>>, currency: string) {
  if (card.organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
  if (card.organization.killSwitchEnabled) throw new Error("ORGANIZATION_KILL_SWITCH_ENABLED");
  if (card.agent.status !== "ACTIVE") throw new Error("AGENT_NOT_ACTIVE");
  if (card.status !== "ACTIVE") throw new Error("CARD_NOT_ACTIVE");
  if (card.currency.toUpperCase() !== currency.toUpperCase()) throw new Error("CARD_CURRENCY_MISMATCH");
}

function assertSuccessDestination(plan: CheckoutPlan, merchantHost: string, production: boolean) {
  if (!plan.successUrlPrefix) return;
  const success = new URL(plan.successUrlPrefix);
  if (production && success.protocol !== "https:") throw new Error("CHECKOUT_SUCCESS_URL_UNSAFE");
  const host = success.hostname.toLowerCase();
  if (host !== merchantHost && !host.endsWith(`.${merchantHost}`) && !merchantHost.endsWith(`.${host}`)) throw new Error("CHECKOUT_SUCCESS_HOST_MISMATCH");
}

export async function createAutonomousCardPurchase(agentId: string, idempotencyKey: string, raw: CreateCardPurchaseInput, options: { initiatedByUserId?: string } = {}) {
  const config = getConfig();
  if (!config.VIRTUAL_CARDS_ENABLED) throw new Error("VIRTUAL_CARDS_DISABLED");
  const production = config.APP_ENV === "production";
  const url = await assertSafeResourceUrl(raw.merchantUrl, production);
  const plan = checkoutPlanSchema.parse(raw.checkoutPlan);
  assertSuccessDestination(plan, url.hostname.toLowerCase(), production);
  const existing = await db.agent.findUnique({ where: { id: agentId }, select: { organizationId: true, status: true } });
  if (!existing || existing.status === "ARCHIVED") throw new Error("AGENT_NOT_FOUND");
  const previous = await findPurchaseByIdempotency(existing.organizationId, agentId, idempotencyKey);
  const card = await resolveCard(agentId, raw.virtualCardId, previous?.virtualCardId);
  const currency = raw.currency.toUpperCase();
  const amountMinor = BigInt(raw.amountMinor);
  if (amountMinor <= 0n) throw new Error("CARD_PURCHASE_AMOUNT_INVALID");
  assertCardOperational(card, currency);

  const hash = requestHash({ virtualCardId: card.id, merchantUrl: url.toString(), amountMinor: amountMinor.toString(), currency, merchantCategory: raw.merchantCategory, merchantCountry: raw.merchantCountry?.toUpperCase(), purpose: raw.purpose, plan });
  if (previous) {
    if (previous.requestHash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
    return { purchase: sanitizeCardPurchase(previous), approvalId: null, existing: true };
  }

  const policy = await getCardAutonomyPolicy(card.id);
  if (!policy || policy.organizationId !== card.organizationId || policy.agentId !== agentId) throw new Error("CARD_AUTONOMY_DISABLED");
  const cardDecision = await currentCardAuthorizationFacts(card, amountMinor, raw.merchantCategory, raw.merchantCountry?.toUpperCase());
  const decision = evaluateCardAutonomy({ policy, merchantHost: url.hostname, amountMinor, purpose: raw.purpose, cardApproved: cardDecision.approved, cardReasons: cardDecision.reasons });
  if (decision.outcome === "DENY") throw new Error(`CARD_PURCHASE_POLICY_DENIED:${decision.reasonCodes.join(",")}`);

  const created = await createCardPurchaseRecord({
    organizationId: card.organizationId,
    agentId,
    virtualCardId: card.id,
    idempotencyKey,
    requestHash: hash,
    merchantUrl: encryptSecret(url.toString()),
    merchantHost: url.hostname.toLowerCase(),
    amountMinor: amountMinor.toString(),
    currency,
    merchantCategory: raw.merchantCategory,
    merchantCountry: raw.merchantCountry?.toUpperCase(),
    purpose: raw.purpose?.trim() || undefined,
    checkoutPlanEncrypted: encryptSecret(JSON.stringify(plan)),
    policyVersion: policy.version,
    requiresApproval: decision.outcome === "REQUIRE_APPROVAL",
    initiatedByUserId: options.initiatedByUserId,
  });
  return { purchase: sanitizeCardPurchase(created.purchase), approvalId: created.approvalId, existing: created.existing, decision: { outcome: decision.outcome, reasonCodes: decision.reasonCodes }, card: { id: card.id, brand: card.brand, last4: card.last4 } };
}

export async function listAutonomousCardPurchases(agentId: string, limit = 50) {
  return (await listAgentCardPurchases(agentId, limit)).map(sanitizeCardPurchase);
}

export async function readAutonomousCardPurchase(purchaseId: string) {
  const purchase = await getCardPurchase(purchaseId);
  return purchase ? sanitizeCardPurchase(purchase) : null;
}

export async function resumeApprovedCardPurchase(paymentIntentId: string) {
  const purchase = await getCardPurchaseByPaymentIntent(paymentIntentId);
  if (!purchase) return null;
  if (purchase.status !== "APPROVAL_PENDING") return sanitizeCardPurchase(purchase);
  const card = await resolveCard(purchase.agentId, purchase.virtualCardId);
  assertCardOperational(card, purchase.currency);
  const policy = await getCardAutonomyPolicy(card.id);
  if (!policy || policy.mode === "DISABLED" || policy.version !== purchase.policyVersion) {
    await db.paymentIntent.updateMany({ where: { id: paymentIntentId, status: "AUTHORIZED" }, data: { status: "CANCELED" } });
    throw new Error("CARD_AUTONOMY_POLICY_CHANGED");
  }
  const cardDecision = await currentCardAuthorizationFacts(card, BigInt(purchase.amountMinor), purchase.merchantCategory ?? undefined, purchase.merchantCountry ?? undefined, purchase.id);
  const decision = evaluateCardAutonomy({ policy, merchantHost: purchase.merchantHost, amountMinor: BigInt(purchase.amountMinor), purpose: purchase.purpose ?? undefined, cardApproved: cardDecision.approved, cardReasons: cardDecision.reasons });
  if (decision.outcome === "DENY") {
    await db.paymentIntent.updateMany({ where: { id: paymentIntentId, status: "AUTHORIZED" }, data: { status: "CANCELED" } });
    throw new Error("CARD_PURCHASE_POLICY_CHANGED");
  }
  const ready = await markPurchaseReadyAfterApproval(paymentIntentId, purchase.policyVersion);
  if (!ready) throw new Error("CARD_PURCHASE_APPROVAL_STATE_INVALID");
  return sanitizeCardPurchase(ready);
}

export async function rejectAutonomousCardPurchase(paymentIntentId: string) {
  const purchase = await rejectCardPurchaseByPaymentIntent(paymentIntentId);
  return purchase ? sanitizeCardPurchase(purchase) : null;
}

export async function materializeLeasedCardPurchase(purchase: CardPurchaseRecord) {
  const config = getConfig();
  if (!config.VIRTUAL_CARDS_ENABLED) throw new Error("VIRTUAL_CARDS_DISABLED");
  const card = await resolveCard(purchase.agentId, purchase.virtualCardId);
  assertCardOperational(card, purchase.currency);
  if (card.provider !== "STRIPE") throw new Error("AUTONOMOUS_CARD_PROVIDER_UNSUPPORTED");
  const policy = await getCardAutonomyPolicy(card.id);
  if (!policy || policy.mode === "DISABLED" || policy.version !== purchase.policyVersion) throw new Error("CARD_AUTONOMY_POLICY_CHANGED");
  const cardDecision = await currentCardAuthorizationFacts(card, BigInt(purchase.amountMinor), purchase.merchantCategory ?? undefined, purchase.merchantCountry ?? undefined, purchase.id);
  const decision = evaluateCardAutonomy({ policy, merchantHost: purchase.merchantHost, amountMinor: BigInt(purchase.amountMinor), purpose: purchase.purpose ?? undefined, cardApproved: cardDecision.approved, cardReasons: cardDecision.reasons });
  if (decision.outcome === "DENY") throw new Error("CARD_PURCHASE_POLICY_REVOKED");
  const merchantUrl = decryptSecret(purchase.merchantUrl);
  const plan = checkoutPlanSchema.parse(JSON.parse(decryptSecret(purchase.checkoutPlanEncrypted)));
  return {
    purchaseId: purchase.id,
    paymentIntentId: purchase.paymentIntentId,
    leaseToken: purchase.leaseToken,
    merchantUrl,
    merchantHost: purchase.merchantHost,
    amountMinor: purchase.amountMinor,
    currency: purchase.currency,
    purpose: purchase.purpose,
    externalCardId: card.externalCardId,
    checkoutPlan: plan,
    maxCheckoutSeconds: policy.maxCheckoutSeconds,
  };
}

export async function validateLeasedCardPurchase(purchaseId: string, leaseToken: string) {
  const purchase = await getCardPurchase(purchaseId);
  if (!purchase || purchase.status !== "EXECUTING" || purchase.leaseToken !== leaseToken || !purchase.leaseExpiresAt || purchase.leaseExpiresAt <= new Date()) throw new Error("CARD_PURCHASE_LEASE_INVALID");
  try {
    await materializeLeasedCardPurchase(purchase);
    return purchase;
  } catch (error) {
    await cancelLeasedPurchase(purchaseId, leaseToken, error instanceof Error ? error.message.slice(0, 120) : "CARD_PURCHASE_REVOKED");
    throw error;
  }
}

export function checkoutPlanAuditSummary(raw: unknown) {
  return planSummary(checkoutPlanSchema.parse(raw));
}
