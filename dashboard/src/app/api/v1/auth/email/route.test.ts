import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-auth", () => ({
  supabaseAuthConfig: () => ({ url: "https://example.supabase.co", key: "test-anon-key" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => ({ allowed: true, remaining: 4, retryAfterSeconds: 900 })),
}));

import { POST } from "./route";

describe("passwordless email delivery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["otp", "magiclink"] as const)("requests a Supabase email for %s mode", async (mode) => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        email: "operator@example.com",
        create_user: true,
        data: { requested_auth_mode: mode },
      });
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost:3100/api/v1/auth/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@example.com", mode }),
    }));
    const body = await response.json();
    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ sent: true, email: "operator@example.com", mode });
    expect(requestedUrl.pathname).toBe("/auth/v1/otp");
    expect(requestedUrl.searchParams.get("redirect_to")).toBe("http://localhost:3100/auth/complete");
  });

  it("reports an upstream delivery failure without claiming an email was sent", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 429 })));

    const response = await POST(new Request("http://localhost:3100/api/v1/auth/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@example.com", mode: "otp" }),
    }));

    expect(response.status).toBe(429);
    expect((await response.json()).code).toBe("EMAIL_RATE_LIMITED");
  });
});
