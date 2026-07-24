import { createHash, randomBytes } from "node:crypto";
import { supabaseAuthConfig } from "@/lib/supabase-auth";

export async function GET(request: Request) {
  const config = supabaseAuthConfig();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const callback = new URL("/api/v1/auth/oauth/callback", request.url);
  const authorize = new URL(`${config.url}/auth/v1/authorize`);
  authorize.searchParams.set("provider", "google");
  authorize.searchParams.set("redirect_to", callback.toString());
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "s256");
  return new Response(null, {
    status: 303,
    headers: {
      location: authorize.toString(),
      "set-cookie": `agentpay_oauth=${verifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    }
  });
}
