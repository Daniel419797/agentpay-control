import { createHash, timingSafeEqual } from "node:crypto";

import { getConfig } from "@/lib/config";

export function authorizeInternalRequest(request: Request) {
  const expected = getConfig().CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const actualHash = createHash("sha256").update(authorization.slice(7)).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}
