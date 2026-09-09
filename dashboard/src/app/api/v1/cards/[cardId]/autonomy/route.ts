import { z } from "zod";

import { putCardAutonomyPolicySafely } from "@/domain/card-autonomy-execution";
import { getCardAutonomyPolicy } from "@/domain/card-autonomy-repository";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { normalizeHostPattern } from "@/lib/card-checkout-plan";
import { getCardExecutorConfig } from "@/lib/card-executor-config";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  mode: z.enum(["DISABLED", "APPROVAL_REQUIRED", "LIMITED", "MERCHANT_ALLOWLIST", "BROAD"]),
  perPurchaseAutoLimitMinor: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n).nullable().default(null),
  overLimitAction: z.enum(["DENY", "REQUIRE_APPROVAL"]).default("REQUIRE_APPROVAL"),
  allowedHosts: z.array(z.string().min(1).max(253)).max(100).default([]),
  deniedHosts: z.array(z.string().min(1).max(253)).max(100).default([]),
  requirePurpose: z.boolean().default(true),
  maxCheckoutSeconds: z.number().int().min(10).max(120).default(90),
}).strict();

function normalizeHosts(values: string[]) {
  return [...new Set(values.map(normalizeHostPattern))].sort();
}

export async function GET(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing card autonomy settings.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "APPROVER", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Card access is required.");
    const { cardId } = await params;
    const card = await db.virtualCard.findFirst({ where: { id: cardId, organizationId: workspace.organization.id }, select: { id: true, agentId: true } });
    if (!card) return problem(404, "CARD_NOT_FOUND", "Card not found.");
    const policy = await getCardAutonomyPolicy(card.id);
    return ok(policy ?? { virtualCardId: card.id, agentId: card.agentId, mode: "DISABLED", perPurchaseAutoLimitMinor: null, overLimitAction: "REQUIRE_APPROVAL", allowedHosts: [], deniedHosts: [], requirePurpose: true, maxCheckoutSeconds: 90, version: 0 });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ cardId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing card autonomy settings.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required to change autonomous card spending.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing autonomous card spending.");
    const { cardId } = await params;
    const card = await db.virtualCard.findFirst({ where: { id: cardId, organizationId: workspace.organization.id }, select: { id: true, agentId: true, status: true, provider: true } });
    if (!card) return problem(404, "CARD_NOT_FOUND", "Card not found.");
    const input = schema.parse(await boundedJson(request));
    const allowedHosts = normalizeHosts(input.allowedHosts);
    const deniedHosts = normalizeHosts(input.deniedHosts);
    const overlap = allowedHosts.find((allowed) => deniedHosts.includes(allowed));
    if (overlap) return problem(422, "CARD_AUTONOMY_HOST_CONFLICT", "A host pattern cannot be both allowed and denied.", { host: overlap });
    if (input.mode === "MERCHANT_ALLOWLIST" && !allowedHosts.length) return problem(422, "CARD_AUTONOMY_ALLOWLIST_REQUIRED", "Merchant allowlist mode requires at least one allowed host.");
    if (input.mode === "LIMITED" && input.perPurchaseAutoLimitMinor === null) return problem(422, "CARD_AUTONOMY_LIMIT_REQUIRED", "Limited autonomy requires a per-purchase autonomous limit.");
    if (input.mode !== "DISABLED") {
      const config = getConfig();
      const executor = getCardExecutorConfig();
      if (!config.VIRTUAL_CARDS_ENABLED || config.CARD_PROVIDER !== "STRIPE" || card.provider !== "STRIPE") return problem(409, "AUTONOMOUS_CARD_PROVIDER_UNAVAILABLE", "Autonomous card checkout requires an enabled Stripe Issuing card rail.");
      if (!executor.CARD_EXECUTOR_ENABLED || !executor.CARD_EXECUTOR_SHARED_SECRET) return problem(503, "CARD_EXECUTOR_NOT_READY", "The isolated card executor is not configured for this environment.");
      if (card.status !== "ACTIVE") return problem(409, "CARD_NOT_ACTIVE", "Activate the card before enabling autonomous spending.");
    }
    const policy = await putCardAutonomyPolicySafely({ ...input, allowedHosts, deniedHosts, virtualCardId: card.id, organizationId: workspace.organization.id, agentId: card.agentId, actorUserId: workspace.user.id });
    return ok(policy, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "CARD_AUTONOMY_HOST_INVALID") return problem(422, error.message, "One or more merchant host patterns are invalid.");
    return handleApiError(error);
  }
}
