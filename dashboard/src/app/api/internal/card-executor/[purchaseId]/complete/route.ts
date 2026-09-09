import { z } from "zod";

import { completeLeasedCardPurchaseSafely } from "@/domain/card-autonomy-execution";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { authorizeCardExecutorRequest } from "@/lib/card-executor-config";

const schema = z.object({
  leaseToken: z.string().uuid(),
  status: z.enum(["CHECKOUT_SUCCEEDED", "CHECKOUT_FAILED", "REQUIRES_HUMAN"]),
  resultCode: z.string().regex(/^[A-Z0-9_]{2,120}$/),
  resultUrl: z.string().url().max(4_096).optional(),
  resultSummary: z.object({
    verification: z.enum(["URL_PREFIX", "TEXT_ASSERTION", "NONE"]).optional(),
    challengeType: z.enum(["3DS", "OTP", "CAPTCHA", "OTHER"]).optional(),
    finalHost: z.string().min(1).max(253).optional(),
  }).strict().optional(),
}).strict();

function sanitizeResultUrl(value?: string) {
  if (!value) return undefined;
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function POST(request: Request, { params }: { params: Promise<{ purchaseId: string }> }) {
  try {
    if (!authorizeCardExecutorRequest(request)) return problem(401, "CARD_EXECUTOR_UNAUTHORIZED", "A valid card executor credential is required.");
    const { purchaseId } = await params;
    const input = schema.parse(await boundedJson(request, 8 * 1024));
    const purchase = await completeLeasedCardPurchaseSafely({ ...input, purchaseId, resultUrl: sanitizeResultUrl(input.resultUrl) });
    if (!purchase) return problem(409, "CARD_PURCHASE_LEASE_INVALID", "The purchase lease has expired or was already consumed.");
    return ok({ purchaseId: purchase.id, status: purchase.status, resultCode: purchase.resultCode }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
