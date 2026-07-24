import { z } from "zod";
import { handleApiError, ok, problem, requestBody } from "@/lib/api";
import { supabaseAuthConfig } from "@/lib/supabase-auth";

const schema = z.object({
  email: z.string().email(),
  mode: z.enum(["otp", "magiclink"]).default("otp")
});

export async function POST(request: Request) {
  try {
    const input = schema.parse(await requestBody(request));
    const config = supabaseAuthConfig();
    const redirectTo = new URL("/auth/complete", request.url).toString();
    const endpoint = new URL(`${config.url}/auth/v1/otp`);
    endpoint.searchParams.set("redirect_to", redirectTo);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { apikey: config.key, "content-type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        create_user: true,
        data: { requested_auth_mode: input.mode },
        gotrue_meta_security: {}
      })
    });
    if (!response.ok) return problem(502, "EMAIL_AUTH_FAILED", "Supabase could not send the sign-in email.");
    return ok({ sent: true, email: input.email, mode: input.mode });
  } catch (error) { return handleApiError(error); }
}
