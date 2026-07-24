import { createSessionResponse, supabaseAuthConfig, type SupabaseUser } from "@/lib/supabase-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = request.headers.get("cookie")?.match(/(?:^|;\s*)agentpay_oauth=([^;]+)/)?.[1];
  const separator = stored?.lastIndexOf(".") ?? -1;
  const verifier = separator > 0 ? stored?.slice(0, separator) : stored;
  const expectedState = separator > 0 ? stored?.slice(separator + 1) : undefined;
  // Supabase owns the hosted OAuth state value. PKCE is bound to this browser
  // through the HttpOnly, SameSite verifier cookie. Older cookies may also
  // contain an AgentPay state suffix, which is still validated when present.
  if (!code || !verifier || (expectedState && state !== expectedState)) return Response.redirect(new URL("/sign-in?error=oauth_state", request.url), 303);
  const config = supabaseAuthConfig();
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: { apikey: config.key, "content-type": "application/json" },
    body: JSON.stringify({ auth_code: code, code_verifier: verifier })
  });
  if (!response.ok) return Response.redirect(new URL("/sign-in?error=google_failed", request.url), 303);
  const data = await response.json() as { user: SupabaseUser };
  const result = await createSessionResponse(data.user, new URL("/app/overview", request.url));
  result.headers.append("set-cookie", "agentpay_oauth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  return result;
}
