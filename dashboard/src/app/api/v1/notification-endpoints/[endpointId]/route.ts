import { randomBytes } from "node:crypto";
import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { notificationDestinationDisplay } from "@/lib/notification-destination";
import { encryptSecret } from "@/lib/secret-box";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ status: z.enum(["ACTIVE", "PAUSED"]).optional(), rotateSecret: z.boolean().default(false) });

export async function PATCH(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before changing notification endpoints.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    const { endpointId } = await params;
    const endpoint = await db.notificationEndpoint.findFirst({ where: { id: endpointId, organizationId: workspace.organization.id } });
    if (!endpoint) return problem(404, "NOTIFICATION_ENDPOINT_NOT_FOUND", "Notification endpoint not found.");
    const input = schema.parse(await boundedJson(request));
    if (input.rotateSecret && !hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before rotating a webhook signing secret.");
    if (input.rotateSecret && endpoint.type !== "WEBHOOK") return problem(422, "SIGNING_SECRET_UNSUPPORTED", "Only webhook endpoints use signing secrets.");
    const signingSecret = input.rotateSecret ? randomBytes(32).toString("base64url") : undefined;
    const updated = await db.$transaction(async (tx) => {
      const row = await tx.notificationEndpoint.update({ where: { id: endpoint.id }, data: { status: input.status, signingSecretEncrypted: signingSecret ? encryptSecret(signingSecret) : undefined } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: input.rotateSecret ? "NOTIFICATION_SECRET_ROTATED" : "NOTIFICATION_ENDPOINT_UPDATED", targetType: "NOTIFICATION_ENDPOINT", targetId: endpoint.id, result: "SUCCESS", metadata: { status: row.status } } });
      return row;
    });
    const { signingSecretEncrypted: _encrypted, destination, ...safe } = updated;
    void _encrypted;
    return ok({ ...safe, destination: notificationDestinationDisplay(updated.type, destination), hasSigningSecret: Boolean(updated.signingSecretEncrypted), signingSecret });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ endpointId: string }> }) {
  const clone = new Request(request.url, { method: "PATCH", headers: request.headers, body: JSON.stringify({ status: "PAUSED" }) });
  return PATCH(clone, { params });
}
