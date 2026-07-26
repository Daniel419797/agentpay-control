import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { signedWebhookHeaders } from "@/domain/notification-service";

describe("notification signing", () => {
  it("signs the timestamp and exact raw body", () => {
    const headers = signedWebhookHeaders("event-1", "1753510000", '{"ok":true}', "secret");
    const expected = createHmac("sha256", "secret").update('1753510000.{"ok":true}').digest("hex");
    expect(headers["x-agentpay-signature"]).toBe(`v1=${expected}`);
    expect(headers["x-agentpay-event-id"]).toBe("event-1");
  });
});
