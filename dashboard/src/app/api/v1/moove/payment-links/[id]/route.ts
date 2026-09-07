import { z } from "zod";

import { getMooveReceivePayment } from "@/domain/moove-receive-service";
import { authorizeAgentRequest, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { MooveProviderError } from "@/lib/moove";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const idSchema = z.string().uuid();

function mapped(error: Error) {
  if (error.message === "MOOVE_PAYMENT_LINK_NOT_FOUND") return problem(404, error.message, "Moove payment link not found.");
  if (error.message === "MOOVE_PROVIDER_LINK_NOT_FOUND") return problem(409, error.message, "The local payment record exists but Moove no longer returns its provider link.");
  if (error.message === "MOOVE_ORGANIZATION_NOT_CONFIGURED") return problem(409, error.message, "Moove is not configured for the active workspace.");
  if (error.message === "MOOVE_RECEIVE_DISABLED") return problem(503, error.message, "Moove Receive is disabled.");
  if (error instanceof MooveProviderError) return problem(503, "MOOVE_PROVIDER_UNAVAILABLE", "Moove could not refresh the payment link right now.");
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    idSchema.parse(id);
    const identity = (await db.$queryRaw<Array<{ organizationId: string; agentId: string | null }>>`
      SELECT "organizationId","agentId" FROM "MoovePaymentLink" WHERE "id"=${id}::uuid LIMIT 1`)[0];
    if (!identity) return problem(404, "MOOVE_PAYMENT_LINK_NOT_FOUND", "Moove payment link not found.");

    const workspace = await workspaceFromRequest(request);
    const operatorAuthorized = Boolean(workspace && workspace.organization.id === identity.organizationId && workspaceHasRole(workspace, ["OWNER", "OPERATOR", "APPROVER", "VIEWER", "PROVIDER_ADMIN"]));
    const agentAuthorized = !operatorAuthorized && Boolean(identity.agentId && await authorizeAgentRequest(request, identity.agentId, "payments:read"));
    if (!operatorAuthorized && !agentAuthorized) return problem(401, "UNAUTHORIZED", "A valid workspace session or owning agent credential is required.");

    const refresh = new URL(request.url).searchParams.get("refresh") === "true";
    return ok(await getMooveReceivePayment({ organizationId: identity.organizationId, id, refresh }));
  } catch (error) {
    if (error instanceof Error) {
      const response = mapped(error);
      if (response) return response;
    }
    return handleApiError(error);
  }
}
