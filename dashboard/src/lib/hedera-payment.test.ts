import { describe, expect, it } from "vitest";

import {
  extractTransactionId,
  normalizeTransactionId,
  parseHbarToTinybars,
  verifyHederaPayment,
} from "./hedera-payment";

const transaction = {
  consensus_timestamp: "1784807000.123456789",
  result: "SUCCESS",
  transaction_id: "0.0.9699844-1784806998-100",
  transfers: [
    { account: "0.0.9699844", amount: -1_100_000 },
    { account: "0.0.34567", amount: 1_000_000 },
    { account: "0.0.3", amount: 100_000 },
  ],
};

describe("Hedera payments", () => {
  it("extracts wrapped and unwrapped wallet transaction IDs", () => {
    expect(extractTransactionId({ transactionId: "direct" })).toBe("direct");
    expect(extractTransactionId({ result: { transactionId: "wrapped" } })).toBe("wrapped");
  });

  it("normalizes SDK transaction IDs for mirror-node URLs", () => {
    expect(normalizeTransactionId("0.0.9699844@1784806998.100")).toBe("0.0.9699844-1784806998-100");
  });

  it("verifies payer, payee, amount, and consensus result", () => {
    expect(verifyHederaPayment(transaction, "0.0.9699844", "0.0.34567", 1_000_000)).toBe(true);
    expect(verifyHederaPayment({ ...transaction, result: "FAIL" }, "0.0.9699844", "0.0.34567", 1_000_000)).toBe(false);
    expect(verifyHederaPayment({ ...transaction, transfers: [] }, "0.0.9699844", "0.0.34567", 1_000_000)).toBe(false);
  });

  it("converts decimal HBAR input without floating-point rounding", () => {
    expect(parseHbarToTinybars("0.01")).toBe(1_000_000);
    expect(parseHbarToTinybars("1.00000001")).toBe(100_000_001);
    expect(parseHbarToTinybars("0")).toBeNull();
  });
});
