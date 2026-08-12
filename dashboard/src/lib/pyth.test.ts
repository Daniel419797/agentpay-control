import { describe, expect, it } from "vitest";

import { assertPythObservation, pythConfigFromEnv, pythFeedForSymbol, usdMicrosForAtomic } from "@/lib/pyth";

const ADA_FEED = `0x${"a".repeat(64)}`;
const USDC_FEED = `0x${"b".repeat(64)}`;
const TEST_ENV = { NODE_ENV: "test" as const };

describe("Pyth policy valuation", () => {
  it("requires authenticated production configuration", () => {
    expect(() => pythConfigFromEnv({ ...TEST_ENV, APP_ENV: "production", PYTH_ADA_USD_FEED_ID: ADA_FEED, PYTH_USDC_USD_FEED_ID: USDC_FEED })).toThrow("PYTH_API_KEY_REQUIRED");
    const config = pythConfigFromEnv({ ...TEST_ENV, APP_ENV: "production", PYTH_API_KEY: "x".repeat(32), PYTH_ADA_USD_FEED_ID: ADA_FEED, PYTH_USDC_USD_FEED_ID: USDC_FEED });
    expect(pythFeedForSymbol("ADA", config)).toBe(ADA_FEED);
    expect(pythFeedForSymbol("USDCx", config)).toBe(USDC_FEED);
  });

  it("rejects stale and low-confidence observations", () => {
    const observation = { feedId: ADA_FEED, price: 50_000_000n, confidence: 1_000_000n, exponent: -8, publishTime: 1000 };
    expect(() => assertPythObservation(observation, { maxAgeSeconds: 30, maxConfidenceBps: 250, nowSeconds: 1100 })).toThrow("PYTH_PRICE_STALE");
    expect(() => assertPythObservation(observation, { maxAgeSeconds: 300, maxConfidenceBps: 100, nowSeconds: 1010 })).toThrow("PYTH_CONFIDENCE_TOO_WIDE");
    expect(() => assertPythObservation(observation, { maxAgeSeconds: 300, maxConfidenceBps: 250, nowSeconds: 1010 })).not.toThrow();
  });

  it("uses the confidence upper bound and rounds spend upward", () => {
    // $0.50 ADA with a $0.01 confidence interval, 2 ADA => $1.02.
    const observation = { feedId: ADA_FEED, price: 50_000_000n, confidence: 1_000_000n, exponent: -8, publishTime: 1000 };
    expect(usdMicrosForAtomic("2000000", 6, observation)).toBe(1_020_000n);

    // Fractional micro-dollar values round up rather than understate spend.
    const tiny = { feedId: ADA_FEED, price: 1n, confidence: 0n, exponent: -8, publishTime: 1000 };
    expect(usdMicrosForAtomic("1", 6, tiny)).toBe(1n);
  });
});
