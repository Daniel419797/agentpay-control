import { createSessionResponse, supabaseAuthConfig, type SupabaseUser } from "@/lib/supabase-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") ?? "email";
  const allowedTypes = new Set(["email", "signup", "invite", "recovery", "email_change"]);
  if (!tokenHash || !allowedTypes.has(type)) return Response.redirect(new URL("/sign-in?error=invalid_link", request.url), 303);
  const config = supabaseAuthConfig();
  const verified = await fetch(`${config.url}/auth/v1/verify`, {
    method: "POST",
    headers: { apikey: config.key, "content-type": "application/json" },
    body: JSON.stringify({ token_hash: tokenHash, type }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!verified.ok) return Response.redirect(new URL("/sign-in?error=verification_failed", request.url), 303);
  const data = await verified.json() as { user: SupabaseUser };
  return createSessionResponse(data.user, new URL("/app/overview", request.url));
}
