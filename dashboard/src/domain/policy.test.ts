import { describe, expect, it } from "vitest";
import { evaluatePolicy, type PolicyInput } from "@/domain/policy";

const base: PolicyInput = {
  agentStatus: "ACTIVE",
  organizationKillSwitch: false,
  assetSupported: true,
  challengeExpired: false,
  merchantHost: "api.agentpay.dev",
  merchantMode: "ANY",
  allowedHosts: [],
  deniedHosts: [],
  merchantCategory: "MARKET_DATA",
  allowedMerchantCategories: [],
  amountAtomic: "5000000",
  balanceAtomic: "100000000",
  settledTodayAtomic: "10000000",
  reservedTodayAtomic: "0",
  perTransactionLimitAtomic: "25000000",
  dailyLimitAtomic: "50000000",
  hourlySpendAtomic: "0",
  monthlySpendAtomic: "0",
  overLimitAction: "REQUIRE_APPROVAL"
};

describe("evaluatePolicy", () => {
  it("allows a request inside policy", () => {
    expect(evaluatePolicy(base)).toMatchObject({ decision: "ALLOW", reasonCodes: ["WITHIN_POLICY"] });
  });

  it("requires approval above a transaction limit", () => {
    const result = evaluatePolicy({ ...base, amountAtomic: "30000000" });
    expect(result.decision).toBe("REQUIRE_APPROVAL");
    expect(result.reasonCodes).toContain("PER_TRANSACTION_LIMIT_EXCEEDED");
  });

  it("includes reservations when enforcing a daily limit", () => {
    const result = evaluatePolicy({ ...base, reservedTodayAtomic: "39000000", amountAtomic: "2000000" });
    expect(result.reasonCodes).toContain("DAILY_LIMIT_EXCEEDED");
  });

  it("denies before limits when the kill switch is active", () => {
    expect(evaluatePolicy({ ...base, organizationKillSwitch: true }).reasonCodes).toEqual(["KILL_SWITCH_ACTIVE"]);
  });

  it("gives a denylist precedence over an allowlist", () => {
    const result = evaluatePolicy({
      ...base,
      merchantMode: "ALLOWLIST_ONLY",
      allowedHosts: [base.merchantHost],
      deniedHosts: [base.merchantHost]
    });
    expect(result.reasonCodes).toEqual(["MERCHANT_DENIED"]);
  });

  it("denies requests outside an overnight schedule", () => {
    const result = evaluatePolicy({ ...base, evaluatedAt: new Date("2026-07-26T12:00:00Z"), allowedStartMinute: 22 * 60, allowedEndMinute: 6 * 60 });
    expect(result.reasonCodes).toEqual(["OUTSIDE_POLICY_SCHEDULE"]);
  });

  it("enforces category and velocity controls", () => {
    expect(evaluatePolicy({ ...base, allowedMerchantCategories: ["FILE"] }).reasonCodes).toEqual(["MERCHANT_CATEGORY_NOT_ALLOWED"]);
    expect(evaluatePolicy({ ...base, maxTransactionsPerHour: 3, transactionsLastHour: 3 }).reasonCodes).toContain("HOURLY_VELOCITY_EXCEEDED");
  });
});
