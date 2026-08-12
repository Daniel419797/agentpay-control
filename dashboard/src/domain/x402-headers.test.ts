import { describe, expect, it } from "vitest";

import { decodeX402Header, encodeX402Header } from "@/domain/x402-headers";

describe("x402 v2 header codec", () => {
  const payload = { x402Version: 2, accepted: { network: "hedera:testnet" }, payload: { transaction: "signed" } };

  it("round-trips Base64 JSON headers", () => {
    const encoded = encodeX402Header(payload);
    expect(encoded).not.toContain("{");
    expect(decodeX402Header(encoded)).toEqual(payload);
  });

  it("temporarily accepts legacy raw JSON headers", () => {
    expect(decodeX402Header(JSON.stringify(payload))).toEqual(payload);
  });

  it("rejects invalid and oversized header data", () => {
    expect(() => decodeX402Header("not-json-and-not-base64-json")).toThrow("X402_HEADER_INVALID");
    expect(() => decodeX402Header("A".repeat(10_000), 32)).toThrow("X402_HEADER_TOO_LARGE");
  });
});
