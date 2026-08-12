import { reconcileUnknownArcPayments } from "@/domain/arc-payment-reconciliation-service";
import { reconcileUnknownHederaPayments } from "@/domain/payment-reconciliation-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { authorizeInternalRequest } from "@/lib/internal-auth";

export async function POST(request: Request) {
  try {
    if (!authorizeInternalRequest(request)) return problem(401, "UNAUTHORIZED", "A valid reconciliation service credential is required.");
    const [hedera, arc] = await Promise.all([
      reconcileUnknownHederaPayments(),
      reconcileUnknownArcPayments(),
    ]);
    return ok({ hedera, arc });
  } catch (error) {
    return handleApiError(error);
  }
}
