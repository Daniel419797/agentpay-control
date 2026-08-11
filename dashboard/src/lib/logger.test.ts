import { afterEach, describe, expect, it, vi } from "vitest";
import { logError } from "@/lib/logger";

describe("structured logger redaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("recursively redacts credential-shaped fields without hiding transaction evidence", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logError("PAYMENT_FAILED", new Error("request failed with Bearer top-secret-token"), {
      authorization: "Bearer another-secret",
      nested: {
        apiKey: "api-secret",
        privateKey: "1".repeat(64),
        transactionId: "a".repeat(64),
        endpoint: "https://api.example/path?token=sensitive&network=cardano",
      },
      atomicAmount: 1000000n,
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, any>;
    expect(payload.authorization).toBe("[REDACTED]");
    expect(payload.nested.apiKey).toBe("[REDACTED]");
    expect(payload.nested.privateKey).toBe("[REDACTED]");
    expect(payload.nested.transactionId).toBe("a".repeat(64));
    expect(payload.nested.endpoint).not.toContain("sensitive");
    expect(payload.atomicAmount).toBe("1000000");
    expect(payload.error.message).not.toContain("top-secret-token");
  });

  it("handles circular structures instead of crashing error reporting", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fields: Record<string, unknown> = {};
    fields.self = fields;
    expect(() => logError("CIRCULAR", new Error("failed"), fields)).not.toThrow();
    expect(String(spy.mock.calls[0][0])).toContain("[Circular]");
  });
});
