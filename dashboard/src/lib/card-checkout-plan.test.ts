import { describe, expect, it } from "vitest";

import { checkoutPlanSchema, hostMatchesPattern, normalizeHostPattern } from "@/lib/card-checkout-plan";

const success = { successText: { selector: "#status", contains: "Thank you" } };

describe("checkoutPlanSchema", () => {
  it("accepts separate expiry fields and an explicit submit checkpoint", () => {
    const plan = checkoutPlanSchema.parse({
      steps: [
        { op: "secret", selector: "#card", secret: "CARD_NUMBER" },
        { op: "secret", selector: "#cvc", secret: "CVC" },
        { op: "secret", selector: "#month", secret: "EXP_MONTH" },
        { op: "secret", selector: "#year", secret: "EXP_YEAR" },
        { op: "submit", selector: "button[type=submit]" },
      ],
      ...success,
    });
    expect(plan.steps.at(-1)?.op).toBe("submit");
  });

  it("accepts a combined expiry field", () => {
    expect(() => checkoutPlanSchema.parse({
      steps: [
        { op: "secret", selector: "#card", secret: "CARD_NUMBER" },
        { op: "secret", selector: "#cvc", secret: "CVC" },
        { op: "secret", selector: "#expiry", secret: "CARD_EXPIRY" },
      ],
      ...success,
    })).not.toThrow();
  });

  it("rejects plans without all required card fields", () => {
    expect(() => checkoutPlanSchema.parse({ steps: [{ op: "secret", selector: "#card", secret: "CARD_NUMBER" }], ...success })).toThrow();
  });

  it("rejects multiple explicit submit operations", () => {
    expect(() => checkoutPlanSchema.parse({
      steps: [
        { op: "secret", selector: "#card", secret: "CARD_NUMBER" },
        { op: "secret", selector: "#cvc", secret: "CVC" },
        { op: "secret", selector: "#expiry", secret: "CARD_EXPIRY" },
        { op: "submit", selector: "#pay" },
        { op: "submit", selector: "#pay-again" },
      ],
      ...success,
    })).toThrow();
  });
});

describe("merchant host patterns", () => {
  it("normalizes and matches exact and wildcard hosts", () => {
    expect(normalizeHostPattern("*.Example.COM")).toBe("*.example.com");
    expect(hostMatchesPattern("checkout.example.com", "*.example.com")).toBe(true);
    expect(hostMatchesPattern("example.com", "*.example.com")).toBe(false);
    expect(hostMatchesPattern("example.com", "example.com")).toBe(true);
  });

  it("rejects malformed patterns", () => {
    expect(() => normalizeHostPattern("https://example.com")).toThrow("CARD_AUTONOMY_HOST_INVALID");
  });
});
