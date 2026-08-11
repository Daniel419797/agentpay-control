import { describe, expect, it } from "vitest";
import { assertCardanoPaymentCredential, cardanoPaymentCredentialHash } from "@/lib/cardano-address";

const PREPROD_ADDRESS = "addr_test1qp36k4sz488z5he0cut7awr5m2fajm9kkqcex5p963zgpgmkksh55zaw47shfy92nyaa3usf6ly7an8gfl8ktdhhv85s6zhl4v";
const PAYMENT_KEY_HASH = "63ab5602a9ce2a5f2fc717eeb874da93d96cb6b031935025d44480a3";

describe("Cardano payment credential binding", () => {
  it("extracts the published verification-key hash from a Preprod base address", () => {
    expect(cardanoPaymentCredentialHash(PREPROD_ADDRESS, "Preprod")).toBe(PAYMENT_KEY_HASH);
    expect(assertCardanoPaymentCredential(PREPROD_ADDRESS, "Preprod", PAYMENT_KEY_HASH)).toBe(PAYMENT_KEY_HASH);
  });

  it("rejects the wrong network and a mismatched seller key", () => {
    expect(() => cardanoPaymentCredentialHash(PREPROD_ADDRESS, "Mainnet")).toThrow("CARDANO_ADDRESS_NETWORK_MISMATCH");
    expect(() => assertCardanoPaymentCredential(PREPROD_ADDRESS, "Preprod", "00".repeat(28))).toThrow("MASUMI_SELLER_PAYMENT_KEY_MISMATCH");
  });
});
