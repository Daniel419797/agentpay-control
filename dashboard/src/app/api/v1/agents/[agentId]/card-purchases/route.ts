import { z } from "zod";

import { createAutonomousCardPurchase, listAutonomousCardPurchases } from "@/domain/card-autonomy-service";
import { authorizeAgentRequest, boundedJson, handleApiError, ok, problem, rateLimitProblem } from "@/lib/api";
import { db } from "@/lib/db";
import { enforceRateLimit } from "@/lib/rate-limit";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const createSchema = z.object({
  virtualCardId: z.string().uuid().optional(),
  merchantUrl: z.string().url().max(4_096),
  amountMinor: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  merchantCategory: z.string().min(1).max(80).optional(),
  merchantCountry: z.string().length(2).transform((value) => value.toUpperCase()).optional(),
  purpose: z.string().min(1).max(300).optional(),
  checkoutPlan: z.unknown(),
}).strict();

async function authorizeCaller(request: Request, agentId: string, scope: "payments:create" | "payments:read") {
  if (await authorizeAgentRequest(request, agentId, scope)) return { authorized: true as const, rateSubject: `agent:${agentId}`, initiatedByUserId: undefined };
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return { authorized: false as const, response: problem(401, "UNAUTHORIZED", "A valid agent credential or signed-in workspace member is required.") };
  const roles = scope === "payments:create" ? ["OWNER", "OPERATOR"] as const : ["OWNER", "OPERATOR", "APPROVER", "VIEWER"] as const;
  if (!workspaceHasRole(workspace, [...roles])) return { authorized: false as const, response: problem(403, "ROLE_REQUIRED", "The active workspace role cannot perform this card-purchase operation.") };
  const ownedAgent = await db.agent.findFirst({ where: { id: agentId, organizationId: workspace.organization.id, status: { not: "ARCHIVED" } }, select: { id: true } });
  if (!ownedAgent) return { authorized: false as const, response: problem(404, "AGENT_NOT_FOUND", "Agent not found in the active workspace.") };
  return { authorized: true as const, rateSubject: `operator:${workspace.user.id}:${agentId}`, initiatedByUserId: workspace.user.id };
}

function mappedError(error: Error) {
  if (error.message.startsWith("CARD_PURCHASE_POLICY_DENIED:")) return problem(403, "CARD_PURCHASE_POLICY_DENIED", "The requested card purchase is outside the agent's autonomous spending policy.", { reasons: error.message.split(":").slice(1).join(":").split(",").filter(Boolean) });
  const codes: Record<string, [number, string]> = {
    VIRTUAL_CARDS_DISABLED: [503, "Virtual cards are disabled in this environment."],
    AGENT_NOT_FOUND: [404, "Agent not found."],
    CARD_NOT_ASSIGNED_TO_AGENT: [404, "The requested card is not assigned to this agent."],
    ACTIVE_AGENT_CARD_NOT_FOUND: [409, "The agent does not have an active virtual card."],
    VIRTUAL_CARD_ID_REQUIRED: [422, "This agent has multiple active cards; virtualCardId is required."],
    ORGANIZATION_NOT_ACTIVE: [409, "The organization is not active."],
    ORGANIZATION_KILL_SWITCH_ENABLED: [409, "The organization emergency stop is active."],
    AGENT_NOT_ACTIVE: [409, "The agent is not active."],
    CARD_NOT_ACTIVE: [409, "The assigned card is not active."],
    CARD_CURRENCY_MISMATCH: [422, "The requested currency does not match the assigned card."],
    CARD_AUTONOMY_DISABLED: [403, "Autonomous spending is disabled for this card."],
    CARD_PURCHASE_AMOUNT_INVALID: [422, "The purchase amount must be positive."],
    IDEMPOTENCY_CONFLICT: [409, "The idempotency key was already used for a different card purchase."],
    RESOURCE_URL_UNSAFE: [422, "The merchant URL is unsafe."],
    RESOURCE_URL_HTTPS_REQUIRED: [422, "Production card checkout requires HTTPS."],
    RESOURCE_URL_PRIVATE_NETWORK: [422, "Private-network checkout destinations are not allowed."],
    CHECKOUT_SUCCESS_URL_UNSAFE: [422, "The checkout success URL is unsafe."],
    CHECKOUT_SUCCESS_HOST_MISMATCH: [422, "The checkout success URL must remain on the merchant host or a related subdomain."],
  };
  const mapped = codes[error.message];
  return mapped ? problem(mapped[0], error.message, mapped[1]) : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
  try {
    const { agentId } = await params;
    const caller = await authorizeCaller(request, agentId, "payments:create");
    if (!caller.authorized) return caller.response;
    const rate = await enforceRateLimit(request, { scope: "agent-card-purchase", subject: caller.rateSubject, limit: 30, windowMs: 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const input = createSchema.parse(await boundedJson(request, 64 * 1024));
    const result = await createAutonomousCardPurchase(agentId, idempotencyKey, input, { initiatedByUserId: caller.initiatedByUserId });
    return ok(result, { status: result.purchase.status === "APPROVAL_PENDING" ? 202 : result.existing ? 200 : 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error) { const mapped = mappedError(error); if (mapped) return mapped; }
    return handleApiError(error);
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const caller = await authorizeCaller(request, agentId, "payments:read");
    if (!caller.authorized) return caller.response;
    return ok(await listAutonomousCardPurchases(agentId), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
