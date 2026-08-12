import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ status: z.enum(["ACTIVE", "FROZEN", "CANCELED"]), expectedVersion: z.number().int().positive() });

type ProviderMutation = {
  organizationId: string;
  userId: string;
  cardId: string;
  externalCardId: string;
  previousStatus: string;
  requestedStatus: "ACTIVE" | "FROZEN" | "CANCELED";
  expectedVersion: number;
};

async function recordProviderDivergence(mutation: ProviderMutation, containment: "REFROZEN" | "REFREEZE_FAILED" | "NOT_REQUIRED", cause: unknown) {
  try {
    await db.$transaction(async (tx) => {
      const incident = await tx.supportCase.upsert({
        where: { organizationId_sourceType_sourceId: { organizationId: mutation.organizationId, sourceType: "VIRTUAL_CARD", sourceId: mutation.cardId } },
        create: {
          organizationId: mutation.organizationId,
          createdBy: mutation.userId,
          sourceType: "VIRTUAL_CARD",
          sourceId: mutation.cardId,
          category: "CARD_PROVIDER_STATE_DIVERGENCE",
          severity: "URGENT",
          title: "Card provider and AgentPay state require reconciliation",
          description: `The provider accepted a ${mutation.requestedStatus} transition but AgentPay could not finalize the local state. Previous local state: ${mutation.previousStatus}. Containment: ${containment}. Verify the provider state before any further card operation.`,
        },
        update: {
          status: "OPEN",
          severity: "URGENT",
          title: "Card provider and AgentPay state require reconciliation",
          description: `The provider accepted a ${mutation.requestedStatus} transition but AgentPay could not finalize the local state. Previous local state: ${mutation.previousStatus}. Containment: ${containment}. Verify the provider state before any further card operation.`,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: mutation.organizationId,
          actorType: "SYSTEM",
          action: "VIRTUAL_CARD_PROVIDER_STATE_DIVERGENCE",
          targetType: "VIRTUAL_CARD",
          targetId: mutation.cardId,
          result: "FAILURE",
          metadata: { previousStatus: mutation.previousStatus, requestedStatus: mutation.requestedStatus, expectedVersion: mutation.expectedVersion, containment },
        },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: mutation.organizationId,
          eventType: "VIRTUAL_CARD_PROVIDER_STATE_DIVERGENCE",
          aggregateType: "SUPPORT_CASE",
          aggregateId: incident.id,
          payload: { cardId: mutation.cardId, requestedStatus: mutation.requestedStatus, containment, severity: "URGENT" },
        },
      });
    });
  } catch (incidentError) {
    logError("card_provider_divergence_incident_failed", incidentError, { cardId: mutation.cardId, requestedStatus: mutation.requestedStatus, containment, originalError: cause instanceof Error ? cause.message : String(cause) });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ cardId: string }> }) {
  const providerMutationRef: { current: ProviderMutation | null } = { current: null };
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
      providerMutationRef.current = {
        organizationId: workspace.organization.id,
        userId: workspace.user.id,
        cardId: card.id,
        externalCardId: card.externalCardId,
        previousStatus: card.status,
        requestedStatus: input.status,
        expectedVersion: input.expectedVersion,
      };
      const result = await tx.virtualCard.updateMany({ where: { id: card.id, organizationId: workspace.organization.id, version: input.expectedVersion, status: { not: "CANCELED" } }, data: { status: input.status, version: { increment: 1 } } });
      if (result.count !== 1) throw new Error("CARD_VERSION_CONFLICT");
      const record = await tx.virtualCard.findUniqueOrThrow({ where: { id: card.id } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: `VIRTUAL_CARD_${input.status}`, targetType: "VIRTUAL_CARD", targetId: card.id, result: "SUCCESS", metadata: { previousStatus: card.status, version: record.version } } });
      return record;
    }, { timeout: 60_000 });
    providerMutationRef.current = null;
    const { externalCardId: _external, ...safe } = updated;
    void _external;
    return ok({ ...safe, spendingLimitMinor: safe.spendingLimitMinor?.toString() ?? null });
  } catch (error) {
    const providerMutation = providerMutationRef.current;
    if (providerMutation) {
      let containment: "REFROZEN" | "REFREEZE_FAILED" | "NOT_REQUIRED" = "NOT_REQUIRED";
      if (providerMutation.requestedStatus === "ACTIVE") {
        try {
          await getCardProvider().updateCardStatus(providerMutation.externalCardId, "INACTIVE", `card-status-containment:${providerMutation.cardId}:${providerMutation.expectedVersion}`);
          containment = "REFROZEN";
        } catch (containmentError) {
          containment = "REFREEZE_FAILED";
          logError("card_provider_activation_containment_failed", containmentError, { cardId: providerMutation.cardId, expectedVersion: providerMutation.expectedVersion });
        }
      }
      await recordProviderDivergence(providerMutation, containment, error);
      return problem(503, "CARD_PROVIDER_STATE_RECONCILIATION_REQUIRED", containment === "REFREEZE_FAILED" ? "The provider accepted a card activation but AgentPay could not finalize or re-freeze it. Treat the card as potentially active and reconcile it at the provider immediately." : "The provider accepted the card change but AgentPay could not finalize local state. The operation is held for reconciliation; do not retry with a new idempotency key.");
    }
    if (error instanceof Error && error.message === "CARD_NOT_FOUND") return problem(404, error.message, "The card was not found.");
    if (error instanceof Error && error.message === "CARD_CANCELED") return problem(409, error.message, "A canceled card cannot be reactivated.");
    if (error instanceof Error && error.message === "CARD_PROVIDER_MISMATCH") return problem(409, error.message, "The configured provider does not own this card.");
    if (error instanceof Error && error.message === "CARD_VERSION_CONFLICT") return problem(409, error.message, "The card changed while this request was in progress. Refresh and try again.");
    return handleApiError(error);
  }
}
