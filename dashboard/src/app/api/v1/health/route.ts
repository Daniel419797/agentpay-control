import { ok } from "@/lib/api";
export const dynamic = "force-dynamic";
export function GET() { return ok({ status: "ok", service: "agentpay-control", time: new Date().toISOString() }); }
