import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-auth", () => ({
  supabaseAuthConfig: () => ({ url: "https://example.supabase.co", key: "test-anon-key" }),
}));

import { GET } from "./route";

describe("Google OAuth start", () => {
  it("binds PKCE and OAuth state to an HttpOnly cookie", async () => {
    const response = await GET(new Request("http://localhost:3100/api/v1/auth/oauth/google"));
    const location = new URL(response.headers.get("location")!);
    const cookie = response.headers.get("set-cookie")!;
    const state = location.searchParams.get("state");
    const stored = /^agentpay_oauth=([^;]+);/.exec(cookie)?.[1];
    const separator = stored?.lastIndexOf(".") ?? -1;
    const verifier = separator > 0 ? stored?.slice(0, separator) : undefined;
    const storedState = separator > 0 ? stored?.slice(separator + 1) : undefined;

    expect(response.status).toBe(303);
    expect(location.origin).toBe("https://example.supabase.co");
    expect(location.pathname).toBe("/auth/v1/authorize");
    expect(location.searchParams.get("provider")).toBe("google");
    expect(location.searchParams.get("redirect_to")).toBe("http://localhost:3100/api/v1/auth/oauth/callback");
    expect(location.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get("code_challenge_method")).toBe("s256");
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(storedState).toBe(state);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("marks the verifier cookie Secure on HTTPS", async () => {
    const response = await GET(new Request("https://agentpay.example/api/v1/auth/oauth/google"));
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toMatch(/^__Host-agentpay_oauth=/);
  });
});
