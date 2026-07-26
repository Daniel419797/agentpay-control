import { createOperatorSession, provisionSupabaseOperator, sessionCookie } from "@/lib/session";
import { getConfig } from "@/lib/config";

export type SupabaseUser = {
  id: string;
  email?: string;
  user_metadata?: { name?: string; full_name?: string };
};

export function supabaseAuthConfig() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = getConfig();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("SUPABASE_AUTH_NOT_CONFIGURED");
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}

export async function createSessionResponse(user: SupabaseUser, location: URL | string) {
  const operator = await provisionSupabaseOperator(user);
  const token = await createOperatorSession(operator);
  return new Response(null, {
    status: 303,
    headers: { location: location.toString(), "set-cookie": sessionCookie(token) }
  });
}

export async function supabaseUserFromAccessToken(accessToken: string) {
  const config = supabaseAuthConfig();
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.key, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("SUPABASE_ACCESS_TOKEN_INVALID");
  return response.json() as Promise<SupabaseUser>;
}
