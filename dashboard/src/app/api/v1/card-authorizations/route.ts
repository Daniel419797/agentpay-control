import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing card authorizations.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "VIEWER", "APPROVER"])) return problem(403, "ROLE_REQUIRED", "Authorization access is required.");
    const url = new URL(request.url);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
    const rows = await db.cardAuthorization.findMany({ where: { organizationId: workspace.organization.id }, include: { virtualCard: { select: { id: true, nickname: true, last4: true, agent: { select: { id: true, name: true } } } } }, orderBy: { requestedAt: "desc" }, take: limit });
    return ok(rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString(), externalAuthorizationId: undefined })));
  } catch (error) { return handleApiError(error); }
}
