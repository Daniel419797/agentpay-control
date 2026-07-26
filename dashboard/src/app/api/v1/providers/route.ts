import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  name: z.string().min(2).max(100),
  publicSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(80),
  description: z.string().min(20).max(1_000),
  websiteUrl: z.string().url(),
  supportEmail: z.string().email(),
  termsUrl: z.string().url(),
  privacyUrl: z.string().url(),
  settlementAccountId: z.string().regex(/^0\.0\.\d+$/),
});

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing providers.");
    if (!workspaceHasRole(workspace, ["OWNER", "OPERATOR", "PROVIDER_ADMIN", "VIEWER"])) return problem(403, "ROLE_REQUIRED", "Provider access is required.");
    return ok(await db.resourceProvider.findMany({ where: { organizationId: workspace.organization.id }, include: { _count: { select: { resources: true } } }, orderBy: { createdAt: "desc" } }));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before registering a provider.");
    if (!workspaceHasRole(workspace, ["OWNER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Owner or Provider Admin access is required.");
    const input = schema.parse(await boundedJson(request));
    const provider = await db.$transaction(async (tx) => {
      const created = await tx.resourceProvider.create({ data: { ...input, organizationId: workspace.organization.id, status: "PAUSED", verificationStatus: "PENDING" } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "RESOURCE_PROVIDER_REGISTERED", targetType: "RESOURCE_PROVIDER", targetId: created.id, result: "SUCCESS", metadata: { publicSlug: created.publicSlug, settlementAccountId: created.settlementAccountId } } });
      return created;
    });
    return ok(provider, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
