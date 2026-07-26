import { z } from "zod";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ networkId: z.string().min(3), contractAddress: z.union([z.string().regex(/^0\.0\.\d+$/), z.string().regex(/^0x[0-9a-fA-F]{40}$/)]), name: z.string().min(2).max(120), allowedFunctionSelectors: z.array(z.string().regex(/^0x[0-9a-fA-F]{8}$/)).min(1).max(100), maxGas: z.number().int().min(21_000).max(15_000_000), maxPayableAtomic: z.string().regex(/^\d+$/), expectedCodeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() });

export async function GET(request: Request) {
  try { const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing contract controls."); return ok(await db.contractAllowlistEntry.findMany({ where: { organizationId: workspace.organization.id }, include: { network: true }, orderBy: { createdAt: "desc" } })); } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request); if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before allowlisting a contract.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing contract execution authority.");
    const input = schema.parse(await boundedJson(request));
    const network = await db.chainNetwork.findFirst({ where: { id: input.networkId, enabled: true, supportsContracts: true } });
    if (!network) return problem(409, "CONTRACT_NETWORK_UNAVAILABLE", "This network is not enabled for contract automation.");
    if (network.family === "HEDERA" && !/^0\.0\.\d+$/.test(input.contractAddress)) return problem(422, "CONTRACT_ADDRESS_INVALID", "Use a Hedera contract ID for this network.");
    const entry = await db.$transaction(async (tx) => {
      const created = await tx.contractAllowlistEntry.create({ data: { organizationId: workspace.organization.id, ...input, allowedFunctionSelectors: [...new Set(input.allowedFunctionSelectors.map((selector) => selector.toLowerCase()))] } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "CONTRACT_ALLOWLISTED", targetType: "CONTRACT_ALLOWLIST", targetId: created.id, result: "SUCCESS", metadata: { networkId: input.networkId, contractAddress: input.contractAddress, selectors: created.allowedFunctionSelectors } } });
      return created;
    });
    return ok({ ...entry, maxPayableAtomic: entry.maxPayableAtomic.toString() }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
