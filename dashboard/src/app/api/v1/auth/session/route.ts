import { z } from "zod";
import { handleApiError, problem, rateLimitProblem, requestBody } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createSessionResponse, supabaseUserFromAccessToken } from "@/lib/supabase-auth";

const schema = z.object({ accessToken: z.string().min(20).max(8_192) });

export async function POST(request: Request) {
  try {
    const rate = await enforceRateLimit(request, { scope: "auth-session-exchange-ip", limit: 30, windowMs: 15 * 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const { accessToken } = schema.parse(await requestBody(request));
    const user = await supabaseUserFromAccessToken(accessToken);
    return createSessionResponse(user, new URL("/app/overview", request.url));
  } catch (error) {
    if (error instanceof Error && error.message === "SUPABASE_ACCESS_TOKEN_INVALID") return problem(401, "AUTH_TOKEN_INVALID", "The sign-in link is invalid or expired.");
    return handleApiError(error);
  }
}
