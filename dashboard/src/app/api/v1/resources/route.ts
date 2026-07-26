import { db } from "@/lib/db";
import { handleApiError, ok } from "@/lib/api";
import { workspaceFromRequest } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const workspace = await workspaceFromRequest(request);
    const publicVisibility = {
      public: true,
      status: "ACTIVE" as const,
      provider: { status: "ACTIVE" as const, verificationStatus: "VERIFIED" as const },
    };
    const rows = await db.resourceListing.findMany({
      where: workspace
        ? { OR: [publicVisibility, { provider: { organizationId: workspace.organization.id } }] }
        : publicVisibility,
      include: {
        provider: { select: { id: true, name: true, publicSlug: true, websiteUrl: true, verifiedAt: true } },
        prices: { include: { asset: true } },
      },
      orderBy: { name: "asc" },
      take: 100,
    });
    return ok(rows.map((resource) => ({
      ...resource,
      prices: resource.prices.map((price) => ({ ...price, atomicAmount: price.atomicAmount.toString() })),
    })));
  } catch (error) {
    return handleApiError(error);
  }
}
