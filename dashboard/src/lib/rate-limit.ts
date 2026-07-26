import { createHash } from "node:crypto";

import { db } from "@/lib/db";

type RateLimitRow = { count: number; expiresAt: Date };

function clientAddress(request: Request) {
  const platform = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip");
  if (platform) return platform.trim();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((value) => value.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? "unknown";
}

export function rateLimitKey(request: Request, scope: string, subject?: string) {
  const material = `${scope}:${subject ?? clientAddress(request)}`;
  return createHash("sha256").update(material).digest("hex");
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowMs);
  const rows = await db.$queryRaw<RateLimitRow[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt", "updatedAt")
    VALUES (${key}, 1, ${now}, ${expiresAt}, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${now} ELSE "RateLimitBucket"."windowStart" END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "RateLimitBucket"."expiresAt" END,
      "updatedAt" = ${now}
    RETURNING "count", "expiresAt"
  `;
  const row = rows[0];
  if (!row) throw new Error("RATE_LIMIT_STATE_UNAVAILABLE");
  return { allowed: row.count <= limit, remaining: Math.max(0, limit - row.count), retryAfterSeconds: Math.max(1, Math.ceil((row.expiresAt.getTime() - now.getTime()) / 1000)) };
}

export async function enforceRateLimit(request: Request, options: { scope: string; limit: number; windowMs: number; subject?: string }) {
  return consumeRateLimit(rateLimitKey(request, options.scope, options.subject), options.limit, options.windowMs);
}
