import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const interval = z.enum(["per_authorization", "daily", "weekly", "monthly", "yearly", "all_time"]);
const createSchema = z.object({
  agentId: z.string().uuid(),
  cardholderProfileId: z.string().uuid(),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  nickname: z.string().min(1).max(60).optional(),
  spendingLimitMinor: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n).optional(),
  spendingInterval: interval.optional(),
  allowedCategories: z.array(z.string().regex(/^[a-z0-9_]{2,80}$/)).max(100).default([]),
  blockedCategories: z.array(z.string().regex(/^[a-z0-9_]{2,80}$/)).max(100).default([]),
  allowedCountries: z.array(z.string().length(2).transform((value) => value.toUpperCase())).max(249).default([]),
}).superRefine((value, context) => {
  if (Boolean(value.spendingLimitMinor) !== Boolean(value.spendingInterval)) context.addIssue({ code: "custom", message: "spendingLimitMinor and spendingInterval must be provided together" });
  if (value.allowedCategories.some((category) => value.blockedCategories.includes(category))) context.addIssue({ code: "custom", message: "A category cannot be both allowed and blocked" });
});

function safeCard<T extends { externalCardId: string }>(card: T) {
  const { externalCardId: _externalId, ...safe } = card;
  void _externalId;
  return { ...safe, spendingLimitMinor: "spendingLimitMinor" in safe && safe.spendingLimitMinor ? String(safe.spendingLimitMinor) : null };
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing cards.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Card access is required.");
    const cards = await db.virtualCard.findMany({ where: { organizationId: workspace.organization.id }, include: { agent: { select: { id: true, name: true } }, cardholder: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } });
    return ok(cards.map(safeCard));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!getConfig().VIRTUAL_CARDS_ENABLED) return problem(503, "VIRTUAL_CARDS_DISABLED", "Virtual cards are not enabled in this environment.");
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before issuing a card.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const input = createSchema.parse(await boundedJson(request));
    const [agent, cardholder] = await Promise.all([
      db.agent.findFirst({ where: { id: input.agentId, organizationId: workspace.organization.id, status: { not: "ARCHIVED" } } }),
      db.cardholderProfile.findFirst({ where: { id: input.cardholderProfileId, organizationId: workspace.organization.id, status: "ACTIVE" } }),
    ]);
    if (!agent) return problem(404, "AGENT_NOT_FOUND", "The agent was not found in this organization.");
    if (!cardholder) return problem(404, "CARDHOLDER_NOT_FOUND", "An active cardholder was not found in this organization.");
    if (new Set(input.allowedCategories).size !== input.allowedCategories.length || new Set(input.blockedCategories).size !== input.blockedCategories.length || new Set(input.allowedCountries).size !== input.allowedCountries.length) return problem(422, "DUPLICATE_CONTROL", "Spending-control entries must be unique.");
    const provider = getCardProvider();
    if (provider.name !== cardholder.provider) return problem(409, "CARD_PROVIDER_MISMATCH", "The cardholder belongs to a different configured provider.");
    const external = await provider.issueVirtualCard({ cardholderId: cardholder.externalCardholderId, currency: input.currency, spendingLimitMinor: input.spendingLimitMinor, spendingInterval: input.spendingInterval, allowedCategories: input.allowedCategories, blockedCategories: input.blockedCategories, allowedCountries: input.allowedCountries, idempotencyKey: `card:${workspace.organization.id}:${idempotencyKey}` });
    const card = await db.$transaction(async (tx) => {
      const record = await tx.virtualCard.upsert({
        where: { provider_externalCardId: { provider: provider.name, externalCardId: external.id } },
        update: {},
        create: { organizationId: workspace.organization.id, agentId: agent.id, cardholderProfileId: cardholder.id, provider: provider.name, externalCardId: external.id, status: external.status, currency: external.currency, last4: external.last4, brand: external.brand, expMonth: external.expMonth, expYear: external.expYear, nickname: input.nickname, spendingLimitMinor: input.spendingLimitMinor, spendingInterval: input.spendingInterval, allowedCategories: input.allowedCategories, blockedCategories: input.blockedCategories, allowedCountries: input.allowedCountries },
      });
      if (record.organizationId !== workspace.organization.id) throw new Error("PROVIDER_ID_TENANT_COLLISION");
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "VIRTUAL_CARD_ISSUED", targetType: "VIRTUAL_CARD", targetId: record.id, result: "SUCCESS", metadata: { provider: provider.name, agentId: agent.id, currency: record.currency, last4: record.last4 } } });
      return record;
    });
    return ok(safeCard(card), { status: 201 });
  } catch (error) { return handleApiError(error); }
}
