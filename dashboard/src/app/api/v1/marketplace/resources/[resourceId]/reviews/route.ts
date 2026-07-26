import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { workspaceFromRequest } from "@/lib/workspace";

const schema = z.object({ paymentIntentId: z.string().uuid(), rating: z.number().int().min(1).max(5), comment: z.string().min(3).max(1_000).optional() });

export async function POST(request: Request, context: { params: Promise<{ resourceId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before reviewing a resource.");
    const { resourceId } = await context.params;
    const input = schema.parse(await boundedJson(request));
    const [resource, intent] = await Promise.all([
      db.resourceListing.findFirst({ where: { id: resourceId, public: true }, include: { provider: true } }),
      db.paymentIntent.findFirst({ where: { id: input.paymentIntentId, organizationId: workspace.organization.id, status: "SETTLED" }, include: { quote: true } }),
    ]);
    if (!resource) return problem(404, "RESOURCE_NOT_FOUND", "Marketplace resource not found.");
    if (!intent || (intent.resourceUrl !== resource.endpoint && !intent.resourceUrl.endsWith(`/${resource.slug}`))) return problem(409, "VERIFIED_PURCHASE_REQUIRED", "Only a settled purchaser can review this resource.");
    if (resource.provider.organizationId === workspace.organization.id) return problem(409, "SELF_REVIEW_PROHIBITED", "Providers cannot review their own resources.");
    const review = await db.$transaction(async (tx) => {
      const created = await tx.resourceReview.create({ data: { organizationId: workspace.organization.id, userId: workspace.user.id, resourceId: resource.id, paymentIntentId: intent.id, rating: input.rating, comment: input.comment } });
      await tx.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "MARKETPLACE_REVIEW_CREATED", targetType: "RESOURCE_REVIEW", targetId: created.id, result: "SUCCESS", metadata: { resourceId: resource.id, rating: input.rating } } });
      return created;
    });
    return ok(review, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
