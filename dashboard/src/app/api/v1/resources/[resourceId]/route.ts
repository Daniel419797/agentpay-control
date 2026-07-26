import { db } from "@/lib/db";
import { handleApiError, ok, problem } from "@/lib/api";
import { workspaceFromRequest } from "@/lib/workspace";

export async function GET(request: Request, { params }: { params: Promise<{ resourceId: string }> }) {
  try {
    const { resourceId } = await params;
    const workspace = await workspaceFromRequest(request);
    const publicVisibility = {
      public: true,
      status: "ACTIVE" as const,
      provider: { status: "ACTIVE" as const, verificationStatus: "VERIFIED" as const },
    };
    const resource = await db.resourceListing.findFirst({
      where: {
        AND: [
          { OR: [{ id: resourceId }, { slug: resourceId }] },
          workspace
            ? { OR: [publicVisibility, { provider: { organizationId: workspace.organization.id } }] }
            : publicVisibility,
        ],
      },
      include: {
        provider: { select: { id: true, name: true, publicSlug: true, websiteUrl: true, verifiedAt: true } },
        prices: { include: { asset: true } },
      },
    });
    if (!resource) return problem(404, "RESOURCE_NOT_FOUND", "Resource not found.");
    return ok({
      ...resource,
      prices: resource.prices.map((price) => ({ ...price, atomicAmount: price.atomicAmount.toString() })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
