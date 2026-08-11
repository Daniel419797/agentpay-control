import { z } from "zod";

import { prepareCrossChainTransfer } from "@/domain/cross-chain-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ acknowledgeExternalWalletControl: z.literal(true) });

export async function POST(request: Request, context: { params: Promise<{ quoteId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before preparing a transfer.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before exporting a self-custody bridge transaction.");
    schema.parse(await boundedJson(request));
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 100) return problem(400, "IDEMPOTENCY_KEY_REQUIRED", "Provide a valid Idempotency-Key header.");
    const { quoteId } = await context.params;
    return ok(await prepareCrossChainTransfer(quoteId, workspace.organization.id, idempotencyKey, workspace.user.id), { status: 201 });
  } catch (error) {
    if (error instanceof Error && ["ORGANIZATION_KILL_SWITCH_ENABLED", "ORGANIZATION_NOT_ACTIVE", "CROSS_CHAIN_QUOTE_EXPIRED", "CROSS_CHAIN_QUOTE_TOO_CLOSE_TO_EXPIRY", "IDEMPOTENCY_CONFLICT"].includes(error.message)) {
      return problem(409, error.message, error.message.replaceAll("_", " ").toLowerCase());
    }
    return handleApiError(error);
  }
}
