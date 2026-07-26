import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing cross-chain transfers.");
    return ok(await db.crossChainTransfer.findMany({ where: { organizationId: workspace.organization.id }, include: { quote: { select: { sourceNetworkId: true, destinationNetworkId: true, sourceToken: true, destinationToken: true, inputAmountAtomic: true, estimatedOutputAtomic: true, minimumOutputAtomic: true, tool: true } } }, orderBy: { createdAt: "desc" }, take: 100 }));
  } catch (error) { return handleApiError(error); }
}
