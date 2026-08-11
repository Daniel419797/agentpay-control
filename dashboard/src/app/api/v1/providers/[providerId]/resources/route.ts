import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { assertSafeResourceUrl } from "@/lib/safe-url";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({
  category: z.enum(["MARKET_DATA", "FILE", "AI_INFERENCE", "WEB_RESEARCH"]),
  name: z.string().min(2).max(120),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100),
  description: z.string().min(20).max(2_000),
  endpoint: z.string().url(),
  assetId: z.string().uuid(),
  atomicAmount: z.string().regex(/^\d+$/).refine((value) => BigInt(value) > 0n),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  outputContentTypes: z.array(z.string().regex(/^[\w.+-]+\/[\w.+-]+$/)).min(1).max(20).default(["application/json"]),
  tags: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/)).max(20).default([]),
  termsUrl: z.string().url().optional(),
  public: z.boolean().default(false),
  serviceLevel: z.object({ uptimeTarget: z.number().min(0).max(100), maxLatencyMs: z.number().int().positive(), supportResponseHours: z.number().int().positive().max(720) }).optional(),
});

async function providerAccess(request: Request, providerId: string, write = false) {
  const workspace = await workspaceFromRequest(request);
  if (!workspace) return { error: problem(401, "AUTH_REQUIRED", "Sign in before managing provider resources.") } as const;
  if (!workspaceHasRole(workspace, write ? ["OWNER", "PROVIDER_ADMIN"] : ["OWNER", "OPERATOR", "PROVIDER_ADMIN", "VIEWER"])) return { error: problem(403, "ROLE_REQUIRED", "Provider access is required.") } as const;
  const provider = await db.resourceProvider.findFirst({ where: { id: providerId, organizationId: workspace.organization.id } });
  if (!provider) return { error: problem(404, "PROVIDER_NOT_FOUND", "Provider not found.") } as const;
  return { workspace, provider } as const;
}

export async function GET(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await params;
    const access = await providerAccess(request, providerId);
    if ("error" in access) return access.error;
    return ok(await db.resourceListing.findMany({ where: { providerId }, include: { prices: { include: { asset: true } }, _count: { select: { reviews: true } } }, orderBy: { createdAt: "desc" } }));
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ providerId: string }> }) {
  try {
    const { providerId } = await params;
    const access = await providerAccess(request, providerId, true);
    if ("error" in access) return access.error;
    const input = schema.parse(await boundedJson(request));
    await assertSafeResourceUrl(input.endpoint, getConfig().APP_ENV === "production");
    const asset = await db.asset.findUnique({ where: { id: input.assetId } });
    if (!asset?.verified) return problem(409, "ASSET_NOT_VERIFIED", "The resource price must use a verified asset.");
    if (asset.network !== "hedera:testnet") return problem(409, "PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED", "Organization marketplace providers currently support verified Hedera testnet settlement only. Other rails remain disabled until a network-specific settlement account is verified.");
    if (input.public && access.provider.verificationStatus !== "VERIFIED") return problem(409, "PROVIDER_NOT_VERIFIED", "Verify the provider before publishing marketplace resources.");
    const row = await db.$transaction(async (tx) => {
      const resource = await tx.resourceListing.create({ data: { providerId, category: input.category, name: input.name, slug: input.slug, description: input.description, endpoint: input.endpoint, status: input.public ? "ACTIVE" : "DRAFT", public: input.public, inputSchema: JSON.parse(JSON.stringify(input.inputSchema)), outputContentTypes: input.outputContentTypes, tags: [...new Set(input.tags)], termsUrl: input.termsUrl, serviceLevel: input.serviceLevel, prices: { create: { assetId: input.assetId, atomicAmount: input.atomicAmount } } } });
      await tx.auditEvent.create({ data: { organizationId: access.workspace.organization.id, actorType: "USER", actorId: access.workspace.user.id, action: "MARKETPLACE_RESOURCE_CREATED", targetType: "RESOURCE_LISTING", targetId: resource.id, result: "SUCCESS", metadata: { public: resource.public, category: resource.category, settlementNetwork: asset.network } } });
      return resource;
    });
    return ok(row, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
