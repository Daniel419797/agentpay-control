import { describe, expect, it } from "vitest";

import { classifyMasumiRefundProviderState, isAmbiguousMasumiRefundError, masumiRefundTargetReached, masumiRefundTerminallyPrecluded } from "@/domain/masumi-refund-mutation";

describe("Masumi refund mutation safety", () => {
  it("recognizes only provider-confirmed target states", () => {
    expect(masumiRefundTargetReached("REQUEST_REFUND", "RefundRequested")).toBe(true);
    expect(masumiRefundTargetReached("REQUEST_REFUND", "RefundAuthorized")).toBe(true);
    expect(masumiRefundTargetReached("REQUEST_REFUND", "FundsLocked")).toBe(false);
    expect(masumiRefundTargetReached("AUTHORIZE_REFUND", "RefundAuthorized")).toBe(true);
    expect(masumiRefundTargetReached("AUTHORIZE_REFUND", "RefundRequested")).toBe(false);
  });

  it("never treats an asynchronous provider acknowledgement as completed refund work", () => {
    expect(classifyMasumiRefundProviderState("REQUEST_REFUND", "FundsLocked")).toBe("SUBMISSION_UNKNOWN");
    expect(classifyMasumiRefundProviderState("REQUEST_REFUND", "RefundRequested")).toBe("CONFIRMED");
    expect(classifyMasumiRefundProviderState("AUTHORIZE_REFUND", "RefundRequested")).toBe("SUBMISSION_UNKNOWN");
    expect(classifyMasumiRefundProviderState("AUTHORIZE_REFUND", "RefundAuthorized")).toBe("CONFIRMED");
  });

  it("treats incompatible terminal provider states as conclusive failures", () => {
    expect(masumiRefundTerminallyPrecluded("REQUEST_REFUND", "Completed")).toBe(true);
    expect(masumiRefundTerminallyPrecluded("AUTHORIZE_REFUND", "Disputed")).toBe(true);
    expect(masumiRefundTerminallyPrecluded("REQUEST_REFUND", "RefundAuthorized")).toBe(false);
    expect(classifyMasumiRefundProviderState("REQUEST_REFUND", "Completed")).toBe("FAILED");
    expect(classifyMasumiRefundProviderState("AUTHORIZE_REFUND", "Disputed")).toBe("FAILED");
  });

  it("never blindly retries ambiguous transport or provider outcomes", () => {
    expect(isAmbiguousMasumiRefundError(new TypeError("network"))).toBe(true);
    const timeout = new Error("timeout"); timeout.name = "TimeoutError";
    expect(isAmbiguousMasumiRefundError(timeout)).toBe(true);
    expect(isAmbiguousMasumiRefundError(Object.assign(new Error("conflict"), { ambiguous: true }))).toBe(true);
    expect(isAmbiguousMasumiRefundError(new Error("MASUMI_REFUND_STATE_INVALID"))).toBe(true);
    expect(isAmbiguousMasumiRefundError(new Error("MASUMI_PAYMENT_PROVIDER_400"))).toBe(true);
    expect(isAmbiguousMasumiRefundError(new Error("MASUMI_PAYMENT_API_KEY_REQUIRED"))).toBe(false);
  });
});
