import { describe, expect, it } from "vitest";

import { combinePolicyOutcomes, evaluateUsdPolicy } from "@/domain/catalyst-policy";

const limits = {
  policyVersionId: "00000000-0000-0000-0000-000000000001",
  quoteCurrency: "USD" as const,
  perTransactionUsdMicros: 2_000_000n,
  hourlyUsdMicros: 5_000_000n,
  dailyUsdMicros: 10_000_000n,
  monthlyUsdMicros: 100_000_000n,
  maxPriceAgeSeconds: 30,
  maxConfidenceBps: 250,
};

describe("Catalyst policy composition", () => {
  it("adds USD limits without relaxing atomic policy", () => {
    const usd = evaluateUsdPolicy({
      requestedUsdMicros: 3_000_000n,
      spend: { hourlyUsdMicros: 0n, dailyUsdMicros: 0n, monthlyUsdMicros: 0n },
      limits,
      overLimitAction: "REQUIRE_APPROVAL",
    });
    expect(usd.decision).toBe("REQUIRE_APPROVAL");
    expect(usd.reasonCodes).toContain("USD_PER_TRANSACTION_LIMIT_EXCEEDED");

    expect(combinePolicyOutcomes({ decision: "DENY", reasonCodes: ["MERCHANT_DENIED"] }, usd).decision).toBe("DENY");
    expect(combinePolicyOutcomes({ decision: "ALLOW", reasonCodes: ["WITHIN_POLICY"] }, usd).decision).toBe("REQUIRE_APPROVAL");
  });

  it("checks every configured USD window", () => {
    const result = evaluateUsdPolicy({
      requestedUsdMicros: 1_500_000n,
      spend: { hourlyUsdMicros: 4_000_000n, dailyUsdMicros: 9_000_000n, monthlyUsdMicros: 99_000_000n },
      limits,
      overLimitAction: "DENY",
    });
    expect(result.decision).toBe("DENY");
    expect(result.reasonCodes).toEqual(expect.arrayContaining([
      "USD_HOURLY_LIMIT_EXCEEDED",
      "USD_DAILY_LIMIT_EXCEEDED",
      "USD_MONTHLY_LIMIT_EXCEEDED",
    ]));
  });
});
