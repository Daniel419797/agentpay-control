import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

describe("API edge protections", () => {
  it("adds a request correlation ID", async () => {
    const response = await proxy(new NextRequest("http://localhost:3100/api/v1/health"));
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("preserves a valid caller request ID", async () => {
    const response = await proxy(new NextRequest("http://localhost:3100/api/v1/health", {
      headers: { "x-request-id": "job_123" },
    }));
    expect(response.headers.get("x-request-id")).toBe("job_123");
  });

  it("rejects cookie-authenticated mutations without a same-origin Origin", async () => {
    const response = await proxy(new NextRequest("http://localhost:3100/api/v1/agents", {
      method: "POST",
      headers: { cookie: "agentpay_session=opaque" },
    }));
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("CSRF_REJECTED");
  });

  it("allows non-cookie service mutations through to route authentication", async () => {
    const response = await proxy(new NextRequest("http://localhost:3100/api/v1/agents/abc/paid-requests", {
      method: "POST",
      headers: { authorization: "Bearer service-token" },
    }));
    expect(response.status).toBe(200);
  });
});
