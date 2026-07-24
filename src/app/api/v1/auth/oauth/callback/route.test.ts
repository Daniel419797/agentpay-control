import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase-auth", () => ({
  createSessionResponse: vi.fn(async (_user: unknown, location: URL | string) =>
    new Response(null, { status: 303, headers: { location: location.toString(), "set-cookie": "agentpay_session=test" } })
  ),
  supabaseAuthConfig: () => ({ url: "https://example.supabase.co", key: "test-anon-key" }),
}));

import { createSessionResponse } from "@/lib/supabase-auth";
import { GET } from "./route";

const createSessionResponseMock = vi.mocked(createSessionResponse);

describe("Google OAuth callback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    createSessionResponseMock.mockClear();
  });

  it("exchanges a Supabase code using the browser-bound PKCE verifier", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ auth_code: "auth-code", code_verifier: "v".repeat(43) });
      return Response.json({ user: { id: "user-1", email: "operator@example.com" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(
      "http://localhost:3100/api/v1/auth/oauth/callback?code=auth-code",
      { headers: { cookie: `agentpay_oauth=${"v".repeat(43)}` } }
    ));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(createSessionResponseMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3100/app/overview");
    expect(response.headers.getSetCookie()).toContain("agentpay_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  it("rejects callbacks without the verifier cookie", async () => {
    const response = await GET(new Request(
      "http://localhost:3100/api/v1/auth/oauth/callback?code=auth-code"
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3100/sign-in?error=oauth_state");
  });
});
