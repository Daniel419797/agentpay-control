import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { consumeRateLimit, rateLimitKey } from "@/lib/rate-limit";

const createdKeys: string[] = [];

afterEach(async () => {
  await db.rateLimitBucket.deleteMany({ where: { key: { in: createdKeys.splice(0) } } });
});

describe("persistent rate limiting", () => {
  it("hashes subjects before persistence", () => {
    const key = rateLimitKey(new Request("https://agentpay.test"), "auth", "User@Example.com");
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain("User@Example.com");
  });

  it("does not trust a client-prepended forwarded address", () => {
    const spoofed = rateLimitKey(new Request("https://agentpay.test", { headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.7" } }), "auth");
    const canonical = rateLimitKey(new Request("https://agentpay.test", { headers: { "x-forwarded-for": "203.0.113.7" } }), "auth");
    expect(spoofed).toBe(canonical);
  });

  it("atomically denies requests over a shared bucket limit", async () => {
    const key = `test-${randomUUID()}`;
    createdKeys.push(key);
    expect(await consumeRateLimit(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 1 });
    expect(await consumeRateLimit(key, 2, 60_000)).toMatchObject({ allowed: true, remaining: 0 });
    expect(await consumeRateLimit(key, 2, 60_000)).toMatchObject({ allowed: false, remaining: 0 });
  });
});
