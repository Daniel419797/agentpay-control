import { describe, expect, it } from "vitest";

import { matchMirrorSettlement } from "@/domain/reconciliation-service";

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
    expect(matchMirrorSettlement([transaction], { payer: "0.0.100", payee: "0.0.200", amountAtomic: 5000000n })?.transaction_id).toBe(transaction.transaction_id);
  });

  it("does not accept a transfer with a changed destination or amount", () => {
    expect(matchMirrorSettlement([transaction], { payer: "0.0.100", payee: "0.0.201", amountAtomic: 5000000n })).toBeUndefined();
    expect(matchMirrorSettlement([transaction], { payer: "0.0.100", payee: "0.0.200", amountAtomic: 5000001n })).toBeUndefined();
  });

  it("does not accept a failed transaction", () => {
    expect(matchMirrorSettlement([{ ...transaction, result: "INSUFFICIENT_ACCOUNT_BALANCE" }], { payer: "0.0.100", payee: "0.0.200", amountAtomic: 5000000n })).toBeUndefined();
  });
});
