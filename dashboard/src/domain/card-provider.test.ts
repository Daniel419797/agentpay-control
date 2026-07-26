import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyStripeSignature } from "./card-provider";

describe("verifyStripeSignature", () => {
  it("accepts a valid current v1 signature", () => {
    const body = '{"id":"evt_123"}';
    const timestamp = 1_700_000_000;
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.${body}`).digest("hex");
    expect(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, "whsec_test", timestamp)).toBe(true);
  });

  it("rejects tampered, stale, and missing signatures", () => {
    const timestamp = 1_700_000_000;
    const signature = createHmac("sha256", "whsec_test").update(`${timestamp}.body`).digest("hex");
    expect(verifyStripeSignature("tampered", `t=${timestamp},v1=${signature}`, "whsec_test", timestamp)).toBe(false);
    expect(verifyStripeSignature("body", `t=${timestamp},v1=${signature}`, "whsec_test", timestamp + 301)).toBe(false);
    expect(verifyStripeSignature("body", null, "whsec_test", timestamp)).toBe(false);
  });
});
