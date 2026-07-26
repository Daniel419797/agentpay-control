import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-auth", () => ({
  supabaseAuthConfig: () => ({ url: "https://example.supabase.co", key: "test-anon-key" }),
}));

import { GET } from "./route";

describe("Google OAuth start", () => {
  it("uses Supabase-owned state and binds PKCE to an HttpOnly cookie", async () => {
    const response = await GET(new Request("http://localhost:3100/api/v1/auth/oauth/google"));
    const location = new URL(response.headers.get("location")!);
    const cookie = response.headers.get("set-cookie")!;

    expect(response.status).toBe(303);
    expect(location.origin).toBe("https://example.supabase.co");
    expect(location.pathname).toBe("/auth/v1/authorize");
    expect(location.searchParams.get("provider")).toBe("google");
    expect(location.searchParams.get("redirect_to")).toBe("http://localhost:3100/api/v1/auth/oauth/callback");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    expect(location.searchParams.has("state")).toBe(false);
    expect(cookie).toMatch(/^agentpay_oauth=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("marks the verifier cookie Secure on HTTPS", async () => {
    const response = await GET(new Request("https://agentpay.example/api/v1/auth/oauth/google"));
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
