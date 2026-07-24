import { createHash } from "node:crypto";

export type FingerprintInput = {
  network: string;
  scheme: string;
  payerAccountId: string;
  payeeAccountId: string;
  assetId: string;
  amountAtomic: string;
  resourceUrl: string;
  validUntil: string;
};

export function paymentFingerprint(input: FingerprintInput) {
  const canonical = [
    input.network.trim().toLowerCase(),
    input.scheme.trim().toLowerCase(),
    input.payerAccountId.trim(),
    input.payeeAccountId.trim(),
    input.assetId.trim(),
    BigInt(input.amountAtomic).toString(),
    new URL(input.resourceUrl).toString(),
    new Date(input.validUntil).toISOString()
  ].join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}
