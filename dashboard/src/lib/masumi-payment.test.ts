import { describe, expect, it } from "vitest";
import { masumiInputHash, masumiPaymentConfigFromEnv, masumiResultHash } from "@/lib/masumi-payment";

describe("Masumi escrow client", () => {
  it("hashes canonical input deterministically", () => {
    expect(masumiInputHash({ b: 2, a: 1 })).toBe(masumiInputHash({ a: 1, b: 2 }));
    expect(masumiInputHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes exact UTF-8 result bytes", () => {
    expect(masumiResultHash("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("requires HTTPS and distinct registry/payment credentials in production", () => {
    const key = "a".repeat(32);
    expect(() => masumiPaymentConfigFromEnv({ APP_ENV: "production", MASUMI_PAYMENT_URL: "http://payments.example.com", MASUMI_PAYMENT_API_KEY: key })).toThrow("MASUMI_PAYMENT_HTTPS_REQUIRED");
    expect(() => masumiPaymentConfigFromEnv({ APP_ENV: "production", MASUMI_PAYMENT_URL: "https://payments.example.com", MASUMI_PAYMENT_API_KEY: key, MASUMI_REGISTRY_API_KEY: key })).toThrow("MASUMI_REGISTRY_PAYMENT_KEYS_MUST_BE_DISTINCT");
    expect(masumiPaymentConfigFromEnv({ APP_ENV: "production", MASUMI_PAYMENT_URL: "https://payments.example.com", MASUMI_PAYMENT_API_KEY: key, MASUMI_REGISTRY_API_KEY: "b".repeat(32) }).baseUrl).toBe("https://payments.example.com");
  });
});
