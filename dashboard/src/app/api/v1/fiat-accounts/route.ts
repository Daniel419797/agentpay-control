import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ currency: z.string().length(3).transform((value) => value.toUpperCase()), displayName: z.string().min(2).max(50) });

function safeAccount<T extends { externalAccountId: string; availableMinor: { toString(): string }; pendingMinor: { toString(): string } }>(account: T) {
  const { externalAccountId: _external, ...safe } = account;
  void _external;
  return { ...safe, availableMinor: account.availableMinor.toString(), pendingMinor: account.pendingMinor.toString() };
}

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing fiat accounts.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Fiat account access is required.");
    const accounts = await db.fiatAccount.findMany({ where: { organizationId: workspace.organization.id }, orderBy: { createdAt: "desc" } });
    return ok(accounts.map(safeAccount));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!getConfig().VIRTUAL_CARDS_ENABLED) return problem(503, "FIAT_RAILS_DISABLED", "Fiat rails are not enabled in this environment.");
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before opening a fiat account.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (workspace.organization.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The organization emergency stop is active. New fiat accounts are disabled.");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const input = schema.parse(await boundedJson(request));
    const operationState = await db.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
    if (!operationState || operationState.status !== "ACTIVE") return problem(409, "ORGANIZATION_NOT_ACTIVE", "The organization is not active.");
    if (operationState.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The organization emergency stop is active. New fiat accounts are disabled.");
    const provider = getCardProvider();
    const external = await provider.createFiatAccount(input, `fiat-account:${workspace.organization.id}:${idempotencyKey}`);
    const account = await db.$transaction(async (tx) => {
      const record = await tx.fiatAccount.upsert({
        where: { provider_externalAccountId: { provider: provider.name, externalAccountId: external.id } },
        update: { status: external.status, availableMinor: external.availableMinor, pendingMinor: external.pendingMinor },
        create: { organizationId: workspace.organization.id, provider: provider.name, externalAccountId: external.id, status: external.status, currency: input.currency, availableMinor: external.availableMinor, pendingMinor: external.pendingMinor },
      });
      if (record.organizationId !== workspace.organization.id) throw new Error("PROVIDER_ID_TENANT_COLLISION");
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "FIAT_ACCOUNT_CREATED", targetType: "FIAT_ACCOUNT", targetId: record.id, result: "SUCCESS", metadata: { provider: provider.name, currency: input.currency, status: record.status } } });
      return record;
    });
    return ok(safeAccount(account), { status: 201 });
  } catch (error) { return handleApiError(error); }
}
