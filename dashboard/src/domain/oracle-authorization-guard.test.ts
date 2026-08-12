import { describe, expect, it } from "vitest";

import { assertOracleAuthorizationStillConservative } from "@/domain/oracle-authorization-guard";
import type { OracleValuation } from "@/domain/catalyst-policy";

function valuation(usdMicros: bigint, feedId = "0x" + "a".repeat(64)): OracleValuation {
  return {
    usdMicros,
    observation: {
      feedId,
      price: 1_000_000n,
      confidence: 1_000n,
      exponent: -6,
      publishTime: 1_700_000_000,
    },
  };
}

describe("approved oracle valuation guard", () => {
  it("accepts an equal or lower current conservative valuation", () => {
    expect(() => assertOracleAuthorizationStillConservative({ authorizedUsdMicros: 1_000_000n, authorizedFeedId: "0x" + "a".repeat(64), current: valuation(1_000_000n) })).not.toThrow();
    expect(() => assertOracleAuthorizationStillConservative({ authorizedUsdMicros: 1_000_000n, authorizedFeedId: "0x" + "a".repeat(64), current: valuation(900_000n) })).not.toThrow();
  });

  it("rejects a valuation increase after authorization", () => {
    expect(() => assertOracleAuthorizationStillConservative({ authorizedUsdMicros: 1_000_000n, authorizedFeedId: "0x" + "a".repeat(64), current: valuation(1_000_001n) })).toThrow("PYTH_VALUATION_INCREASED_AFTER_AUTHORIZATION");
  });

  it("rejects an oracle feed identity change after authorization", () => {
    expect(() => assertOracleAuthorizationStillConservative({ authorizedUsdMicros: 1_000_000n, authorizedFeedId: "0x" + "a".repeat(64), current: valuation(900_000n, "0x" + "b".repeat(64)) })).toThrow("PYTH_FEED_CHANGED_AFTER_AUTHORIZATION");
  });
});
