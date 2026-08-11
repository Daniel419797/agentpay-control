import { describe, expect, it } from "vitest";

import { createPinnedLookup, isPrivateAddress, validateResourceUrl } from "@/lib/safe-url";

describe("resource URL safety", () => {
  it.each([
    "127.0.0.1",
    "10.2.3.4",
    "172.20.1.2",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
    "fd00::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "0:0:0:0:0:ffff:7f00:1",
  ])("blocks non-public address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("requires HTTPS in production", () => {
    expect(() => validateResourceUrl("http://api.example.com/resource", true)).toThrow("RESOURCE_URL_HTTPS_REQUIRED");
  });

  it("allows local HTTP only outside production", () => {
    expect(validateResourceUrl("http://localhost:3200/resource", false).hostname).toBe("localhost");
    expect(() => validateResourceUrl("http://localhost:3200/resource", true)).toThrow();
  });

  it("rejects embedded credentials and fragments", () => {
    expect(() => validateResourceUrl("https://user:pass@example.com/resource", true)).toThrow("RESOURCE_URL_UNSAFE");
    expect(() => validateResourceUrl("https://example.com/resource#token", true)).toThrow("RESOURCE_URL_UNSAFE");
  });

  it("pins the validated address instead of resolving the hostname again", async () => {
    const lookup = createPinnedLookup({ address: "203.0.113.10", family: 4 });
    await new Promise<void>((resolve, reject) => lookup("attacker.example", { all: false }, (error, address, family) => {
      if (error) return reject(error);
      expect(address).toBe("203.0.113.10");
      expect(family).toBe(4);
      resolve();
    }));
  });
});
