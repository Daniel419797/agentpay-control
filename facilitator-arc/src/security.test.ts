import { describe, expect, it } from "vitest";
import { authorizationMatches, boundedJson, validateContractCall } from "./security.js";

const allowlist = [
  {
    contractAddress: "0x3600000000000000000000000000000000000000",
    selectors: ["0xa9059cbb"],
    maxGas: 100_000,
    maxPayableAtomic: "500",
  },
];

describe("arc facilitator authorization", () => {
  it("requires the exact bearer credential when an API key is configured", () => {
    expect(authorizationMatches("a".repeat(32), `Bearer ${"a".repeat(32)}`)).toBe(true);
    expect(authorizationMatches("a".repeat(32), `Bearer ${"b".repeat(32)}`)).toBe(false);
    expect(authorizationMatches("a".repeat(32), undefined)).toBe(false);
  });
});

describe("arc facilitator request limits", () => {
  it("rejects oversized streamed JSON before complete buffering", async () => {
    await expect(
      boundedJson(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ value: "x".repeat(100) }),
        }),
        32,
      ),
    ).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });
});

describe("arc contract execution policy", () => {
  it("validates EVM contract addresses and function selectors", () => {
    expect(
      validateContractCall(
        {
          contractAddress: "0x3600000000000000000000000000000000000000",
          functionSelector: "0xa9059cbb",
          calldata: "0xa9059cbb00",
          gas: 100_000,
          payableAtomic: "500",
        },
        allowlist,
      ),
    ).toBeNull();

    expect(
      validateContractCall(
        {
          contractAddress: "0x3600000000000000000000000000000000000000",
          functionSelector: "0xa9059cbb",
          calldata: "0xdeadbeef00",
          gas: 100_000,
          payableAtomic: "500",
        },
        allowlist,
      ),
    ).toBe("SELECTOR_CALLDATA_MISMATCH");

    expect(
      validateContractCall(
        {
          contractAddress: "0x0000000000000000000000000000000000000000",
          functionSelector: "0xa9059cbb",
          calldata: "0xa9059cbb00",
          gas: 100_000,
          payableAtomic: "500",
        },
        allowlist,
      ),
    ).toBe("CONTRACT_CALL_NOT_ALLOWLISTED");

    expect(
      validateContractCall(
        {
          contractAddress: "0x3600000000000000000000000000000000000000",
          functionSelector: "0xa9059cbb",
          calldata: "0xa9059cbb00",
          gas: 100_001,
          payableAtomic: "501",
        },
        allowlist,
      ),
    ).toBe("CONTRACT_CALL_LIMIT_EXCEEDED");
  });
});
