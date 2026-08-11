import { describe, expect, it } from "vitest";

import { hederaPaymentReconciliationOutcome } from "@/domain/payment-reconciliation-service";
import type { MirrorTransaction } from "@/lib/hedera-payment";

function transaction(overrides: Partial<MirrorTransaction> = {}): MirrorTransaction {
  return {
    consensus_timestamp: "1753510000.123456789",
    result: "SUCCESS",
    transaction_id: "0.0.123@1753510000.123456789",
    transfers: [
      { account: "0.0.123", amount: -5_000_000 },
      { account: "0.0.456", amount: 5_000_000 },
    ],
    token_transfers: [],
    ...overrides,
  };
}

describe("Hedera x402 reconciliation evidence", () => {
  it("confirms an exact native transfer", () => {
    expect(hederaPaymentReconciliationOutcome(transaction(), { type: "NATIVE" }, "0.0.123", "0.0.456", "5000000")).toBe("CONFIRMED");
  });

  it("confirms an exact token transfer on the quoted token", () => {
    const row = transaction({
      transfers: [{ account: "0.0.123", amount: -1000 }, { account: "0.0.98", amount: 1000 }],
      token_transfers: [
        { token_id: "0.0.429274", account: "0.0.123", amount: -1_000_000 },
        { token_id: "0.0.429274", account: "0.0.456", amount: 1_000_000 },
      ],
    });
    expect(hederaPaymentReconciliationOutcome(row, { type: "TOKEN", hederaTokenId: "0.0.429274" }, "0.0.123", "0.0.456", "1000000")).toBe("CONFIRMED");
  });

  it("rejects a successful transaction whose transfer does not match the quote", () => {
    const row = transaction({ transfers: [{ account: "0.0.123", amount: -5_000_000 }, { account: "0.0.999", amount: 5_000_000 }] });
    expect(hederaPaymentReconciliationOutcome(row, { type: "NATIVE" }, "0.0.123", "0.0.456", "5000000")).toBe("MISMATCH");
  });

  it("classifies a terminal Hedera transaction failure separately", () => {
    expect(hederaPaymentReconciliationOutcome(transaction({ result: "INSUFFICIENT_ACCOUNT_BALANCE" }), { type: "NATIVE" }, "0.0.123", "0.0.456", "5000000")).toBe("FAILED");
  });
});
