import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-auth", () => ({
  createSessionResponse: vi.fn(async (_user: unknown, location: URL | string) =>
    new Response(null, { status: 303, headers: { location: location.toString(), "set-cookie": "agentpay_session=test" } })
  ),
  supabaseAuthConfig: () => ({ url: "https://example.supabase.co", key: "test-anon-key" }),
}));
vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, retryAfterSeconds: 900 })),
}));

import { createSessionResponse } from "@/lib/supabase-auth";
import { POST } from "./route";

const createSessionResponseMock = vi.mocked(createSessionResponse);

describe("six-digit email OTP verification", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    createSessionResponseMock.mockClear();
  });

  it("verifies the code and creates the platform session", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        email: "operator@example.com",
        token: "123456",
        type: "email",
      });
      return Response.json({ user: { id: "user-1", email: "operator@example.com" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.set("email", "operator@example.com");
    form.set("token", "123456");
    const response = await POST(new Request("http://localhost:3100/api/v1/auth/otp/verify", {
      method: "POST",
      body: form,
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3100/app/overview");
    expect(createSessionResponseMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid or expired code", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));

    const response = await POST(new Request("http://localhost:3100/api/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@example.com", token: "123456" }),
    }));

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("OTP_INVALID");
    expect(createSessionResponseMock).not.toHaveBeenCalled();
  });

  it("requires exactly six numeric digits", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(new Request("http://localhost:3100/api/v1/auth/otp/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "operator@example.com", token: "12ab" }),
    }));

    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
