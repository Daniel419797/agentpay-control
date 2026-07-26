import { describe, expect, it, vi } from "vitest";

import { retrySerializable } from "@/lib/retry";

describe("retrySerializable", () => {
  it("retries serialization conflicts", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }))
      .mockResolvedValue("ok");
    await expect(retrySerializable(operation)).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated failures", async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error("invalid"), { code: "P2002" }));
    await expect(retrySerializable(operation)).rejects.toThrow("invalid");
    expect(operation).toHaveBeenCalledOnce();
  });
});
