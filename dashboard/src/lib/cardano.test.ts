import { describe, expect, it } from "vitest";
import { cardanoExactPaymentMatches, type CardanoTransactionEvidence } from "@/lib/cardano";

const payer = "addr_test1payer";
const payee = "addr_test1payee";
const base: CardanoTransactionEvidence = {
  transactionHash: "a".repeat(64),
  confirmations: 2,
  validContract: true,
  inputs: [{ address: payer, amount: [{ unit: "lovelace", quantity: "3000000" }] }],
  outputs: [
    { address: payee, amount: [{ unit: "lovelace", quantity: "1000000" }] },
    { address: payer, amount: [{ unit: "lovelace", quantity: "1800000" }] },
  ],
};

describe("Cardano exact ADA evidence", () => {
  it("accepts an exact ADA payment with payer-only change", () => {
    expect(cardanoExactPaymentMatches(base, payer, payee, "lovelace", "1000000")).toBe(true);
  });

  it("rejects native tokens in any payer input", () => {
    expect(cardanoExactPaymentMatches({
      ...base,
      inputs: [{ address: payer, amount: [{ unit: "lovelace", quantity: "3000000" }, { unit: "policy.asset", quantity: "1" }] }],
    }, payer, payee, "lovelace", "1000000")).toBe(false);
  });

  it("rejects native tokens hidden in a payee or change output", () => {
    expect(cardanoExactPaymentMatches({
      ...base,
      outputs: [{ address: payee, amount: [{ unit: "lovelace", quantity: "1000000" }, { unit: "policy.asset", quantity: "1" }] }],
    }, payer, payee, "lovelace", "1000000")).toBe(false);
  });

  it("rejects any third-party output even when the payee ADA amount is exact", () => {
    expect(cardanoExactPaymentMatches({
      ...base,
      outputs: [...base.outputs, { address: "addr_test1thirdparty", amount: [{ unit: "lovelace", quantity: "100000" }] }],
    }, payer, payee, "lovelace", "1000000")).toBe(false);
  });
});
