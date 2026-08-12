import { loadCatalystPolicyContext, valueWithPyth, type OracleValuation } from "@/domain/catalyst-policy";
import { db } from "@/lib/db";

export function assertOracleAuthorizationStillConservative(input: {
  authorizedUsdMicros: bigint;
  authorizedFeedId: string;
  current: OracleValuation;
}) {
  if (input.current.observation.feedId.toLowerCase() !== input.authorizedFeedId.toLowerCase()) throw new Error("PYTH_FEED_CHANGED_AFTER_AUTHORIZATION");
  if (input.current.usdMicros > input.authorizedUsdMicros) throw new Error("PYTH_VALUATION_INCREASED_AFTER_AUTHORIZATION");
}

async function failApprovedIntent(intentId: string, organizationId: string, code: string) {
  await db.$transaction(async (tx) => {
    const changed = await tx.paymentIntent.updateMany({ where: { id: intentId, status: "AUTHORIZED" }, data: { status: "FAILED_BEFORE_SUBMISSION" } });
    if (changed.count !== 1) return;
    await tx.spendReservation.updateMany({ where: { paymentIntentId: intentId, status: "ACTIVE" }, data: { status: "RELEASED" } });
    await tx.outboxEvent.create({
      data: {
        organizationId,
        eventType: "PAYMENT_PRE_SIGN_REJECTED",
        aggregateType: "PAYMENT_INTENT",
        aggregateId: intentId,
        payload: { code, reason: "ORACLE_AUTHORIZATION_REVALIDATION_FAILED" },
      },
    });
  });
}

export async function revalidateOracleAuthorizationBeforeExecution(paymentIntentId: string) {
  const intent = await db.paymentIntent.findUnique({
    where: { id: paymentIntentId },
    include: {
      quote: { include: { asset: true } },
      reservation: true,
      decisions: { orderBy: { evaluatedAt: "desc" }, take: 1 },
      agent: { select: { effectivePolicyId: true } },
    },
  });
  if (!intent || intent.status !== "AUTHORIZED" || !intent.quote || !intent.reservation || !intent.decisions[0]) return;
  const decision = intent.decisions[0];
  if (intent.agent.effectivePolicyId !== decision.policyVersionId) return;

  const catalyst = await loadCatalystPolicyContext(decision.policyVersionId);
  if (!catalyst.oracle) return;

  const rows = await db.$queryRaw<Array<{ usdMicros: bigint; feedId: string }>>`
    SELECT "usdMicros","feedId"
    FROM "UsdSpendReservationSnapshot"
    WHERE "spendReservationId"=${intent.reservation.id}::uuid
    LIMIT 1`;
  const snapshot = rows[0];
  let failureCode: string | undefined;
  try {
    if (!snapshot) throw new Error("PYTH_AUTHORIZATION_SNAPSHOT_MISSING");
    const current = await valueWithPyth({
      oracle: catalyst.oracle,
      assetSymbol: intent.quote.asset.symbol,
      assetDecimals: intent.quote.asset.decimals,
      amountAtomic: intent.quote.amountAtomic.toString(),
    });
    assertOracleAuthorizationStillConservative({ authorizedUsdMicros: BigInt(snapshot.usdMicros), authorizedFeedId: snapshot.feedId, current });
  } catch (error) {
    failureCode = error instanceof Error ? error.message.slice(0, 120) : "PYTH_AUTHORIZATION_REVALIDATION_FAILED";
  }
  if (!failureCode) return;
  await failApprovedIntent(intent.id, intent.organizationId, failureCode);
  throw new Error(failureCode);
}
