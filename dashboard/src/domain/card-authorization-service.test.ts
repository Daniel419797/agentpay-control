import { describe, expect, it } from "vitest";
import { evaluateCardAuthorization } from "./card-authorization-service";

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
