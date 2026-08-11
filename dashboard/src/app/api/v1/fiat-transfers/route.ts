import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { fiatSubmissionFailureStatus, isRetryableFiatSubmission } from "@/domain/fiat-reconciliation-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/secret-box";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  fiatAccountId: z.string().uuid(),
  direction: z.enum(["DEPOSIT", "WITHDRAWAL"]),
  amountMinor: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n && BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)),
  currency: z.string().length(3).transform((value) => value.toUpperCase()),
  instrumentId: z.string().regex(/^[a-zA-Z0-9_]{4,200}$/),
  description: z.string().max(200).optional(),
});

function safeTransfer<T extends { externalTransferId: string; requestHash: string; amountMinor: { toString(): string } }>(transfer: T) {
  const { externalTransferId: _external, requestHash: _hash, ...safe } = transfer;
  void _external; void _hash;
  return { ...safe, amountMinor: transfer.amountMinor.toString() };
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing fiat transfers.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Fiat transfer access is required.");
    const transfers = await db.fiatTransfer.findMany({ where: { organizationId: workspace.organization.id }, orderBy: { createdAt: "desc" }, take: 100 });
    return ok(transfers.map(safeTransfer));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!getConfig().VIRTUAL_CARDS_ENABLED) return problem(503, "FIAT_RAILS_DISABLED", "Fiat rails are not enabled in this environment.");
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before creating a fiat transfer.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    if (workspace.organization.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The organization emergency stop is active. New fiat transfers are disabled.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before initiating a fiat transfer.");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const input = schema.parse(await boundedJson(request));
    const requestHash = createHash("sha256").update(JSON.stringify({ ...input, instrumentId: createHash("sha256").update(input.instrumentId).digest("hex") })).digest("hex");
    const existing = await db.fiatTransfer.findUnique({ where: { organizationId_idempotencyKey: { organizationId: workspace.organization.id, idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash) return problem(409, "IDEMPOTENCY_CONFLICT", "The idempotency key was already used with different transfer details.");
      if (!isRetryableFiatSubmission(existing.status, existing.externalTransferId)) return ok(safeTransfer(existing));
    }
    const provider = getCardProvider();
    const transfer = existing ?? await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.fiatAccountId}, 0))`;
      const organization = await tx.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
      if (!organization || organization.status !== "ACTIVE") throw new Error("ORGANIZATION_NOT_ACTIVE");
      if (organization.killSwitchEnabled) throw new Error("ORGANIZATION_KILL_SWITCH_ENABLED");
      const duplicate = await tx.fiatTransfer.findUnique({ where: { organizationId_idempotencyKey: { organizationId: workspace.organization.id, idempotencyKey } } });
      if (duplicate) return duplicate;
      const account = await tx.fiatAccount.findFirst({ where: { id: input.fiatAccountId, organizationId: workspace.organization.id } });
      if (!account) throw new Error("FIAT_ACCOUNT_NOT_FOUND");
      if (account.status !== "ACTIVE") throw new Error("FIAT_ACCOUNT_NOT_ACTIVE");
      if (account.provider !== provider.name) throw new Error("FIAT_PROVIDER_MISMATCH");
      if (account.currency !== input.currency) throw new Error("FIAT_CURRENCY_MISMATCH");
      if (provider.name === "SANDBOX" && input.direction === "WITHDRAWAL" && BigInt(account.availableMinor.toString()) < BigInt(input.amountMinor)) throw new Error("INSUFFICIENT_FUNDS");
      return tx.fiatTransfer.create({ data: { organizationId: workspace.organization.id, fiatAccountId: account.id, provider: provider.name, externalTransferId: `pending_${randomUUID()}`, idempotencyKey, requestHash, direction: input.direction, amountMinor: input.amountMinor, currency: input.currency, instrumentIdEncrypted: encryptSecret(input.instrumentId), description: input.description } });
    }, { isolationLevel: "Serializable" });

    const operationState = await db.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
    if (!operationState || operationState.status !== "ACTIVE" || operationState.killSwitchEnabled) {
      if (transfer.externalTransferId.startsWith("pending_")) {
        await db.fiatTransfer.updateMany({ where: { id: transfer.id, externalTransferId: { startsWith: "pending_" }, status: { in: ["PENDING", "SUBMISSION_UNKNOWN"] } }, data: { status: "CANCELED", failureCode: "ORGANIZATION_KILL_SWITCH_ENABLED" } });
      }
      return problem(409, operationState?.killSwitchEnabled ? "ORGANIZATION_KILL_SWITCH_ENABLED" : "ORGANIZATION_NOT_ACTIVE", "The organization is not permitted to submit a new fiat transfer.");
    }

    try {
      const account = await db.fiatAccount.findUniqueOrThrow({ where: { id: input.fiatAccountId } });
      const external = await provider.createFiatTransfer({ direction: input.direction, financialAccountId: account.externalAccountId, instrumentId: input.instrumentId, amountMinor: input.amountMinor, currency: input.currency, description: input.description }, `fiat-transfer:${workspace.organization.id}:${idempotencyKey}`);
      const completed = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.fiatAccountId}, 0))`;
        const current = await tx.fiatTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
        if (!current.externalTransferId.startsWith("pending_") && current.status !== "SUBMISSION_UNKNOWN") return current;
        const updated = await tx.fiatTransfer.update({ where: { id: transfer.id }, data: { externalTransferId: external.id, status: external.status, failureCode: null } });
        if (provider.name === "SANDBOX" && external.status === "SUCCEEDED") await tx.fiatAccount.update({ where: { id: input.fiatAccountId }, data: { availableMinor: input.direction === "DEPOSIT" ? { increment: input.amountMinor } : { decrement: input.amountMinor } } });
        else if (external.status === "PROCESSING") await tx.fiatAccount.update({ where: { id: input.fiatAccountId }, data: { pendingMinor: { increment: input.amountMinor } } });
        await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: `FIAT_${input.direction}_CREATED`, targetType: "FIAT_TRANSFER", targetId: updated.id, result: "SUCCESS", metadata: { amountMinor: input.amountMinor, currency: input.currency, status: updated.status } } });
        await tx.outboxEvent.create({ data: { organizationId: workspace.organization.id, eventType: `FIAT_${input.direction}_${updated.status}`, aggregateType: "FIAT_TRANSFER", aggregateId: updated.id, payload: { amountMinor: input.amountMinor, currency: input.currency, status: updated.status } } });
        return updated;
      });
      return ok(safeTransfer(completed), { status: 202 });
    } catch (error) {
      const failureStatus = fiatSubmissionFailureStatus(error);
      await db.fiatTransfer.update({ where: { id: transfer.id }, data: { status: failureStatus, failureCode: error instanceof Error ? error.message.slice(0, 120) : "PROVIDER_SUBMISSION_UNKNOWN" } });
      if (failureStatus === "FAILED") return problem(422, "FIAT_PROVIDER_REJECTED", "The fiat provider rejected the transfer before submission.");
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && ["FIAT_ACCOUNT_NOT_FOUND", "FIAT_ACCOUNT_NOT_ACTIVE", "FIAT_PROVIDER_MISMATCH", "FIAT_CURRENCY_MISMATCH", "INSUFFICIENT_FUNDS"].includes(error.message)) return problem(error.message === "FIAT_ACCOUNT_NOT_FOUND" ? 404 : 409, error.message, error.message.replaceAll("_", " ").toLowerCase());
    return handleApiError(error);
  }
}
