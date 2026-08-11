import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ status: z.enum(["ACTIVE", "FROZEN", "CANCELED"]), expectedVersion: z.number().int().positive() });

export async function PATCH(request: Request, context: { params: Promise<{ cardId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing a card.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const { cardId } = await context.params;
    const input = schema.parse(await boundedJson(request));
    if (input.status === "ACTIVE" && !hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before reactivating a virtual card.");
    if (input.status === "ACTIVE" && workspace.organization.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The organization emergency stop is active. Cards may be frozen or canceled, but not activated.");
    const provider = getCardProvider();
    const updated = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`card-status:${cardId}`}, 0))`;
      if (input.status === "ACTIVE") {
        const organization = await tx.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
        if (!organization || organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
        if (organization.killSwitchEnabled) throw new Error("ORGANIZATION_KILL_SWITCH_ENABLED");
      }
      const card = await tx.virtualCard.findFirst({ where: { id: cardId, organizationId: workspace.organization.id } });
      if (!card) throw new Error("CARD_NOT_FOUND");
      if (card.status === "CANCELED") throw new Error("CARD_CANCELED");
      if (provider.name !== card.provider) throw new Error("CARD_PROVIDER_MISMATCH");
      if (card.version !== input.expectedVersion) throw new Error("CARD_VERSION_CONFLICT");
      await provider.updateCardStatus(card.externalCardId, input.status === "FROZEN" ? "INACTIVE" : input.status, `card-status:${card.id}:${input.expectedVersion}:${input.status}`);
      const result = await tx.virtualCard.updateMany({ where: { id: card.id, organizationId: workspace.organization.id, version: input.expectedVersion, status: { not: "CANCELED" } }, data: { status: input.status, version: { increment: 1 } } });
      if (result.count !== 1) throw new Error("CARD_VERSION_CONFLICT");
      const record = await tx.virtualCard.findUniqueOrThrow({ where: { id: card.id } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: `VIRTUAL_CARD_${input.status}`, targetType: "VIRTUAL_CARD", targetId: card.id, result: "SUCCESS", metadata: { previousStatus: card.status, version: record.version } } });
      return record;
    }, { timeout: 60_000 });
    const { externalCardId: _external, ...safe } = updated;
    void _external;
    return ok({ ...safe, spendingLimitMinor: safe.spendingLimitMinor?.toString() ?? null });
  } catch (error) {
    if (error instanceof Error && error.message === "CARD_NOT_FOUND") return problem(404, error.message, "The card was not found.");
    if (error instanceof Error && error.message === "CARD_CANCELED") return problem(409, error.message, "A canceled card cannot be reactivated.");
    if (error instanceof Error && error.message === "CARD_PROVIDER_MISMATCH") return problem(409, error.message, "The configured provider does not own this card.");
    if (error instanceof Error && error.message === "CARD_VERSION_CONFLICT") return problem(409, error.message, "The card changed while this request was in progress. Refresh and try again.");
    return handleApiError(error);
  }
}
