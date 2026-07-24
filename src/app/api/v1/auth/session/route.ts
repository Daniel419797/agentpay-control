import { z } from "zod";
import { handleApiError, problem, requestBody } from "@/lib/api";
import { createSessionResponse, supabaseUserFromAccessToken } from "@/lib/supabase-auth";

const schema = z.object({ accessToken: z.string().min(20) });

export async function POST(request: Request) {
  try {
    const { accessToken } = schema.parse(await requestBody(request));
    const user = await supabaseUserFromAccessToken(accessToken);
    return createSessionResponse(user, new URL("/app/overview", request.url));
  } catch (error) {
    if (error instanceof Error && error.message === "SUPABASE_ACCESS_TOKEN_INVALID") return problem(401, "AUTH_TOKEN_INVALID", "The sign-in link is invalid or expired.");
    return handleApiError(error);
  }
}
