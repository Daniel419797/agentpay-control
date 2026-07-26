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

describe("magic-link callback", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    createSessionResponseMock.mockClear();
  });

  it("verifies the token hash and creates a platform session", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ token_hash: "token-hash", type: "email" });
      return Response.json({ user: { id: "user-1", email: "operator@example.com" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(new Request(
      "http://localhost:3100/api/v1/auth/callback?token_hash=token-hash&type=email"
    ));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3100/app/overview");
    expect(createSessionResponseMock).toHaveBeenCalledOnce();
  });

  it("rejects missing and invalid links without creating a session", async () => {
    const missing = await GET(new Request("http://localhost:3100/api/v1/auth/callback"));
    expect(missing.headers.get("location")).toBe("http://localhost:3100/sign-in?error=invalid_link");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    const invalid = await GET(new Request(
      "http://localhost:3100/api/v1/auth/callback?token_hash=expired&type=email"
    ));
    expect(invalid.headers.get("location")).toBe("http://localhost:3100/sign-in?error=verification_failed");
    expect(createSessionResponseMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported verification types before contacting Supabase", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET(new Request(
      "http://localhost:3100/api/v1/auth/callback?token_hash=token-hash&type=unexpected"
    ));
    expect(response.headers.get("location")).toBe("http://localhost:3100/sign-in?error=invalid_link");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
