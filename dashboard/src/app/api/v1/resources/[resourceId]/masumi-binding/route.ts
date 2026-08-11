import { z } from "zod";

import { refreshMasumiResourceBinding } from "@/domain/catalyst-policy";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  agentIdentifier: z.string().regex(/^[0-9a-fA-F]{57,250}$/),
  network: z.enum(["Preprod", "Mainnet"]),
  maxRegistryAgeSeconds: z.number().int().min(15).max(3600).default(120),
  allowedCapabilities: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
});

async function ownedResource(resourceId: string, organizationId: string) {
  return db.resourceListing.findFirst({
    where: { id: resourceId, provider: { organizationId } },
    include: { provider: { select: { id: true, organizationId: true, verificationStatus: true, status: true } } },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before viewing Masumi bindings.");
    const { resourceId } = await params;
    const resource = await ownedResource(resourceId, workspace.organization.id);
    if (!resource) return problem(404, "RESOURCE_NOT_FOUND", "Resource not found in the active workspace.");
    const rows = await db.$queryRaw<Array<Record<string, unknown>>>`
      SELECT "network", "agentIdentifier", "registryPolicyId", "apiBaseUrl", "capabilityName", "capabilityVersion",
             "settlementAddress", "paymentType", "pricingSnapshot", "metadataHash", "verifiedAt", "expiresAt"
      FROM "MasumiResourceBinding"
      WHERE "resourceListingId" = ${resourceId}::uuid
      LIMIT 1
    `;
    return ok({ resourceId, binding: rows[0] ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before binding a Masumi agent.");
    if (!workspaceHasRole(workspace, ["OWNER", "PROVIDER_ADMIN"])) return problem(403, "ROLE_REQUIRED", "Owner or Provider Admin access is required.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before changing a settlement identity binding.");
    const { resourceId } = await params;
    const input = schema.parse(await boundedJson(request));
    const resource = await ownedResource(resourceId, workspace.organization.id);
    if (!resource) return problem(404, "RESOURCE_NOT_FOUND", "Resource not found in the active workspace.");
    if (resource.status === "UNAVAILABLE") return problem(409, "RESOURCE_UNAVAILABLE", "An unavailable resource cannot be bound for settlement.");
    if (resource.provider.status !== "ACTIVE" || resource.provider.verificationStatus !== "VERIFIED") {
      return problem(409, "PROVIDER_VERIFICATION_REQUIRED", "The provider must be active and verified before a Masumi settlement identity can be trusted.");
    }

    const binding = await refreshMasumiResourceBinding({
      resourceListingId: resource.id,
      resourceUrl: resource.endpoint,
      agentIdentifier: input.agentIdentifier.toLowerCase(),
      network: input.network,
      ttlSeconds: input.maxRegistryAgeSeconds,
      allowedCapabilities: input.allowedCapabilities,
    });

    await db.auditEvent.create({
      data: {
        organizationId: workspace.organization.id,
        actorType: "USER",
        actorId: workspace.user.id,
        action: "MASUMI_RESOURCE_BINDING_VERIFIED",
        targetType: "RESOURCE_LISTING",
        targetId: resource.id,
        result: "SUCCESS",
        metadata: {
          agentIdentifier: binding.agentIdentifier,
          network: binding.network,
          registryPolicyId: binding.registryPolicyId,
          settlementAddress: binding.settlementAddress,
          metadataHash: binding.metadataHash,
          capabilityName: binding.capabilityName,
        },
      },
    });
    return ok({ resourceId, binding });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before removing a Masumi binding.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required to remove a settlement identity binding.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before removing a settlement identity binding.");
    const { resourceId } = await params;
    const resource = await ownedResource(resourceId, workspace.organization.id);
    if (!resource) return problem(404, "RESOURCE_NOT_FOUND", "Resource not found in the active workspace.");
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`DELETE FROM "MasumiResourceBinding" WHERE "resourceListingId" = ${resourceId}::uuid`;
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "MASUMI_RESOURCE_BINDING_REMOVED", targetType: "RESOURCE_LISTING", targetId: resourceId, result: "SUCCESS", metadata: {} } });
    });
    return ok({ resourceId, removed: true });
  } catch (error) {
    return handleApiError(error);
  }
}
