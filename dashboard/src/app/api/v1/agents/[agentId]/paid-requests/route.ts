import { z } from "zod";

import { createPaidRequest } from "@/domain/payment-service";
import { authorizeAgentRequest, boundedJson, handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ resourceUrl: z.string().url(), purpose: z.string().max(300).optional(), maxAmountAtomic: z.string().regex(/^\d+$/).optional() });

async function authorizeCaller(request: Request, agentId: string) {
  if (await authorizeAgentRequest(request, agentId, "payments:create")) return { authorized: true as const, rateSubject: `agent:${agentId}`, initiatedByUserId: undefined };
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return { authorized: false as const, response: problem(401, "UNAUTHORIZED", "A valid agent credential or signed-in operator is required.") };
  if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return { authorized: false as const, response: problem(403, "ROLE_REQUIRED", "Owner or Operator access is required to initiate a paid request.") };
  const ownedAgent = await db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id, status: { not: "ARCHIVED" } }, select: { id: true } });
  if (!ownedAgent) return { authorized: false as const, response: problem(404, "AGENT_NOT_FOUND", "Agent not found in the active workspace.") };
  return { authorized: true as const, rateSubject: `operator:${workspace.user.id}:${agentId}`, initiatedByUserId: workspace.user.id };
}

function paymentProblem(error: Error) {
  if (error.message.startsWith("PYTH_PROVIDER_") || error.message.startsWith("MASUMI_PROVIDER_") || error.message.startsWith("MASUMI_PAYMENT_INFORMATION_")) return problem(503, "PAYMENT_TRUST_PROVIDER_UNAVAILABLE", "A payment-critical external trust provider is unavailable. No spend was authorized.");
  const codes: Record<string, number> = {
    IDEMPOTENCY_CONFLICT: 409, POLICY_NOT_PUBLISHED: 409, RESOURCE_PRICE_NOT_FOUND: 404, MAX_AMOUNT_EXCEEDED: 422, RESOURCE_URL_UNSAFE: 422,
    LIVE_FACILITATOR_REQUIRED: 503, MANAGED_SIGNER_REQUIRED: 409, MANAGED_PAYER_MISMATCH: 409, MANAGED_SIGNER_NETWORK_UNSUPPORTED: 409, PAYMENT_ACCOUNT_UNAVAILABLE: 503,
    ORGANIZATION_KILL_SWITCH_ENABLED: 409, AGENT_NOT_ACTIVE: 409, PAYMENT_QUOTE_EXPIRED: 409, SPEND_RESERVATION_INVALID: 409, POLICY_CHANGED: 409, POLICY_NOT_ACTIVE: 409, POLICY_EXPIRED: 409,
    OUTSIDE_POLICY_SCHEDULE: 409, PAYMENT_CONTEXT_CHANGED_RETRY: 409, MASUMI_BINDING_CHANGED_RETRY: 409, ARC_ASSET_UNSUPPORTED: 409, EVM_ASSET_NETWORK_UNSUPPORTED: 409,
    HEDERA_TOKEN_ID_REQUIRED: 409, PAYMENT_NETWORK_UNSUPPORTED: 409, CARDANO_NETWORK_UNSUPPORTED: 409, CARDANO_ASSET_UNSUPPORTED: 409, CARDANO_PREPROD_USDCX_ASSET_ID_REQUIRED: 503,
    CARDANO_MAINNET_USDCX_ASSET_ID_REQUIRED: 503, PROVIDER_SETTLEMENT_NOT_VERIFIED: 409, PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED: 409, PLATFORM_MAINNET_PAYEE_NOT_CONFIGURED: 503,
    PLATFORM_ARC_PAYEE_NOT_CONFIGURED: 503, PLATFORM_CARDANO_PREPROD_PAYEE_NOT_CONFIGURED: 503, PLATFORM_CARDANO_MAINNET_PAYEE_NOT_CONFIGURED: 503, PLATFORM_PROVIDER_NETWORK_UNSUPPORTED: 409,
    X402_RESOURCE_MISMATCH: 422, X402_REQUIREMENT_MISMATCH: 422, SETTLEMENT_NETWORK_MISMATCH: 502, PYTH_VALUATION_REQUIRED: 503, PYTH_PRICE_STALE: 503, PYTH_PRICE_FROM_FUTURE: 503,
    PYTH_CONFIDENCE_TOO_WIDE: 503, PYTH_PRICE_NON_POSITIVE: 503, PYTH_ADA_USD_FEED_ID_REQUIRED: 503, PYTH_USDC_USD_FEED_ID_REQUIRED: 503, PYTH_ASSET_UNSUPPORTED: 409,
    MASUMI_RESOURCE_NOT_BOUND: 409, MASUMI_SETTLEMENT_ADDRESS_REQUIRED: 409, MASUMI_POLICY_NETWORK_MISMATCH: 409, MASUMI_RESOURCE_NETWORK_MISMATCH: 409, MASUMI_AGENT_NOT_ALLOWED: 403,
    MASUMI_CAPABILITY_NOT_ALLOWED: 403, MASUMI_AGENT_NOT_VERIFIED: 409, MASUMI_AGENT_AMBIGUOUS: 409, MASUMI_AGENT_OFFLINE: 409, MASUMI_RESOURCE_URL_MISMATCH: 409,
    MASUMI_SELLER_WALLET_NETWORK_MISMATCH: 409, MASUMI_SELLER_PAYMENT_KEY_MISMATCH: 409, CARDANO_PAYMENT_KEY_CREDENTIAL_REQUIRED: 409, CARDANO_ADDRESS_NETWORK_MISMATCH: 409,
    MASUMI_PAYMENT_INFORMATION_IDENTITY_MISMATCH: 409, MASUMI_PAYMENT_INFORMATION_REGISTRY_MISMATCH: 409, MASUMI_PAYMENT_INFORMATION_URL_MISMATCH: 409,
  };
  const status = codes[error.message];
  return status ? problem(status, error.message, error.message.replaceAll("_", " ").toLowerCase()) : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const key = request.headers.get("idempotency-key");
  if (!key || key.length < 8 || key.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
  try {
    const { agentId } = await params;
    const caller = await authorizeCaller(request, agentId);
    if (!caller.authorized) return caller.response;
    const rate = await enforceRateLimit(request, { scope: "agent-paid-request", subject: caller.rateSubject, limit: 60, windowMs: 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const result = await createPaidRequest(agentId, key, schema.parse(await boundedJson(request)), { initiatedByUserId: caller.initiatedByUserId });
    return ok(result, { status: result.status === "APPROVAL_PENDING" ? 202 : 200 });
  } catch (error) {
    if (error instanceof Error) { const mapped = paymentProblem(error); if (mapped) return mapped; }
    return handleApiError(error);
  }
}
