import { describe, expect, it } from "vitest";
import { assertPaymentTransition, canTransitionPayment } from "@/domain/payment-state";

describe("payment state machine", () => {
  it("allows the successful settlement path", () => {
    expect(canTransitionPayment("CREATED", "QUOTED")).toBe(true);
    expect(canTransitionPayment("AUTHORIZED", "SIGNING")).toBe(true);
    expect(canTransitionPayment("SUBMITTED", "SETTLED")).toBe(true);
  });

  it("does not revive terminal states", () => {
    expect(canTransitionPayment("SETTLED", "AUTHORIZED")).toBe(false);
    expect(() => assertPaymentTransition("DENIED", "SIGNING")).toThrow(/Invalid payment transition/);
  });
});
