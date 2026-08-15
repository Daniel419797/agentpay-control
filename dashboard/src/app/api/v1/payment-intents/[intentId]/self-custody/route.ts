import { z } from "zod";
import { prepareSelfCustodyPayment, submitSelfCustodyPayment } from "@/domain/payment-service";
import { handleApiError, ok, problem, rateLimitProblem, requestBody } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const submitSchema = z.object({ paymentPayload: z.unknown() });

function mappedPaymentError(error: unknown) {
  if (!(error instanceof Error)) return null;
  const status: Record<string, number> = {
    PAYMENT_NOT_AUTHORIZED: 409,
    PAYMENT_QUOTE_EXPIRED: 409,
    SPEND_RESERVATION_INVALID: 409,
    SELF_CUSTODY_ACCOUNT_REQUIRED: 409,
    SELF_CUSTODY_SUBMISSION_NETWORK_UNSUPPORTED: 409,
    SELF_CUSTODY_PAYER_MISMATCH: 422,
    X402_REQUIREMENT_MISMATCH: 422,
    PAYMENT_ALREADY_CLAIMED: 409,
  };
  return status[error.message] ? problem(status[error.message], error.message, error.message.replaceAll("_", " ").toLowerCase()) : null;
}

async function authorizedWorkspace(request: Request) {
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return { response: problem(401, "AUTH_REQUIRED", "Sign in before confirming a wallet payment.") };
  if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return { response: problem(403, "ROLE_REQUIRED", "Owner or Operator access is required.") };
  return { workspace };
}

export async function GET(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  try {
    const auth = await authorizedWorkspace(request);
    if (!auth.workspace) return auth.response;
    const { intentId } = await params;
    return ok(await prepareSelfCustodyPayment(intentId, auth.workspace.organization.id));
  } catch (error) {
    return mappedPaymentError(error) ?? handleApiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ intentId: string }> }) {
  try {
    const auth = await authorizedWorkspace(request);
    if (!auth.workspace) return auth.response;
    const { intentId } = await params;
    const rate = await enforceRateLimit(request, { scope: "self-custody-payment", subject: `${auth.workspace.user.id}:${intentId}`, limit: 10, windowMs: 15 * 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const input = submitSchema.parse(await requestBody(request));
    return ok(await submitSelfCustodyPayment(intentId, auth.workspace.organization.id, input.paymentPayload));
  } catch (error) {
    return mappedPaymentError(error) ?? handleApiError(error);
  }
}
