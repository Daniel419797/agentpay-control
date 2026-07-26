export type ForecastResult = {
  predicted: bigint;
  lower: bigint;
  upper: bigint;
  confidence: number;
  dailyBaseline: bigint;
  dailyTrend: bigint;
};

const abs = (value: bigint) => value < 0n ? -value : value;

export function percentile(values: bigint[], fraction: number) {
  if (!values.length) return 0n;
  const ordered = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const index = Math.max(0, Math.min(ordered.length - 1, Math.ceil(fraction * ordered.length) - 1));
  return ordered[index]!;
}

export function median(values: bigint[]) {
  if (!values.length) return 0n;
  const ordered = [...values].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2n;
}

export function medianAbsoluteDeviation(values: bigint[]) {
  const center = median(values);
  return median(values.map((value) => abs(value - center)));
}

function weightedMean(values: bigint[]) {
  if (!values.length) return 0n;
  let weighted = 0n;
  let weights = 0n;
  values.forEach((value, index) => { const weight = BigInt(index + 1); weighted += value * weight; weights += weight; });
  return weighted / weights;
}

export function robustDeviationScore(observed: bigint, history: bigint[]) {
  if (!history.length) return 0;
  const center = median(history);
  const scale = medianAbsoluteDeviation(history) || (center / 10n) || 1n;
  const scaled = abs(observed - center) * 100n / scale;
  return Math.min(100, Number(scaled) / 100);
}

export function forecastSpend(dailyValues: bigint[], horizonDays: number): ForecastResult {
  if (!dailyValues.length || horizonDays < 1) return { predicted: 0n, lower: 0n, upper: 0n, confidence: 0, dailyBaseline: 0n, dailyTrend: 0n };
  const recent = dailyValues.slice(-Math.min(30, dailyValues.length));
  const baseline = weightedMean(recent);
  const half = Math.max(1, Math.floor(recent.length / 2));
  const earlier = weightedMean(recent.slice(0, half));
  const later = weightedMean(recent.slice(half));
  const rawTrend = (later - earlier) / BigInt(Math.max(1, recent.length - half));
  const trendFloor = -(baseline / 4n);
  const trendCeiling = baseline / 4n;
  const trend = rawTrend < trendFloor ? trendFloor : rawTrend > trendCeiling ? trendCeiling : rawTrend;
  const horizon = BigInt(horizonDays);
  const predicted = baseline * horizon + trend * horizon * (horizon + 1n) / 2n;
  const safePredicted = predicted > 0n ? predicted : 0n;
  const mad = medianAbsoluteDeviation(recent);
  const uncertainty = (mad * 3n + baseline / 10n) * horizon;
  const sampleConfidence = Math.min(1, recent.length / 30);
  const variabilityPenalty = baseline > 0n ? Math.min(0.7, Number((mad * 1000n) / baseline) / 1000) : 0.7;
  const confidence = Math.max(0.1, Math.min(0.95, sampleConfidence * (1 - variabilityPenalty)));
  return { predicted: safePredicted, lower: safePredicted > uncertainty ? safePredicted - uncertainty : 0n, upper: safePredicted + uncertainty, confidence, dailyBaseline: baseline, dailyTrend: trend };
}
