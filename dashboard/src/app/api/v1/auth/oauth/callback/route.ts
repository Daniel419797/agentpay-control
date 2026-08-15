import { createSessionResponse, supabaseAuthConfig, type SupabaseUser } from "@/lib/supabase-auth";

function authFailureCode(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  if (message.includes("SUPABASE_AUTH_NOT_CONFIGURED")) return "auth_config";
  if (message.includes("EMAXCONNSESSION") || message.includes("max clients reached") || message.includes("P2039")) return "database_busy";
  return "sign_in_failed";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const signInError = (error: string) => new Response(null, { status: 303, headers: { location: new URL(`/sign-in?error=${error}`, request.url).toString() } });
  try {
    const code = url.searchParams.get("code");
    const isSecure = url.protocol === "https:";
    const cookieName = isSecure ? "__Host-agentpay_oauth" : "agentpay_oauth";
    const verifier = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`))?.[1];
    const secure = isSecure ? "; Secure" : "";
    const clearCookie = `${cookieName}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`;
    if (!code || !verifier) {
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
    return signInError(authFailureCode(err));
  }
}
