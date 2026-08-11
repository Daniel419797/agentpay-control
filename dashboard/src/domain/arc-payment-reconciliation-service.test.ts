import { describe, expect, it } from "vitest";

import { arcPaymentReconciliationOutcome, type ArcReceipt } from "@/domain/arc-payment-reconciliation-service";

const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const payer = "0x1111111111111111111111111111111111111111";
const payee = "0x2222222222222222222222222222222222222222";
const token = "0x3600000000000000000000000000000000000000";

function topic(address: string) {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function receipt(overrides: Partial<ArcReceipt> = {}): ArcReceipt {
  return {
    transactionHash: `0x${"a".repeat(64)}`,
    status: "0x1",
    blockNumber: "0x10",
    logs: [{
      address: token,
      topics: [transferTopic, topic(payer), topic(payee)],
      data: "0x0f4240",
    }],
    ...overrides,
  };
}

describe("Arc x402 reconciliation evidence", () => {
  it("confirms only the exact USDC payer, payee, and amount", () => {
    expect(arcPaymentReconciliationOutcome(receipt(), token, payer, payee, "1000000")).toBe("CONFIRMED");
  });

  it("rejects a successful transaction with a different recipient", () => {
    const wrongPayee = "0x3333333333333333333333333333333333333333";
    expect(arcPaymentReconciliationOutcome(receipt(), token, payer, wrongPayee, "1000000")).toBe("MISMATCH");
  });

  it("rejects a successful transaction with the wrong amount or token", () => {
    expect(arcPaymentReconciliationOutcome(receipt(), token, payer, payee, "1000001")).toBe("MISMATCH");
    expect(arcPaymentReconciliationOutcome(receipt(), "0x4444444444444444444444444444444444444444", payer, payee, "1000000")).toBe("MISMATCH");
  });

  it("classifies a reverted transaction as failed", () => {
    expect(arcPaymentReconciliationOutcome(receipt({ status: "0x0" }), token, payer, payee, "1000000")).toBe("FAILED");
  });
});
