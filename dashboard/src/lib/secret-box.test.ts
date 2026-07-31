import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCipheriv, createHash } from "node:crypto";

describe("secret box", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.KEY_ENCRYPTION_MASTER_KEY = Buffer.alloc(32, 7).toString("base64url");
  });

  it("encrypts authenticated secrets and rejects tampering", async () => {
    const { decryptSecret, encryptSecret } = await import("@/lib/secret-box");
    const encrypted = encryptSecret("webhook-secret");
    expect(encrypted).not.toContain("webhook-secret");
    expect(decryptSecret(encrypted)).toBe("webhook-secret");
    expect(() => decryptSecret(`${encrypted.slice(0, -1)}A`)).toThrow();
  });

  it("decrypts legacy v1 ciphertext during key-format migration", async () => {
    const master = process.env.KEY_ENCRYPTION_MASTER_KEY!;
    const iv = Buffer.alloc(12, 3);
    const cipher = createCipheriv("aes-256-gcm", createHash("sha256").update(master).digest(), iv);
    const encrypted = Buffer.concat([cipher.update("legacy-secret", "utf8"), cipher.final()]);
    const fixture = ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(":");
    const { decryptSecret } = await import("@/lib/secret-box");
    expect(decryptSecret(fixture)).toBe("legacy-secret");
  });
});
