import { reconcileUnknownPayments } from "@/domain/reconciliation-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { authorizeInternalRequest } from "@/lib/internal-auth";

export async function POST(request: Request) {
  try {
    if (!authorizeInternalRequest(request)) return problem(401, "UNAUTHORIZED", "A valid reconciliation service credential is required.");
    return ok(await reconcileUnknownPayments());
  } catch (error) {
    return handleApiError(error);
  }
}
