import { describe, expect, it } from "vitest";
import { authorizationMatches, boundedJson, capabilityAuthorizationMatches, publicFailure, validateContractCall } from "./security.js";

const allowlist = [
  {
    contractId: "0.0.1234",
    selectors: ["0xa9059cbb"],
    maxGas: 100_000,
    maxPayableAtomic: "500"
  }
];

describe("facilitator authorization", () => {
  it("requires the exact bearer credential when an API key is configured", () => {
    expect(authorizationMatches("a".repeat(32), `Bearer ${"a".repeat(32)}`)).toBe(true);
    expect(authorizationMatches("a".repeat(32), `Bearer ${"b".repeat(32)}`)).toBe(false);
    expect(authorizationMatches("a".repeat(32), undefined)).toBe(false);
  });

  it("does not accept a credential assigned to another capability", () => {
    const signingKey = "s".repeat(32);
    const settlementKey = "v".repeat(32);
    expect(capabilityAuthorizationMatches(signingKey, undefined, `Bearer ${settlementKey}`)).toBe(false);
    expect(capabilityAuthorizationMatches(signingKey, undefined, `Bearer ${signingKey}`)).toBe(true);
  });
});

describe("facilitator request limits", () => {
  it("rejects oversized streamed JSON before complete buffering", async () => {
    await expect(
      boundedJson(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ value: "x".repeat(100) })
        }),
        32
      )
    ).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("never exposes internal error messages in public failures", () => {
    expect(publicFailure(new Error("provider secret: abc"), "SIGNING_FAILED", 500)).toEqual({
      code: "SIGNING_FAILED",
      status: 500,
    });
    expect(publicFailure(new Error("REQUEST_BODY_TOO_LARGE"), "SIGNING_FAILED", 500)).toEqual({
      code: "REQUEST_BODY_TOO_LARGE",
      status: 413,
    });
  });
});

describe("contract execution policy", () => {
  it("allows only matching selectors within gas and payable limits", () => {
    expect(
      validateContractCall(
        {
          contractId: "0.0.1234",
          functionSelector: "0xa9059cbb",
          calldata: "0xa9059cbb00",
          gas: 100_000,
          payableAtomic: "500"
        },
        allowlist
      )
    ).toBeNull();

    expect(
      validateContractCall(
        {
          contractId: "0.0.1234",
          functionSelector: "0xa9059cbb",
          calldata: "0xdeadbeef00",
          gas: 100_000,
          payableAtomic: "500"
        },
        allowlist
      )
    ).toBe("SELECTOR_CALLDATA_MISMATCH");

    expect(
      validateContractCall(
        {
          contractId: "0.0.9999",
          functionSelector: "0xa9059cbb",
          calldata: "0xa9059cbb00",
          gas: 100_000,
          payableAtomic: "500"
        },
        allowlist
      )
    ).toBe("CONTRACT_CALL_NOT_ALLOWLISTED");

    expect(
      validateContractCall(
        {
          contractId: "0.0.1234",
          functionSelector: "0xa9059cbb",
          calldata: "0xa9059cbb00",
          gas: 100_001,
          payableAtomic: "501"
        },
        allowlist
      )
    ).toBe("CONTRACT_CALL_LIMIT_EXCEEDED");
  });
});
