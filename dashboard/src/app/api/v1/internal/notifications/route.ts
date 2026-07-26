import { processNotificationOutbox } from "@/domain/notification-service";
import { handleApiError, ok, problem } from "@/lib/api";
import { authorizeInternalRequest } from "@/lib/internal-auth";

export async function POST(request: Request) {
  try {
    if (!authorizeInternalRequest(request)) return problem(401, "UNAUTHORIZED", "A valid notification worker credential is required.");
    return ok(await processNotificationOutbox());
  } catch (error) {
    return handleApiError(error);
  }
}
