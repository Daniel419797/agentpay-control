import { z } from "zod";
import { handleApiError, problem, rateLimitProblem, requestBody } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSessionResponse, supabaseAuthConfig, type SupabaseUser } from "@/lib/supabase-auth";

const schema = z.object({ email: z.string().email(), token: z.string().regex(/^\d{6}$/) });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await requestBody(request));
    const rate = await enforceRateLimit(request, { scope: "auth-otp", subject: input.email.toLowerCase(), limit: 10, windowMs: 15 * 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const config = supabaseAuthConfig();
    const response = await fetch(`${config.url}/auth/v1/verify`, {
      method: "POST",
      headers: { apikey: config.key, "content-type": "application/json" },
      body: JSON.stringify({ email: input.email, token: input.token, type: "email" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return problem(401, "OTP_INVALID", "That verification code is invalid or has expired.");
    const data = await response.json() as { user: SupabaseUser };
    return createSessionResponse(data.user, new URL("/app/overview", request.url));
  } catch (error) { return handleApiError(error); }
}
