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

  it("exchanges a Supabase code using the browser-bound PKCE verifier and matching state", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ auth_code: "auth-code", code_verifier: "v".repeat(43) });
      return Response.json({ user: { id: "user-1", email: "operator@example.com" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = "state-token";
    const response = await GET(new Request(
      `http://localhost:3100/api/v1/auth/oauth/callback?code=auth-code&state=${state}`,
      { headers: { cookie: `agentpay_oauth=${"v".repeat(43)}.${state}` } }
    ));

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(createSessionResponseMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3100/app/overview");
    expect(response.headers.getSetCookie()).toContain("agentpay_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  it("rejects callbacks without the verifier cookie", async () => {
    const response = await GET(new Request(
      "http://localhost:3100/api/v1/auth/oauth/callback?code=auth-code&state=state-token"
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3100/sign-in?error=oauth_state");
  });

  it("rejects callbacks when OAuth state does not match the browser cookie", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(
      "http://localhost:3100/api/v1/auth/oauth/callback?code=auth-code&state=attacker-state",
      { headers: { cookie: `agentpay_oauth=${"v".repeat(43)}.expected-state` } }
    ));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createSessionResponseMock).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3100/sign-in?error=oauth_state");
  });
});
