import { z } from "zod";

import { createCrossChainQuote } from "@/domain/cross-chain-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const token = z.string().regex(/^(0x[0-9a-fA-F]{40}|[A-Za-z0-9._-]{2,20})$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const schema = z.object({ agentId: z.string().uuid(), sourceNetworkId: z.string().min(3), destinationNetworkId: z.string().min(3), sourceToken: token, destinationToken: token, sourceAddress: address, destinationAddress: address, inputAmountAtomic: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n), slippage: z.number().min(0.0001).max(0.05).default(0.005), order: z.enum(["FASTEST", "CHEAPEST"]).default("CHEAPEST") });

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing cross-chain quotes.");
    const quotes = await db.crossChainRouteQuote.findMany({ where: { organizationId: workspace.organization.id }, select: { id: true, agentId: true, sourceNetworkId: true, destinationNetworkId: true, sourceToken: true, destinationToken: true, sourceAddress: true, destinationAddress: true, inputAmountAtomic: true, estimatedOutputAtomic: true, minimumOutputAtomic: true, provider: true, tool: true, feeSummary: true, status: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 100 });
    return ok(quotes.map((quote) => ({ ...quote, inputAmountAtomic: quote.inputAmountAtomic.toString(), estimatedOutputAtomic: quote.estimatedOutputAtomic.toString(), minimumOutputAtomic: quote.minimumOutputAtomic.toString() })));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before requesting a route.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const quote = await createCrossChainQuote(workspace.organization.id, schema.parse(await boundedJson(request)));
    const { transactionRequestEncrypted: _encrypted, requestHash: _hash, externalQuoteId: _external, ...safe } = quote;
    void _encrypted; void _hash; void _external;
    return ok({ ...safe, inputAmountAtomic: safe.inputAmountAtomic.toString(), estimatedOutputAtomic: safe.estimatedOutputAtomic.toString(), minimumOutputAtomic: safe.minimumOutputAtomic.toString() }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
