import { handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const { resourceId } = await context.params;
    const resource = await db.resourceListing.findFirst({ where: { id: resourceId, public: true, status: "ACTIVE", provider: { status: "ACTIVE", verificationStatus: "VERIFIED" } }, include: { provider: { select: { name: true, publicSlug: true, description: true, websiteUrl: true, supportEmail: true, termsUrl: true, privacyUrl: true, verifiedAt: true } }, prices: { include: { asset: true } }, reviews: { where: { status: "PUBLISHED" }, select: { id: true, rating: true, comment: true, createdAt: true, user: { select: { displayName: true } } }, orderBy: { createdAt: "desc" }, take: 50 }, healthChecks: { orderBy: { checkedAt: "desc" }, take: 20 } } });
    if (!resource) return problem(404, "RESOURCE_NOT_FOUND", "Marketplace resource not found.");
    const rating = resource.reviews.length ? resource.reviews.reduce((sum, review) => sum + review.rating, 0) / resource.reviews.length : null;
    return ok({ ...resource, rating });
  } catch (error) { return handleApiError(error); }
}
