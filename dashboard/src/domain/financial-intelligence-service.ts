import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { forecastSpend, percentile, robustDeviationScore } from "@/domain/predictive-math";

type Ledger = "CRYPTO_PAYMENT" | "VIRTUAL_CARD" | "FIAT_TRANSFER" | "INVOICE";
type Bucket = { organizationId: string; agentId: string | null; ledgerType: Ledger; assetCode: string; date: Date; outflow: bigint; inflow: bigint; count: number; declined: number; maximum: bigint };
const day = 86_400_000;
const utcDate = (value: Date) => new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
const keyFor = (org: string, agent: string | null, ledger: Ledger, asset: string, date: Date) => `${org}:${agent ?? "ORG"}:${ledger}:${asset}:${date.toISOString().slice(0, 10)}`;
const atomic = (value: { toString(): string }) => BigInt(value.toString());

function add(buckets: Map<string, Bucket>, input: Omit<Bucket, "count" | "declined" | "maximum"> & { count?: number; declined?: number; maximum?: bigint }) {
  const date = utcDate(input.date);
  const key = keyFor(input.organizationId, input.agentId, input.ledgerType, input.assetCode, date);
  const current = buckets.get(key) ?? { ...input, date, count: 0, declined: 0, maximum: 0n };
  current.outflow += input.outflow; current.inflow += input.inflow; current.count += input.count ?? 0; current.declined += input.declined ?? 0;
  current.maximum = input.maximum && input.maximum > current.maximum ? input.maximum : current.maximum;
  buckets.set(key, current);
}

async function collect(organizationId: string, since: Date) {
  const buckets = new Map<string, Bucket>();
  const [crypto, cards, fiat, issued, received] = await Promise.all([
    db.spendReservation.findMany({ where: { agent: { organizationId }, status: "SETTLED", updatedAt: { gte: since } }, include: { agent: true, asset: true } }),
    db.cardAuthorization.findMany({ where: { organizationId, requestedAt: { gte: since } }, include: { virtualCard: true } }),
    db.fiatTransfer.findMany({ where: { organizationId, status: "SUCCEEDED", updatedAt: { gte: since } } }),
    db.agentInvoice.findMany({ where: { issuerOrganizationId: organizationId, status: "PAID", paidAt: { gte: since } }, include: { asset: true } }),
    db.agentInvoice.findMany({ where: { recipientOrganizationId: organizationId, status: "PAID", paidAt: { gte: since } }, include: { asset: true } }),
  ]);
  for (const row of crypto) { const amount = atomic(row.amountAtomic); add(buckets, { organizationId, agentId: row.agentId, ledgerType: "CRYPTO_PAYMENT", assetCode: row.asset.symbol, date: row.updatedAt, outflow: amount, inflow: 0n, count: 1, maximum: amount }); }
  for (const row of cards) { const amount = atomic(row.amountMinor); const spent = row.status === "APPROVED" || row.status === "CLOSED"; add(buckets, { organizationId, agentId: row.virtualCard.agentId, ledgerType: "VIRTUAL_CARD", assetCode: row.currency.toUpperCase(), date: row.requestedAt, outflow: spent ? amount : 0n, inflow: 0n, count: spent ? 1 : 0, declined: row.status === "DECLINED" ? 1 : 0, maximum: spent ? amount : 0n }); }
  for (const row of fiat) { const amount = atomic(row.amountMinor); add(buckets, { organizationId, agentId: null, ledgerType: "FIAT_TRANSFER", assetCode: row.currency.toUpperCase(), date: row.updatedAt, outflow: row.direction === "WITHDRAWAL" ? amount : 0n, inflow: row.direction === "DEPOSIT" ? amount : 0n, count: 1, maximum: amount }); }
  for (const row of issued) { const amount = atomic(row.totalAtomic); add(buckets, { organizationId, agentId: row.issuerAgentId, ledgerType: "INVOICE", assetCode: row.asset.symbol, date: row.paidAt!, outflow: 0n, inflow: amount, count: 1, maximum: amount }); }
  for (const row of received) { const amount = atomic(row.totalAtomic); add(buckets, { organizationId, agentId: row.recipientAgentId, ledgerType: "INVOICE", assetCode: row.asset.symbol, date: row.paidAt!, outflow: amount, inflow: 0n, count: 1, maximum: amount }); }
  return [...buckets.values()];
}

function fillDays(rows: Array<{ observationDate: Date; outflowAtomic: { toString(): string } }>, through: Date, count = 30) {
  const values = new Map(rows.map((row) => [utcDate(row.observationDate).getTime(), atomic(row.outflowAtomic)]));
  return Array.from({ length: count }, (_, index) => values.get(through.getTime() - (count - index - 1) * day) ?? 0n);
}

export async function runFinancialIntelligence(organizationId: string, throughInput = new Date()) {
  const through = utcDate(throughInput); const since = new Date(through.getTime() - 89 * day);
  const run = await db.intelligenceRun.create({ data: { organizationId, windowStart: since, windowEnd: through } });
  try {
    const buckets = await collect(organizationId, since);
    for (const bucket of buckets) await db.financialObservationDaily.upsert({
      where: { organizationId_scopeKey_ledgerType_assetCode_observationDate: { organizationId, scopeKey: bucket.agentId ?? "ORG", ledgerType: bucket.ledgerType, assetCode: bucket.assetCode, observationDate: bucket.date } },
      create: { organizationId, agentId: bucket.agentId, scopeKey: bucket.agentId ?? "ORG", ledgerType: bucket.ledgerType, assetCode: bucket.assetCode, observationDate: bucket.date, outflowAtomic: bucket.outflow.toString(), inflowAtomic: bucket.inflow.toString(), transactionCount: bucket.count, declinedCount: bucket.declined, averageAtomic: bucket.count ? (bucket.outflow / BigInt(bucket.count)).toString() : "0", maximumAtomic: bucket.maximum.toString() },
      update: { outflowAtomic: bucket.outflow.toString(), inflowAtomic: bucket.inflow.toString(), transactionCount: bucket.count, declinedCount: bucket.declined, averageAtomic: bucket.count ? (bucket.outflow / BigInt(bucket.count)).toString() : "0", maximumAtomic: bucket.maximum.toString() },
    });
    const observations = await db.financialObservationDaily.findMany({ where: { organizationId, observationDate: { gte: since, lte: through } }, orderBy: { observationDate: "asc" } });
    const groups = new Map<string, typeof observations>();
    for (const row of observations) { const key = `${row.scopeKey}:${row.ledgerType}:${row.assetCode}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
    let forecasts = 0, anomalies = 0, recommendations = 0;
    for (const rows of groups.values()) {
      const current = rows[0]!; const series = fillDays(rows, through, 30);
      for (const horizon of [7, 30, 90]) { const result = forecastSpend(series, horizon); await db.spendForecast.create({ data: { organizationId, agentId: current.agentId, ledgerType: current.ledgerType, assetCode: current.assetCode, horizonDays: horizon, predictedOutflowAtomic: result.predicted.toString(), lowerBoundAtomic: result.lower.toString(), upperBoundAtomic: result.upper.toString(), confidence: result.confidence, modelName: "robust-weighted-trend", modelVersion: "1.0.0", trainingDays: series.length, trainedThrough: through } }); forecasts++; }
      const latest = series.at(-1)!; const history = series.slice(0, -1); const score = robustDeviationScore(latest, history); const declines = rows.find((row) => utcDate(row.observationDate).getTime() === through.getTime())?.declinedCount ?? 0;
      if (score >= 4 || declines >= 3) {
        const reasonCode = declines >= 3 ? "DECLINE_SPIKE" : "OUTFLOW_SPIKE"; const severity = score >= 10 || declines >= 10 ? "CRITICAL" : score >= 7 || declines >= 6 ? "HIGH" : "MEDIUM";
        const anomalyKey = createHash("sha256").update(`${organizationId}:${current.scopeKey}:${current.ledgerType}:${current.assetCode}:${through.toISOString()}:${reasonCode}`).digest("hex");
        const created = await db.financialAnomaly.upsert({ where: { anomalyKey }, create: { organizationId, agentId: current.agentId, ledgerType: current.ledgerType, assetCode: current.assetCode, anomalyKey, severity, reasonCode, observedAtomic: latest.toString(), expectedAtomic: percentile(history, .5).toString(), deviationScore: Math.max(score, declines), explanation: { method: "median-absolute-deviation", historyDays: history.length, declines } }, update: { severity, observedAtomic: latest.toString(), expectedAtomic: percentile(history, .5).toString(), deviationScore: Math.max(score, declines), explanation: { method: "median-absolute-deviation", historyDays: history.length, declines } } });
        await db.outboxEvent.create({ data: { organizationId, eventType: "FINANCIAL_ANOMALY_DETECTED", aggregateType: "FINANCIAL_ANOMALY", aggregateId: created.id, payload: { severity, reasonCode, ledgerType: current.ledgerType, assetCode: current.assetCode } } }); anomalies++;
      }
      if (current.agentId && current.ledgerType === "CRYPTO_PAYMENT") {
        const agent = await db.agent.findUnique({ where: { id: current.agentId }, include: { defaultAsset: true } });
        const asset = agent?.defaultAsset?.symbol === current.assetCode ? agent.defaultAsset : await db.asset.findFirst({ where: { symbol: current.assetCode, agents: { some: { id: current.agentId } } } });
        const nonZero = series.filter((value) => value > 0n); if (asset && nonZero.length >= 7) {
          const perTx = percentile(rows.map((row) => atomic(row.maximumAtomic)).filter((value) => value > 0n), .95); const daily = percentile(nonZero, .95); const monthly = forecastSpend(series, 30).upper;
          if (perTx > 0n && daily > 0n && monthly > 0n) { await db.budgetRecommendation.updateMany({ where: { agentId: current.agentId, assetId: asset.id, status: "OPEN" }, data: { status: "SUPERSEDED" } }); await db.budgetRecommendation.create({ data: { organizationId, agentId: current.agentId, assetId: asset.id, recommendedPerTransactionAtomic: perTx.toString(), recommendedDailyAtomic: daily.toString(), recommendedMonthlyAtomic: monthly.toString(), confidence: Math.min(.95, nonZero.length / 30), rationale: { method: "p95-plus-forecast-bound", observationDays: nonZero.length }, basedOnThrough: through } }); recommendations++; }
        }
      }
    }
    await db.spendForecast.deleteMany({ where: { organizationId, generatedAt: { lt: new Date(Date.now() - 180 * day) } } });
    return await db.intelligenceRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", observations: buckets.length, forecasts, anomalies, recommendations, completedAt: new Date() } });
  } catch (error) {
    await db.intelligenceRun.update({ where: { id: run.id }, data: { status: "FAILED", errorCode: error instanceof Error ? error.message.slice(0, 120) : "INTELLIGENCE_RUN_FAILED", completedAt: new Date() } }); throw error;
  }
}

export async function runAllFinancialIntelligence() {
  const organizations = await db.organization.findMany({ where: { status: "ACTIVE" }, select: { id: true } }); const results = [];
  for (const organization of organizations) results.push(await runFinancialIntelligence(organization.id)); return results;
}

export async function applyBudgetRecommendation(organizationId: string, recommendationId: string, userId: string) {
  return db.$transaction(async (tx) => {
    const recommendation = await tx.budgetRecommendation.findFirst({ where: { id: recommendationId, organizationId, status: "OPEN" } }); if (!recommendation) throw new Error("RECOMMENDATION_NOT_FOUND");
    const agent = await tx.agent.findFirst({ where: { id: recommendation.agentId, organizationId }, include: { effectivePolicy: true } }); if (!agent?.effectivePolicy) throw new Error("EFFECTIVE_POLICY_REQUIRED");
    const source = agent.effectivePolicy; const latest = await tx.policyVersion.aggregate({ where: { policyId: source.policyId }, _max: { version: true } });
    const draft = await tx.policyVersion.create({ data: { policyId: source.policyId, version: (latest._max.version ?? 0) + 1, status: "DRAFT", assetId: source.assetId, perTransactionLimitAtomic: recommendation.recommendedPerTransactionAtomic, dailyLimitAtomic: recommendation.recommendedDailyAtomic, monthlyLimitAtomic: recommendation.recommendedMonthlyAtomic, overLimitAction: source.overLimitAction, merchantMode: source.merchantMode, allowedHosts: source.allowedHosts, deniedHosts: source.deniedHosts, approvalThreshold: source.approvalThreshold, rejectionThreshold: source.rejectionThreshold, allowedMerchantCategories: source.allowedMerchantCategories, activeFrom: source.activeFrom, activeUntil: source.activeUntil, allowedWeekdays: source.allowedWeekdays, allowedStartMinute: source.allowedStartMinute, allowedEndMinute: source.allowedEndMinute, hourlyLimitAtomic: source.hourlyLimitAtomic, maxTransactionsPerHour: source.maxTransactionsPerHour, cooldownSeconds: source.cooldownSeconds, createdBy: userId } });
    await tx.budgetRecommendation.update({ where: { id: recommendation.id }, data: { status: "ACCEPTED" } }); await tx.auditEvent.create({ data: { organizationId, actorType: "USER", actorId: userId, action: "BUDGET_RECOMMENDATION_ACCEPTED", targetType: "POLICY_VERSION", targetId: draft.id, result: "SUCCESS", metadata: { recommendationId } } }); return draft;
  });
}
