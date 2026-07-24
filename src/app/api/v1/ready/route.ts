import { db } from "@/lib/db"; import { ok, problem } from "@/lib/api";
export const dynamic = "force-dynamic";
export async function GET() { try { await db.$queryRaw`SELECT 1`; return ok({ status: "ready", database: "connected" }); } catch { return problem(503, "NOT_READY", "PostgreSQL is unavailable."); } }
