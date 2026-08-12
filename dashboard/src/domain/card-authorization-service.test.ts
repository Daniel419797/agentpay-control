import { describe, expect, it } from "vitest";
import { evaluateCardAuthorization, spendingWindow } from "./card-authorization-service";

const base = {
  cardStatus: "ACTIVE",
  organizationActive: true,
  killSwitchEnabled: false,
  cardCurrency: "USD",
  amountMinor: 2_500n,
  spentMinor: 1_000n,
  spendingLimitMinor: 5_000n,
  spendingInterval: "daily",
  allowedCategories: ["computer_software_stores"],
  blockedCategories: [],
  allowedCountries: ["US"],
  merchantCategory: "computer_software_stores",
  merchantCountry: "US",
};

describe("evaluateCardAuthorization", () => {
  it("allows an authorization inside every control", () => expect(evaluateCardAuthorization(base)).toEqual({ approved: true, reasons: ["POLICY_ALLOWED"] }));
  it("declines cumulative overspend", () => expect(evaluateCardAuthorization({ ...base, spentMinor: 3_000n })).toMatchObject({ approved: false, reasons: ["SPENDING_LIMIT_EXCEEDED"] }));
  it("declines blocked cards, countries, and categories", () => {
    const result = evaluateCardAuthorization({ ...base, cardStatus: "FROZEN", merchantCountry: "NG", blockedCategories: ["computer_software_stores"] });
    expect(result.approved).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining(["CARD_NOT_ACTIVE", "CATEGORY_BLOCKED", "COUNTRY_NOT_ALLOWED"]));
  });
});

describe("card spending windows", () => {
  it("uses the whole UTC day rather than request ordering", () => {
    const first = spendingWindow("daily", new Date("2026-08-11T04:00:00.000Z"));
    const sameSecond = spendingWindow("daily", new Date("2026-08-11T04:00:00.000Z"));
    expect(first).toEqual(sameSecond);
    expect(first.start.toISOString()).toBe("2026-08-11T00:00:00.000Z");
    expect(first.end.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("uses a bounded weekly window", () => {
    const window = spendingWindow("weekly", new Date("2026-08-13T12:00:00.000Z"));
    expect(window.start.toISOString()).toBe("2026-08-10T00:00:00.000Z");
    expect(window.end.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });
});
