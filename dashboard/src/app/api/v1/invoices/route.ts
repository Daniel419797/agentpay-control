import { z } from "zod";

import { createInvoice } from "@/domain/invoice-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  issuerAgentId: z.string().uuid(),
  recipientAgentId: z.string().uuid(),
  assetId: z.string().uuid(),
  title: z.string().min(3).max(140),
  memo: z.string().max(2_000).optional(),
  dueAt: z.string().datetime().transform((value) => new Date(value)).refine((value) => value.getTime() > Date.now() && value.getTime() <= Date.now() + 366 * 86_400_000),
  items: z.array(z.object({ description: z.string().min(2).max(500), quantity: z.number().int().min(1).max(1_000_000), unitAmountAtomic: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n) })).min(1).max(100),
});

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing invoices.");
    const url = new URL(request.url);
    const direction = url.searchParams.get("direction") === "issued" ? "issued" : url.searchParams.get("direction") === "received" ? "received" : "all";
    const where = direction === "issued" ? { issuerOrganizationId: workspace.organization.id } : direction === "received" ? { recipientOrganizationId: workspace.organization.id } : { OR: [{ issuerOrganizationId: workspace.organization.id }, { recipientOrganizationId: workspace.organization.id }] };
    const invoices = await db.agentInvoice.findMany({ where, include: { asset: true, issuerAgent: { select: { id: true, name: true } }, recipientAgent: { select: { id: true, name: true } }, issuerOrganization: { select: { id: true, name: true } }, recipientOrganization: { select: { id: true, name: true } }, settlement: true }, orderBy: { createdAt: "desc" }, take: 100 });
    return ok(invoices.map((invoice) => ({ ...invoice, subtotalAtomic: invoice.subtotalAtomic.toString(), totalAtomic: invoice.totalAtomic.toString() })));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before creating an invoice.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR"])) return problem(403, "ROLE_REQUIRED", "Owner or operator access is required.");
    const invoice = await createInvoice(workspace.organization.id, workspace.user.id, schema.parse(await boundedJson(request)));
    return ok({ ...invoice, subtotalAtomic: invoice.subtotalAtomic.toString(), totalAtomic: invoice.totalAtomic.toString() }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && ["ISSUER_AGENT_ACCOUNT_UNAVAILABLE", "RECIPIENT_AGENT_NOT_FOUND", "INVOICE_ASSET_NETWORK_MISMATCH", "SELF_INVOICE_PROHIBITED", "INVALID_INVOICE_TOTAL"].includes(error.message)) return problem(409, error.message, error.message.replaceAll("_", " ").toLowerCase());
    return handleApiError(error);
  }
}
