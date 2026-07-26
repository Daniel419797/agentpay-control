import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { ok, problem } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = getConfig();
  const started = performance.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const migrations = await db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
    if ((migrations[0]?.count ?? 0n) > 0n) throw new Error("MIGRATION_INCOMPLETE");
    if (config.FACILITATOR_URL) {
      const response = await fetch(`${config.FACILITATOR_URL}/supported`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
      if (!response.ok) throw new Error("FACILITATOR_UNAVAILABLE");
    }
    return ok({ status: "ready", database: "connected", facilitator: config.FACILITATOR_URL ? "connected" : "not_configured", latencyMs: Math.round(performance.now() - started) });
  } catch {
    return problem(503, "NOT_READY", "A required AgentPay dependency is unavailable.");
  }
}
