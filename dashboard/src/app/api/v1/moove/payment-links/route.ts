import { z } from "zod";

import { createMooveReceivePayment, listLocalMoovePaymentLinks } from "@/domain/moove-receive-service";
import { authorizeAgentRequest, boundedJson, handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { db } from "@/lib/db";
import { MooveProviderError } from "@/lib/moove";
import { enforceRateLimit } from "@/lib/rate-limit";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const createSchema = z.object({
  agentId: z.string().uuid().optional(),
  resourceListingId: z.string().uuid().optional(),
  invoiceId: z.string().uuid().optional(),
  toAmount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).max(100),
  description: z.string().trim().max(450).optional(),
  maxUsage: z.number().int().min(1).max(2_147_483_647).optional(),
  expirationDate: z.string().datetime({ offset: true }).optional(),
});

const localStatuses = ["CREATING", "ACTIVE", "COMPLETED", "INACTIVE", "SUBMISSION_UNKNOWN", "FAILED"] as const;

function mooveProblem(error: Error) {
  const statuses: Record<string, number> = {
    MOOVE_RECEIVE_DISABLED: 503,
    MOOVE_API_KEY_REQUIRED: 503,
    MOOVE_ACCOUNT_ORGANIZATION_ID_REQUIRED: 503,
    MOOVE_TIMEOUT_INVALID: 503,
    MOOVE_MAX_RECONCILE_PAGES_INVALID: 503,
    MOOVE_SETTLEMENT_CONFIG_INCOMPLETE: 503,
    MOOVE_SETTLEMENT_DECIMALS_INVALID: 503,
    MOOVE_HTTPS_REQUIRED: 503,
    MOOVE_PRODUCTION_HOST_INVALID: 503,
    MOOVE_ORGANIZATION_NOT_CONFIGURED: 409,
    MOOVE_RESOURCE_NOT_OWNED: 404,
    MOOVE_INVOICE_NOT_PAYABLE: 409,
    MOOVE_INVOICE_AGENT_MISMATCH: 403,
    MOOVE_INVOICE_MAX_USAGE_REQUIRED: 422,
    MOOVE_SETTLEMENT_CONFIG_REQUIRED: 409,
    MOOVE_INVOICE_ASSET_MISMATCH: 409,
    MOOVE_INVOICE_AMOUNT_MISMATCH: 422,
    MOOVE_AMOUNT_INVALID: 422,
    MOOVE_AMOUNT_PRECISION_INVALID: 422,
    MOOVE_MAX_USAGE_INVALID: 422,
    MOOVE_EXPIRATION_INVALID: 422,
    MOOVE_DESCRIPTION_TOO_LONG: 422,
    MOOVE_SETTLEMENT_TOKEN_MISMATCH: 409,
    IDEMPOTENCY_CONFLICT: 409,
  };
  if (statuses[error.message]) return problem(statuses[error.message]!, error.message, error.message.replaceAll("_", " ").toLowerCase());
  if (error instanceof MooveProviderError) {
    if (["PAYMENT_LINK_ACCOUNT_NOT_READY", "INVALID_PAYMENT_LINK_AMOUNT"].includes(error.code)) {
      return problem(error.status === 422 ? 422 : 409, error.code, error.message);
    }
    if (["UNAUTHENTICATED", "INVALID_API_KEY", "EXPIRED_API_KEY", "INSUFFICIENT_API_SCOPE"].includes(error.code)) {
      return problem(503, "MOOVE_PROVIDER_CONFIGURATION_ERROR", "The Moove integration is not correctly authenticated or scoped.");
    }
    return problem(503, "MOOVE_PROVIDER_UNAVAILABLE", "Moove could not complete the request. AgentPay preserved the payment state for reconciliation.");
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing Moove payment links.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "APPROVER", "VIEWER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Workspace access is required.");
    const url = new URL(request.url);
    const statusValue = url.searchParams.get("status") || undefined;
    if (statusValue && !localStatuses.includes(statusValue as (typeof localStatuses)[number])) return problem(422, "VALIDATION_ERROR", "Invalid Moove payment-link status filter.");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || "50"), 1), 100);
    const offset = Math.max(Number(url.searchParams.get("offset") || "0"), 0);
    if (!Number.isInteger(limit) || !Number.isInteger(offset)) return problem(422, "VALIDATION_ERROR", "Pagination values must be integers.");
    const rows = await listLocalMoovePaymentLinks({
      organizationId: workspace.organization.id,
      status: statusValue as (typeof localStatuses)[number] | undefined,
      limit,
      offset,
    });
    return ok({ data: rows, limit, offset, nextOffset: rows.length === limit ? offset + limit : null });
  } catch (error) {
    if (error instanceof Error) {
      const mapped = mooveProblem(error);
      if (mapped) return mapped;
    }
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const input = createSchema.parse(await boundedJson(request, 32 * 1024));

    let organizationId: string;
    let actorType: "USER" | "AGENT";
    let actorId: string;
    let rateSubject: string;

    if (input.agentId && await authorizeAgentRequest(request, input.agentId, "payments:create")) {
      const agent = await db.agent.findFirst({ where: { id: input.agentId, status: { not: "ARCHIVED" } }, select: { organizationId: true } });
      if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found.");
      organizationId = agent.organizationId;
      actorType = "AGENT";
      actorId = input.agentId;
      rateSubject = `agent:${input.agentId}`;
    } else {
      const workspace = await workspaceFromRequest(request);
      if (!workspace) return problem(401, "UNAUTHORIZED", "A valid agent credential or signed-in operator is required.");
      if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.");
      if (input.agentId) {
        const agent = await db.agent.findFirst({ where: { id: input.agentId, organizationId: workspace.organization.id, status: { not: "ARCHIVED" } }, select: { id: true } });
        if (!agent) return problem(404, "AGENT_NOT_FOUND", "Agent not found in the active workspace.");
      }
      organizationId = workspace.organization.id;
      actorType = "USER";
      actorId = workspace.user.id;
      rateSubject = `operator:${workspace.user.id}`;
    }

    const rate = await enforceRateLimit(request, { scope: "moove-payment-link-create", subject: rateSubject, limit: 30, windowMs: 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);

    const row = await createMooveReceivePayment({
      organizationId,
      idempotencyKey,
      toAmount: input.toAmount,
      description: input.description,
      maxUsage: input.maxUsage,
      expirationDate: input.expirationDate,
      agentId: input.agentId,
      resourceListingId: input.resourceListingId,
      invoiceId: input.invoiceId,
      actorType,
      actorId,
    });
    const pending = row.providerStatus === "CREATING" || row.providerStatus === "SUBMISSION_UNKNOWN";
    return ok(row, { status: pending ? 202 : 201 });
  } catch (error) {
    if (error instanceof Error) {
      const mapped = mooveProblem(error);
      if (mapped) return mapped;
    }
    return handleApiError(error);
  }
}
