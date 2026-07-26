import { randomBytes } from "node:crypto";
import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { assertSafeResourceUrl } from "@/lib/safe-url";
import { encryptSecret } from "@/lib/secret-box";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";
import { assertPlanLimit } from "@/domain/entitlement-service";

const common = {
  name: z.string().min(2).max(80),
  eventTypes: z.array(z.union([z.literal("*"), z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/)])).min(1).max(50),
};
const createSchema = z.discriminatedUnion("type", [
  z.object({ ...common, type: z.literal("WEBHOOK"), destination: z.string().url() }),
  z.object({ ...common, type: z.literal("SLACK"), destination: z.string().url() }),
  z.object({ ...common, type: z.literal("EMAIL"), destination: z.string().email() }),
]);

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing notification endpoints.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Notification access is required.");
    const endpoints = await db.notificationEndpoint.findMany({ where: { organizationId: workspace.organization.id }, orderBy: { createdAt: "desc" } });
    return ok(endpoints.map(({ signingSecretEncrypted: _secret, ...endpoint }) => ({ ...endpoint, hasSigningSecret: Boolean(_secret) })));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before creating notification endpoints.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    const input = createSchema.parse(await boundedJson(request));
    if (input.type !== "EMAIL") await assertSafeResourceUrl(input.destination, getConfig().APP_ENV === "production");
    const signingSecret = input.type === "WEBHOOK" ? randomBytes(32).toString("base64url") : undefined;
    const endpoint = await db.$transaction(async (tx) => {
      await assertPlanLimit(tx, workspace.organization.id, "NOTIFICATION_ENDPOINTS");
      const created = await tx.notificationEndpoint.create({
        data: { organizationId: workspace.organization.id, ...input, eventTypes: [...new Set(input.eventTypes)], signingSecretEncrypted: signingSecret ? encryptSecret(signingSecret) : undefined },
      });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "NOTIFICATION_ENDPOINT_CREATED", targetType: "NOTIFICATION_ENDPOINT", targetId: created.id, result: "SUCCESS", metadata: { type: created.type, name: created.name } } });
      return created;
    });
    const { signingSecretEncrypted: _encrypted, ...safe } = endpoint;
    void _encrypted;
    return ok({ ...safe, signingSecret }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PLAN_NOTIFICATION_ENDPOINTS_LIMIT_REACHED") return problem(402, error.message, "Your plan's notification-endpoint limit has been reached.");
    return handleApiError(error);
  }
}
