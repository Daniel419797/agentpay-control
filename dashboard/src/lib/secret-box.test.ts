import { beforeEach, describe, expect, it, vi } from "vitest";

describe("secret box", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.KEY_ENCRYPTION_MASTER_KEY = "test-master-key-with-at-least-32-characters";
  });

  it("encrypts authenticated secrets and rejects tampering", async () => {
    const { decryptSecret, encryptSecret } = await import("@/lib/secret-box");
    const encrypted = encryptSecret("webhook-secret");
    expect(encrypted).not.toContain("webhook-secret");
    expect(decryptSecret(encrypted)).toBe("webhook-secret");
    expect(() => decryptSecret(`${encrypted.slice(0, -1)}A`)).toThrow();
  });
});
