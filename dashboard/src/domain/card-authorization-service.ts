import { db } from "@/lib/db";

export type CardAuthorizationFacts = {
  cardStatus: string;
  organizationActive: boolean;
  killSwitchEnabled: boolean;
  cardCurrency: string;
  amountMinor: bigint;
  spentMinor: bigint;
  spendingLimitMinor?: bigint;
  spendingInterval?: string;
  allowedCategories: string[];
  blockedCategories: string[];
  allowedCountries: string[];
  merchantCategory?: string;
  merchantCountry?: string;
};

export function evaluateCardAuthorization(facts: CardAuthorizationFacts) {
  const reasons: string[] = [];
  const category = facts.merchantCategory?.toLowerCase();
  const country = facts.merchantCountry?.toUpperCase();
  if (facts.cardStatus !== "ACTIVE") reasons.push("CARD_NOT_ACTIVE");
  if (!facts.organizationActive || facts.killSwitchEnabled) reasons.push("ORGANIZATION_DISABLED");
  if (facts.amountMinor <= 0n) reasons.push("INVALID_AMOUNT");
  if (category && facts.blockedCategories.map((value) => value.toLowerCase()).includes(category)) reasons.push("CATEGORY_BLOCKED");
  if (facts.allowedCategories.length && (!category || !facts.allowedCategories.map((value) => value.toLowerCase()).includes(category))) reasons.push("CATEGORY_NOT_ALLOWED");
  if (facts.allowedCountries.length && (!country || !facts.allowedCountries.map((value) => value.toUpperCase()).includes(country))) reasons.push("COUNTRY_NOT_ALLOWED");
  if (facts.spendingLimitMinor !== undefined) {
    const projected = facts.spendingInterval === "per_authorization" ? facts.amountMinor : facts.spentMinor + facts.amountMinor;
    if (projected > facts.spendingLimitMinor) reasons.push(facts.spendingInterval === "per_authorization" ? "PER_AUTHORIZATION_LIMIT_EXCEEDED" : "SPENDING_LIMIT_EXCEEDED");
  }
  return { approved: reasons.length === 0, reasons: reasons.length ? reasons : ["POLICY_ALLOWED"] };
}

function intervalStart(interval: string | null, now: Date) {
  if (interval === "daily") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (interval === "weekly") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    return start;
  }
  if (interval === "monthly") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  if (interval === "yearly") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return new Date(0);
}

function intervalEnd(interval: string | null, now: Date) {
  if (interval === "daily") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  if (interval === "weekly") {
    const start = intervalStart(interval, now);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    return end;
  }
  if (interval === "monthly") return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  if (interval === "yearly") return new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  return new Date(8_640_000_000_000_000);
}

export function spendingWindow(interval: string | null, at: Date) {
  return { start: intervalStart(interval, at), end: intervalEnd(interval, at) };
}

export type RecordCardAuthorizationInput = {
  provider: "SANDBOX" | "STRIPE";
  externalAuthorizationId: string;
  externalCardId: string;
  amountMinor: bigint;
  currency: string;
  merchantName?: string;
  merchantCategory?: string;
  merchantCountry?: string;
  requestedAt: Date;
};

type ExecutingPurchaseRow = {
  id: string;
  payment_intent_id: string;
  amount_minor: unknown;
  currency: string;
};

export async function recordCardAuthorization(input: RecordCardAuthorizationInput) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.provider}:${input.externalCardId}`}, 0))`;
    const duplicate = await tx.cardAuthorization.findUnique({ where: { provider_externalAuthorizationId: { provider: input.provider, externalAuthorizationId: input.externalAuthorizationId } } });
    if (duplicate?.approved !== null && duplicate?.approved !== undefined) return duplicate;
    const card = await tx.virtualCard.findUnique({
      where: { provider_externalCardId: { provider: input.provider, externalCardId: input.externalCardId } },
      include: { organization: true },
    });
    if (!card) throw new Error("CARD_NOT_FOUND");

    const executing = await tx.$queryRaw<ExecutingPurchaseRow[]>`
      SELECT "id", "payment_intent_id", "amount_minor", "currency"
      FROM "autonomous_card_purchase"
      WHERE "virtual_card_id" = ${card.id}::uuid
        AND "status" = 'EXECUTING'
        AND "lease_expires_at" > NOW()
      ORDER BY "started_at" ASC
      LIMIT 2
    `;
    const autonomousPurchase = executing.length === 1 ? executing[0]! : null;
    const reservedRows = await tx.$queryRaw<Array<{ total: unknown }>>`
      SELECT COALESCE(SUM("amount_minor"), 0) AS "total"
      FROM "autonomous_card_purchase"
      WHERE "virtual_card_id" = ${card.id}::uuid
        AND "status" IN ('READY','EXECUTING')
        AND (${autonomousPurchase?.id ?? null}::uuid IS NULL OR "id" <> ${autonomousPurchase?.id ?? null}::uuid)
    `;
    const autonomousReservedMinor = BigInt(String(reservedRows[0]?.total ?? 0));

    const window = spendingWindow(card.spendingInterval, input.requestedAt);
    const prior = card.spendingInterval === "per_authorization" ? [] : await tx.cardAuthorization.findMany({
      where: {
        virtualCardId: card.id,
        approved: true,
        status: { in: ["PENDING", "APPROVED", "CLOSED"] },
        requestedAt: { gte: window.start, lt: window.end },
        externalAuthorizationId: { not: input.externalAuthorizationId },
      },
      select: { amountMinor: true },
    });
    const spentMinor = prior.reduce((sum, item) => sum + BigInt(item.amountMinor.toString()), 0n) + (card.spendingInterval === "per_authorization" ? 0n : autonomousReservedMinor);
    const currencyMatches = card.currency.toUpperCase() === input.currency.toUpperCase();
    const decision = evaluateCardAuthorization({
      cardStatus: card.status,
      organizationActive: card.organization.status === "ACTIVE",
      killSwitchEnabled: card.organization.killSwitchEnabled,
      cardCurrency: card.currency,
      amountMinor: input.amountMinor,
      spentMinor,
      spendingLimitMinor: card.spendingLimitMinor ? BigInt(card.spendingLimitMinor.toString()) : undefined,
      spendingInterval: card.spendingInterval ?? undefined,
      allowedCategories: card.allowedCategories,
      blockedCategories: card.blockedCategories,
      allowedCountries: card.allowedCountries,
      merchantCategory: input.merchantCategory,
      merchantCountry: input.merchantCountry,
    });
    const reasons = decision.reasons[0] === "POLICY_ALLOWED" ? [] : [...decision.reasons];
    if (!currencyMatches) reasons.push("CURRENCY_MISMATCH");
    if (executing.length > 1) reasons.push("AUTONOMOUS_PURCHASE_AMBIGUOUS");
    if (autonomousPurchase) {
      if (BigInt(String(autonomousPurchase.amount_minor)) !== input.amountMinor) reasons.push("AUTONOMOUS_PURCHASE_AMOUNT_MISMATCH");
      if (autonomousPurchase.currency.toUpperCase() !== input.currency.toUpperCase()) reasons.push("AUTONOMOUS_PURCHASE_CURRENCY_MISMATCH");
    }
    const approved = reasons.length === 0;
    if (approved) reasons.push(autonomousPurchase ? "AUTONOMOUS_PURCHASE_BOUND" : "POLICY_ALLOWED");

    const authorization = await tx.cardAuthorization.upsert({
      where: { provider_externalAuthorizationId: { provider: input.provider, externalAuthorizationId: input.externalAuthorizationId } },
      update: { status: approved ? "APPROVED" : "DECLINED", approved, decisionReasons: reasons, resolvedAt: new Date() },
      create: {
        organizationId: card.organizationId,
        virtualCardId: card.id,
        provider: input.provider,
        externalAuthorizationId: input.externalAuthorizationId,
        status: approved ? "APPROVED" : "DECLINED",
        amountMinor: input.amountMinor.toString(),
        currency: input.currency.toUpperCase(),
        merchantName: input.merchantName,
        merchantCategory: input.merchantCategory,
        merchantCountry: input.merchantCountry,
        approved,
        decisionReasons: reasons,
        requestedAt: input.requestedAt,
        resolvedAt: new Date(),
      },
    });
    if (autonomousPurchase) {
      await tx.$executeRaw`
        UPDATE "autonomous_card_purchase"
        SET "card_authorization_id" = ${authorization.id}::uuid, "updated_at" = NOW()
        WHERE "id" = ${autonomousPurchase.id}::uuid
          AND "status" = 'EXECUTING'
          AND "card_authorization_id" IS NULL
      `;
    }
    await tx.auditEvent.create({ data: { organizationId: card.organizationId, actorType: "PROVIDER", action: approved ? "CARD_AUTHORIZATION_APPROVED" : "CARD_AUTHORIZATION_DECLINED", targetType: "CARD_AUTHORIZATION", targetId: authorization.id, result: approved ? "SUCCESS" : "DENIED", metadata: { cardId: card.id, autonomousCardPurchaseId: autonomousPurchase?.id ?? null, amountMinor: input.amountMinor.toString(), currency: input.currency.toUpperCase(), reasons } } });
    await tx.outboxEvent.create({ data: { organizationId: card.organizationId, eventType: approved ? "CARD_AUTHORIZATION_APPROVED" : "CARD_AUTHORIZATION_DECLINED", aggregateType: "CARD_AUTHORIZATION", aggregateId: authorization.id, payload: { cardId: card.id, autonomousCardPurchaseId: autonomousPurchase?.id ?? null, amountMinor: input.amountMinor.toString(), currency: input.currency.toUpperCase(), merchantName: input.merchantName ?? null, reasons } } });
    return authorization;
  }, { isolationLevel: "Serializable" });
}
