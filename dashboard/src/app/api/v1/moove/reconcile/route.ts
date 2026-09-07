import { timingSafeEqual } from "node:crypto";

import { reconcileMooveReceive } from "@/domain/moove-receive-service";
import { handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { mooveConfigFromEnv, MooveProviderError } from "@/lib/moove";
import { enforceRateLimit } from "@/lib/rate-limit";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

function bearerMatches(request: Request, expected: string | undefined) {
  if (!expected || expected.length < 32) return false;
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

function mappedError(error: unknown) {
  if (error instanceof Error && error.message === "MOOVE_ORGANIZATION_NOT_CONFIGURED") return problem(409, error.message, "Moove is not configured for the active workspace.");
  if (error instanceof Error && ["MOOVE_RECEIVE_DISABLED", "MOOVE_API_KEY_REQUIRED", "MOOVE_ACCOUNT_ORGANIZATION_ID_REQUIRED"].includes(error.message)) return problem(503, error.message, "Moove Receive is not configured for this deployment.");
  if (error instanceof MooveProviderError) return problem(503, "MOOVE_PROVIDER_UNAVAILABLE", "Moove reconciliation could not complete. Existing local state was preserved.");
  return handleApiError(error);
}

/** Vercel/external schedulers invoke GET with Authorization: Bearer $CRON_SECRET. */
export async function GET(request: Request) {
  try {
    if (!bearerMatches(request, process.env.CRON_SECRET)) return problem(401, "CRON_AUTH_REQUIRED", "A valid cron credential is required.");
    const config = mooveConfigFromEnv();
    return ok(await reconcileMooveReceive(config.organizationId));
  } catch (error) {
    return mappedError(error);
  }
}

/** Operators may trigger reconciliation explicitly; cron credentials are also accepted. */
export async function POST(request: Request) {
  try {
    const config = mooveConfigFromEnv();
    if (bearerMatches(request, process.env.CRON_SECRET)) return ok(await reconcileMooveReceive(config.organizationId));

    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "A valid operator session or cron credential is required.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
    const rate = await enforceRateLimit(request, { scope: "moove-reconcile", subject: `operator:${workspace.user.id}`, limit: 10, windowMs: 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    return ok(await reconcileMooveReceive(workspace.organization.id));
  } catch (error) {
    return mappedError(error);
  }
}
