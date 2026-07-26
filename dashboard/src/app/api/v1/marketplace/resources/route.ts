import { z } from "zod";

import { handleApiError, ok } from "@/lib/api";
import { db } from "@/lib/db";

const querySchema = z.object({
  q: z.string().max(100).optional(),
  category: z.enum(["MARKET_DATA", "FILE", "AI_INFERENCE", "WEB_RESEARCH"]).optional(),
  asset: z.string().max(20).optional(),
  provider: z.string().max(80).optional(),
  tag: z.string().max(40).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function GET(request: Request) {
  try {
    const params = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const resources = await db.resourceListing.findMany({
      where: {
        public: true,
        status: "ACTIVE",
        healthStatus: { not: "DOWN" },
        provider: { status: "ACTIVE", verificationStatus: "VERIFIED", publicSlug: params.provider },
        category: params.category,
        tags: params.tag ? { has: params.tag } : undefined,
        prices: params.asset ? { some: { asset: { symbol: params.asset.toUpperCase(), verified: true } } } : undefined,
        OR: params.q ? [{ name: { contains: params.q, mode: "insensitive" } }, { description: { contains: params.q, mode: "insensitive" } }, { tags: { has: params.q.toLowerCase() } }] : undefined,
      },
      include: { provider: { select: { name: true, publicSlug: true, websiteUrl: true, verifiedAt: true } }, prices: { include: { asset: true } }, reviews: { where: { status: "PUBLISHED" }, select: { rating: true } }, _count: { select: { reviews: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], cursor: params.cursor ? { id: params.cursor } : undefined, skip: params.cursor ? 1 : 0, take: params.limit + 1,
    });
    const hasMore = resources.length > params.limit;
    const page = resources.slice(0, params.limit).map(({ reviews, ...resource }) => ({ ...resource, rating: reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : null }));
    return ok({ resources: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null });
  } catch (error) { return handleApiError(error); }
}
