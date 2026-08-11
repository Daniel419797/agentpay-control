import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const addressSchema = z.object({
  line1: z.string().min(3).max(120),
  line2: z.string().max(120).optional(),
  city: z.string().min(2).max(80),
  state: z.string().max(80).optional(),
  postalCode: z.string().min(2).max(20),
  country: z.string().length(2).transform((value) => value.toUpperCase()),
});
const createSchema = z.object({
  name: z.string().min(2).max(120),
  firstName: z.string().min(1).max(60),
  lastName: z.string().min(1).max(60),
  email: z.string().email(),
  phone: z.string().min(7).max(30).optional(),
  dateOfBirth: z.object({ day: z.number().int().min(1).max(31), month: z.number().int().min(1).max(12), year: z.number().int().min(1900).max(new Date().getUTCFullYear() - 18) }).optional(),
  address: addressSchema,
});

function enabled() { return getConfig().VIRTUAL_CARDS_ENABLED; }

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing cardholders.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required for cardholder PII.");
    const cardholders = await db.cardholderProfile.findMany({ where: { organizationId: workspace.organization.id }, select: { id: true, provider: true, status: true, name: true, email: true, phone: true, billingAddress: true, createdAt: true, updatedAt: true, _count: { select: { cards: true } } }, orderBy: { createdAt: "desc" } });
    return ok(cardholders);
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    if (!enabled()) return problem(503, "VIRTUAL_CARDS_DISABLED", "Virtual cards are not enabled in this environment.");
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before creating a cardholder.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    if (workspace.organization.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The organization emergency stop is active. New cardholder provisioning is disabled.");
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide an Idempotency-Key header between 8 and 100 characters.");
    const input = createSchema.parse(await boundedJson(request));
    const operationState = await db.organization.findUnique({ where: { id: workspace.organization.id }, select: { status: true, killSwitchEnabled: true } });
    if (!operationState || operationState.status !== "ACTIVE") return problem(409, "ORGANIZATION_NOT_ACTIVE", "The organization is not active.");
    if (operationState.killSwitchEnabled) return problem(409, "ORGANIZATION_KILL_SWITCH_ENABLED", "The organization emergency stop is active. New cardholder provisioning is disabled.");
    const provider = getCardProvider();
    const external = await provider.createCardholder(input, `cardholder:${workspace.organization.id}:${idempotencyKey}`);
    const cardholder = await db.$transaction(async (tx) => {
      const record = await tx.cardholderProfile.upsert({
        where: { provider_externalCardholderId: { provider: provider.name, externalCardholderId: external.id } },
        update: { status: external.status, name: input.name, email: input.email, phone: input.phone, billingAddress: input.address },
        create: { organizationId: workspace.organization.id, userId: workspace.user.id, provider: provider.name, externalCardholderId: external.id, status: external.status, name: input.name, email: input.email, phone: input.phone, billingAddress: input.address },
      });
      if (record.organizationId !== workspace.organization.id) throw new Error("PROVIDER_ID_TENANT_COLLISION");
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "CARDHOLDER_CREATED", targetType: "CARDHOLDER", targetId: record.id, result: "SUCCESS", metadata: { provider: provider.name, status: record.status } } });
      return record;
    });
    const { externalCardholderId: _externalId, ...safe } = cardholder;
    void _externalId;
    return ok(safe, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
