import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ enabled: z.boolean(), reason: z.string().min(3).max(300) });

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing the kill switch.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing the organization kill switch.");
    const input = schema.parse(await boundedJson(request));
    const { organization, cardsToFreeze } = await db.$transaction(async (tx) => {
      const cards = input.enabled ? await tx.virtualCard.findMany({ where: { organizationId: workspace.organization.id, status: "ACTIVE" }, select: { id: true, provider: true, externalCardId: true, version: true } }) : [];
      const organization = await tx.organization.update({ where: { id: workspace.organization.id }, data: { killSwitchEnabled: input.enabled } });
      if (cards.length) await tx.virtualCard.updateMany({ where: { id: { in: cards.map((card) => card.id) }, status: "ACTIVE" }, data: { status: "FROZEN", version: { increment: 1 } } });
      await tx.auditEvent.create({ data: {
          organizationId: workspace.organization.id,
          actorType: "USER",
          actorId: workspace.user.id,
          action: input.enabled ? "KILL_SWITCH_ENABLED" : "KILL_SWITCH_DISABLED",
          targetType: "ORGANIZATION",
          targetId: workspace.organization.id,
          result: "SUCCESS",
          metadata: { reason: input.reason, cardsFrozen: cards.length },
        } });
      return { organization, cardsToFreeze: cards };
    });
    let providerSyncFailures = 0;
    if (input.enabled && cardsToFreeze.length) {
      const provider = getCardProvider();
      const owned = cardsToFreeze.filter((card) => card.provider === provider.name);
      const results = await Promise.allSettled(owned.map((card) => provider.updateCardStatus(card.externalCardId, "INACTIVE", `kill-switch:${workspace.organization.id}:${card.id}:${card.version}`)));
      providerSyncFailures = results.filter((result) => result.status === "rejected").length + (cardsToFreeze.length - owned.length);
      if (providerSyncFailures) await db.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "SYSTEM", action: "KILL_SWITCH_CARD_PROVIDER_SYNC_FAILED", targetType: "ORGANIZATION", targetId: workspace.organization.id, result: "FAILURE", metadata: { failedCards: providerSyncFailures } } });
    }
    return ok({ ...organization, cardsFrozen: cardsToFreeze.length, providerSyncFailures, reactivationRequired: !input.enabled });
  } catch (error) {
    return handleApiError(error);
  }
}
