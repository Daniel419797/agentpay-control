import { db } from "@/lib/db";

export async function catalystProductMetrics(organizationId: string) {
  const [paymentRows, providerRows, latencyRows, denialRows, masumiRows] = await Promise.all([
    db.$queryRaw<Array<{ total: bigint; settled: bigint; uniqueAgents: bigint }>>`
      SELECT COUNT(*)::bigint AS total,
             COUNT(*) FILTER (WHERE p."status"='SETTLED')::bigint AS settled,
             COUNT(DISTINCT p."agentId")::bigint AS "uniqueAgents"
      FROM "PaymentIntent" p
      JOIN "PaymentQuote" q ON q."paymentIntentId"=p."id"
      WHERE p."organizationId"=${organizationId}::uuid AND q."network" IN ('cardano:preprod','cardano:mainnet')
    `,
    db.$queryRaw<Array<{ uniqueProviders: bigint }>>`
      SELECT COUNT(DISTINCT COALESCE(m."agentIdentifier", r."providerId"::text, q."payToAccountId"))::bigint AS "uniqueProviders"
      FROM "PaymentIntent" p
      JOIN "PaymentQuote" q ON q."paymentIntentId"=p."id"
      LEFT JOIN "MasumiEscrowPurchase" m ON m."paymentIntentId"=p."id"
      LEFT JOIN "ResourceListing" r ON r."endpoint"=p."resourceUrl"
      WHERE p."organizationId"=${organizationId}::uuid AND q."network" IN ('cardano:preprod','cardano:mainnet')
    `,
    db.$queryRaw<Array<{ averageSeconds: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (s."confirmedAt" - a."createdAt")))::float8 AS "averageSeconds"
      FROM "Settlement" s JOIN "PaymentAttempt" a ON a."id"=s."paymentAttemptId" JOIN "PaymentIntent" p ON p."id"=a."paymentIntentId"
      WHERE p."organizationId"=${organizationId}::uuid AND s."network" IN ('cardano:preprod','cardano:mainnet') AND s."status"='CONFIRMED' AND s."confirmedAt" IS NOT NULL
    `,
    db.$queryRaw<Array<{ denied: bigint; approvalRequired: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE d."outcome"='DENY')::bigint AS denied,
             COUNT(*) FILTER (WHERE d."outcome"='REQUIRE_APPROVAL')::bigint AS "approvalRequired"
      FROM "PolicyDecision" d JOIN "PaymentIntent" p ON p."id"=d."paymentIntentId" JOIN "PaymentQuote" q ON q."paymentIntentId"=p."id"
      WHERE p."organizationId"=${organizationId}::uuid AND q."network" IN ('cardano:preprod','cardano:mainnet')
    `,
    db.$queryRaw<Array<{ completed: bigint; refunded: bigint; disputed: bigint }>>`
      SELECT COUNT(*) FILTER (WHERE "state"='Completed' AND "resultVerifiedAt" IS NOT NULL)::bigint AS completed,
             COUNT(*) FILTER (WHERE "state"='RefundAuthorized')::bigint AS refunded,
             COUNT(*) FILTER (WHERE "state"='Disputed')::bigint AS disputed
      FROM "MasumiEscrowPurchase" WHERE "organizationId"=${organizationId}::uuid
    `,
  ]);
  const total = Number(paymentRows[0]?.total ?? 0n), settled = Number(paymentRows[0]?.settled ?? 0n);
  return {
    scope: "ORGANIZATION_AGGREGATE",
    totalCardanoPaymentIntents: total,
    settledCardanoPayments: settled,
    settlementSuccessBps: total ? Math.floor((settled * 10_000) / total) : null,
    uniquePayingAgents: Number(paymentRows[0]?.uniqueAgents ?? 0n),
    uniqueServiceProviders: Number(providerRows[0]?.uniqueProviders ?? 0n),
    averageConfirmedSettlementSeconds: latencyRows[0]?.averageSeconds ?? null,
    deniedByPolicy: Number(denialRows[0]?.denied ?? 0n),
    requiredHumanApproval: Number(denialRows[0]?.approvalRequired ?? 0n),
    masumiCompletedWithVerifiedResult: Number(masumiRows[0]?.completed ?? 0n),
    masumiRefunded: Number(masumiRows[0]?.refunded ?? 0n),
    masumiDisputed: Number(masumiRows[0]?.disputed ?? 0n),
  };
}
