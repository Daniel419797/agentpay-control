import { describe, expect, it } from "vitest";
import { cardanoExactPaymentMatches, type CardanoTransactionEvidence } from "@/lib/cardano";

const payer = "addr_test1payer";
const payee = "addr_test1payee";
const usdcx = `${"ab".repeat(28)}5553444378`;
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

describe("Cardano exact settlement evidence", () => {
  it("accepts an exact ADA payment with payer-only change", () => {
    expect(cardanoExactPaymentMatches(base, payer, payee, "lovelace", "1000000")).toBe(true);
  });

  it("rejects native tokens in any ADA payer input", () => {
    expect(cardanoExactPaymentMatches({
      ...base,
      inputs: [{ address: payer, amount: [{ unit: "lovelace", quantity: "3000000" }, { unit: usdcx, quantity: "1" }] }],
    }, payer, payee, "lovelace", "1000000")).toBe(false);
  });

  it("rejects native tokens hidden in an ADA payee or change output", () => {
    expect(cardanoExactPaymentMatches({
      ...base,
      outputs: [{ address: payee, amount: [{ unit: "lovelace", quantity: "1000000" }, { unit: usdcx, quantity: "1" }] }],
    }, payer, payee, "lovelace", "1000000")).toBe(false);
  });

  it("rejects any third-party output even when the payee ADA amount is exact", () => {
    expect(cardanoExactPaymentMatches({
      ...base,
      outputs: [...base.outputs, { address: "addr_test1thirdparty", amount: [{ unit: "lovelace", quantity: "100000" }] }],
    }, payer, payee, "lovelace", "1000000")).toBe(false);
  });

  it("accepts exact USDCx with ADA carrier and payer-only token change", () => {
    const tokenEvidence: CardanoTransactionEvidence = {
      ...base,
      inputs: [{ address: payer, amount: [{ unit: "lovelace", quantity: "8000000" }, { unit: usdcx, quantity: "5000000" }] }],
      outputs: [
        { address: payee, amount: [{ unit: "lovelace", quantity: "2000000" }, { unit: usdcx, quantity: "2000000" }] },
        { address: payer, amount: [{ unit: "lovelace", quantity: "5800000" }, { unit: usdcx, quantity: "3000000" }] },
      ],
    };
    expect(cardanoExactPaymentMatches(tokenEvidence, payer, payee, usdcx, "2000000")).toBe(true);
  });

  it("rejects token mint/burn leakage and unrelated native assets", () => {
    const mismatch: CardanoTransactionEvidence = {
      ...base,
      inputs: [{ address: payer, amount: [{ unit: "lovelace", quantity: "8000000" }, { unit: usdcx, quantity: "5000000" }] }],
      outputs: [
        { address: payee, amount: [{ unit: "lovelace", quantity: "2000000" }, { unit: usdcx, quantity: "2000000" }] },
        { address: payer, amount: [{ unit: "lovelace", quantity: "5800000" }, { unit: usdcx, quantity: "2000000" }] },
      ],
    };
    expect(cardanoExactPaymentMatches(mismatch, payer, payee, usdcx, "2000000")).toBe(false);
    expect(cardanoExactPaymentMatches({
      ...mismatch,
      outputs: [{ address: payee, amount: [{ unit: "lovelace", quantity: "2000000" }, { unit: usdcx, quantity: "2000000" }, { unit: `${"cd".repeat(28)}01`, quantity: "1" }] }],
    }, payer, payee, usdcx, "2000000")).toBe(false);
  });
});
