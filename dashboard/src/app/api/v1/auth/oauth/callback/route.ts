import { createSessionResponse, supabaseAuthConfig, type SupabaseUser } from "@/lib/supabase-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const signInError = (error: string) => new Response(null, { status: 303, headers: { location: new URL(`/sign-in?error=${error}`, request.url).toString() } });
  try {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const isSecure = url.protocol === "https:";
    const cookieName = isSecure ? "__Host-agentpay_oauth" : "agentpay_oauth";
    const stored = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`))?.[1];
    const separator = stored?.lastIndexOf(".") ?? -1;
    const verifier = separator > 0 ? stored?.slice(0, separator) : stored;
    const expectedState = separator > 0 ? stored?.slice(separator + 1) : undefined;
    const secure = isSecure ? "; Secure" : "";
    const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
    if (!code || !verifier || (expectedState && state !== expectedState)) {
      return new Response(null, { status: 303, headers: { location: new URL("/sign-in?error=oauth_state", request.url).toString(), "set-cookie": clearCookie } });
    }
    const config = supabaseAuthConfig();
    const response = await fetch(`${config.url}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: { apikey: config.key, "content-type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return new Response(null, { status: 303, headers: { location: new URL("/sign-in?error=google_failed", request.url).toString(), "set-cookie": clearCookie } });
    const data = await response.json() as { user: SupabaseUser };
    const result = await createSessionResponse(data.user, new URL("/app/overview", request.url));
    result.headers.append("set-cookie", clearCookie);
    return result;
  } catch (err) {
    console.error("[oauth/callback] Auth flow failed:", err);
    return signInError("auth_config");
  }
}
