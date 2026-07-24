import { describe, expect, it } from "vitest";

import { extractSignatureMap } from "./wallet-signature-response";

describe("extractSignatureMap", () => {
  it("accepts the JSON-RPC wrapped response", () => {
    expect(extractSignatureMap({ result: { signatureMap: "wrapped-signature" } }))
      .toBe("wrapped-signature");
  });

  it("accepts HashPack's unwrapped response", () => {
    expect(extractSignatureMap({ signatureMap: "direct-signature" }))
      .toBe("direct-signature");
  });

  it("rejects missing and malformed signatures", () => {
    expect(extractSignatureMap(null)).toBeNull();
    expect(extractSignatureMap({ result: {} })).toBeNull();
    expect(extractSignatureMap({ signatureMap: 123 })).toBeNull();
  });
});
