import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { assertSafeResourceUrl } from "@/lib/safe-url";

export function classifyResourceHealth(httpStatus: number | undefined, latencyMs: number | undefined, maxLatencyMs?: number) {
  if (httpStatus === undefined) return "DOWN" as const;
  if (httpStatus >= 500 || httpStatus === 408) return "DOWN" as const;
  if (httpStatus === 429 || (maxLatencyMs !== undefined && latencyMs !== undefined && latencyMs > maxLatencyMs)) return "DEGRADED" as const;
  return "HEALTHY" as const;
}

export async function runResourceHealthChecks(limit = 50) {
  const resources = await db.resourceListing.findMany({ where: { public: true, status: "ACTIVE", provider: { status: "ACTIVE", verificationStatus: "VERIFIED" } }, orderBy: [{ lastHealthCheckAt: { sort: "asc", nulls: "first" } }], take: limit });
  const results: Array<{ resourceId: string; status: "HEALTHY" | "DEGRADED" | "DOWN" }> = [];
  for (const resource of resources) {
    let httpStatus: number | undefined;
    let latencyMs: number | undefined;
    let errorCode: string | undefined;
    const started = performance.now();
    try {
      const url = await assertSafeResourceUrl(resource.endpoint, getConfig().APP_ENV === "production");
      const response = await fetch(url, { method: "GET", redirect: "manual", headers: { accept: "application/json", "user-agent": "AgentPay-Health/1.0" }, signal: AbortSignal.timeout(5_000) });
      latencyMs = Math.round(performance.now() - started);
      httpStatus = response.status;
      await response.body?.cancel();
    } catch (error) {
      latencyMs = Math.round(performance.now() - started);
      errorCode = error instanceof Error ? error.name.slice(0, 80) : "HEALTH_CHECK_FAILED";
    }
    const serviceLevel = resource.serviceLevel && typeof resource.serviceLevel === "object" ? resource.serviceLevel as { maxLatencyMs?: number } : undefined;
    const status = classifyResourceHealth(httpStatus, latencyMs, serviceLevel?.maxLatencyMs);
    await db.$transaction([
      db.resourceHealthCheck.create({ data: { resourceId: resource.id, status, httpStatus, latencyMs, errorCode } }),
      db.resourceListing.update({ where: { id: resource.id }, data: { healthStatus: status, lastHealthCheckAt: new Date() } }),
    ]);
    results.push({ resourceId: resource.id, status });
  }
  return { checked: results.length, healthy: results.filter((item) => item.status === "HEALTHY").length, degraded: results.filter((item) => item.status === "DEGRADED").length, down: results.filter((item) => item.status === "DOWN").length };
}
