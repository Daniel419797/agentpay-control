import { describe, expect, it } from "vitest";
import { forecastSpend, median, medianAbsoluteDeviation, percentile, robustDeviationScore } from "./predictive-math";

describe("predictive math", () => {
  it("computes robust distribution values without converting atomic amounts to unsafe numbers", () => {
    const huge = 10n ** 60n;
    expect(median([huge + 3n, huge + 1n, huge + 2n])).toBe(huge + 2n);
    expect(percentile([1n, 2n, 3n, 4n], 0.95)).toBe(4n);
    expect(medianAbsoluteDeviation([9n, 10n, 11n, 1000n])).toBe(1n);
  });

  it("produces bounded forecasts and higher scores for exceptional spend", () => {
    const history = Array.from({ length: 30 }, (_, index) => BigInt(90 + index));
    const result = forecastSpend(history, 30);
    expect(result.lower).toBeLessThanOrEqual(result.predicted);
    expect(result.upper).toBeGreaterThanOrEqual(result.predicted);
    expect(result.confidence).toBeGreaterThan(0.1);
    expect(robustDeviationScore(1_000n, history)).toBeGreaterThan(robustDeviationScore(115n, history));
  });

  it("handles empty history", () => {
    expect(forecastSpend([], 30)).toEqual({ predicted: 0n, lower: 0n, upper: 0n, confidence: 0, dailyBaseline: 0n, dailyTrend: 0n });
  });
});
