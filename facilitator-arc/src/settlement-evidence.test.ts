import { describe, expect, it } from "vitest";
import type { Hex } from "viem";
import { SettlementEvidenceScope } from "./evm-facilitator.js";

const HASH_A = `0x${"a".repeat(64)}` as Hex;
const HASH_B = `0x${"b".repeat(64)}` as Hex;

describe("SettlementEvidenceScope", () => {
  it("keeps transaction evidence isolated across concurrent settlements", async () => {
    const scope = new SettlementEvidenceScope();
    let releaseA!: () => void;
    const waitForA = new Promise<void>((resolve) => { releaseA = resolve; });

    const first = scope.capture(async () => {
      scope.record(HASH_A);
      await waitForA;
      return "first";
    });

    const second = scope.capture(async () => {
      scope.record(HASH_B);
      releaseA();
      return "second";
    });

    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ result: "first", transactionId: HASH_A });
    expect(b).toEqual({ result: "second", transactionId: HASH_B });
  });

  it("retains submitted evidence when settlement throws", async () => {
    const scope = new SettlementEvidenceScope();
    const failure = new Error("receipt timeout");

    const captured = await scope.capture(async () => {
      scope.record(HASH_A);
      throw failure;
    });

    expect(captured.transactionId).toBe(HASH_A);
    expect(captured.error).toBe(failure);
    expect("result" in captured).toBe(false);
  });
});
