import { describe, expect, it } from "vitest";

import { hederaPaymentReconciliationOutcome } from "@/domain/payment-reconciliation-service";

describe("mirror-node reconciliation", () => {
  const transaction = {
    transaction_id: "0.0.100@1234.000000001",
    consensus_timestamp: "1234.000000002",
    result: "SUCCESS",
    transfers: [
      { account: "0.0.100", amount: -5000000 },
      { account: "0.0.200", amount: 5000000 },
    ],
  };

  it("matches the exact payer, payee, and amount", () => {
    expect(hederaPaymentReconciliationOutcome(transaction, { type: "NATIVE" }, "0.0.100", "0.0.200", "5000000")).toBe("CONFIRMED");
  });

  it("does not accept a transfer with a changed destination or amount", () => {
    expect(hederaPaymentReconciliationOutcome(transaction, { type: "NATIVE" }, "0.0.100", "0.0.201", "5000000")).toBe("MISMATCH");
    expect(hederaPaymentReconciliationOutcome(transaction, { type: "NATIVE" }, "0.0.100", "0.0.200", "5000001")).toBe("MISMATCH");
  });

  it("does not accept a failed transaction", () => {
    expect(hederaPaymentReconciliationOutcome({ ...transaction, result: "INSUFFICIENT_ACCOUNT_BALANCE" }, { type: "NATIVE" }, "0.0.100", "0.0.200", "5000000")).toBe("FAILED");
  });
});
