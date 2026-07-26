import { z } from "zod";
import { recordCrossChainSubmission } from "@/domain/cross-chain-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ sourceTransactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });

export async function POST(request: Request, context: { params: Promise<{ transferId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before recording a transfer submission.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const { transferId } = await context.params;
    return ok(await recordCrossChainSubmission(transferId, workspace.organization.id, schema.parse(await boundedJson(request)).sourceTransactionHash), { status: 202 });
  } catch (error) { return handleApiError(error); }
}
