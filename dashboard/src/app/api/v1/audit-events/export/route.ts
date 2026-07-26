import { z } from "zod";

import { handleApiError, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { csvCell } from "@/lib/csv";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const querySchema = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), action: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(10_000).default(10_000), format: z.enum(["csv", "json"]).default("csv") });

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before exporting audit events.");
    if (!workspaceHasRole(workspace, ["OWNER", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Owner or Viewer access is required.");
    const url = new URL(request.url);
    const input = querySchema.parse(Object.fromEntries(url.searchParams));
    const rows = await db.auditEvent.findMany({ where: { organizationId: workspace.organization.id, action: input.action, occurredAt: { gte: input.from, lte: input.to } }, orderBy: { chainSequence: "asc" }, take: input.limit });
    if (input.format === "json") {
      return Response.json({ exportedAt: new Date().toISOString(), organizationId: workspace.organization.id, events: rows.map((row) => ({ ...row, chainSequence: row.chainSequence.toString() })) }, { headers: { "cache-control": "private, no-store", "content-disposition": `attachment; filename="agentpay-audit-${new Date().toISOString().slice(0, 10)}.json"` } });
    }
    const lines = ["id,chain_sequence,occurred_at,actor_type,actor_id,action,target_type,target_id,result,request_id,previous_hash,event_hash,metadata", ...rows.map((row) => [row.id, row.chainSequence.toString(), row.occurredAt.toISOString(), row.actorType, row.actorId, row.action, row.targetType, row.targetId, row.result, row.requestId, row.previousHash, row.eventHash, JSON.stringify(row.metadata)].map(csvCell).join(","))];
    return new Response(`\uFEFF${lines.join("\r\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="agentpay-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
  } catch (error) {
    return handleApiError(error);
  }
}
