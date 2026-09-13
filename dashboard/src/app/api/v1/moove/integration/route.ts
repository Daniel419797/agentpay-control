import { z } from "zod";

import {
  connectMooveIntegration,
  disconnectMooveIntegration,
  getMooveIntegrationSummary,
} from "@/domain/moove-integration-service";
import { boundedJson, handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { MooveProviderError } from "@/lib/moove";
import { enforceRateLimit } from "@/lib/rate-limit";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const connectSchema = z.object({
  apiKey: z.string().regex(/^\S{16,4096}$/),
  settlement: z.object({
    network: z.string().regex(/^\S{1,120}$/),
    symbol: z.string().regex(/^\S{1,32}$/),
    decimals: z.number().int().min(0).max(255),
  }).optional(),
});

function integrationError(error: unknown) {
  if (error instanceof Error) {
    const status: Record<string, number> = {
      MOOVE_RECEIVE_DISABLED: 503,
      MOOVE_API_KEY_INVALID: 422,
      MOOVE_SETTLEMENT_CONFIG_INVALID: 422,
      MOOVE_SETTLEMENT_CONFIG_INCOMPLETE: 422,
      MOOVE_SETTLEMENT_DECIMALS_INVALID: 422,
      MOOVE_SETTLEMENT_TOKEN_MISMATCH: 409,
      MOOVE_CREDENTIAL_ALREADY_BOUND: 409,
      MOOVE_ACTIVE_LINKS_EXIST: 409,
      MOOVE_INTEGRATION_SECRET_INVALID: 503,
      MOOVE_INTEGRATION_NOT_CONFIGURED: 409,
    };
    if (status[error.message]) return problem(status[error.message]!, error.message, error.message.replaceAll("_", " ").toLowerCase());
  }
  if (error instanceof MooveProviderError) {
    if (["UNAUTHENTICATED", "INVALID_API_KEY", "EXPIRED_API_KEY", "INSUFFICIENT_API_SCOPE"].includes(error.code)) {
      return problem(422, "MOOVE_CREDENTIAL_INVALID", "The Moove API key is invalid, expired, or missing the required payment-link scopes.");
    }
    return problem(503, "MOOVE_PROVIDER_UNAVAILABLE", "Moove could not validate the integration right now.");
  }
  return null;
}

function requireOwner(workspace: Awaited<ReturnType<typeof workspaceFromRequest>>) {
  return Boolean(workspace && workspaceHasRole(workspace, ["OWNER", "PROVIDER_ADMIN"]) && hasRecentAuthentication(workspace.session));
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing the Moove integration.");
    if (!workspaceHasRole(workspace, ["OWNER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Owner or provider-admin access is required.");
    return ok(await getMooveIntegrationSummary(workspace.organization.id));
  } catch (error) {
    return integrationError(error) ?? handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before connecting Moove.");
    if (!requireOwner(workspace)) return problem(403, "STEP_UP_REQUIRED", "Owner or provider-admin access with recent authentication is required to connect a payment credential.");

    const rate = await enforceRateLimit(request, { scope: "moove-integration-write", subject: `workspace:${workspace.organization.id}`, limit: 5, windowMs: 10 * 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);

    const input = connectSchema.parse(await boundedJson(request, 16 * 1024));
    return ok(await connectMooveIntegration({ organizationId: workspace.organization.id, actorId: workspace.user.id, apiKey: input.apiKey, settlement: input.settlement }), { status: 200 });
  } catch (error) {
    return integrationError(error) ?? handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before disconnecting Moove.");
    if (!requireOwner(workspace)) return problem(403, "STEP_UP_REQUIRED", "Owner or provider-admin access with recent authentication is required to disconnect a payment credential.");

    const rate = await enforceRateLimit(request, { scope: "moove-integration-write", subject: `workspace:${workspace.organization.id}`, limit: 5, windowMs: 10 * 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);

    return ok(await disconnectMooveIntegration(workspace.organization.id, workspace.user.id));
  } catch (error) {
    return integrationError(error) ?? handleApiError(error);
  }
}
