import { z } from "zod";

import { getCardProvider } from "@/domain/card-provider";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { hasRecentAuthentication } from "@/lib/session";
import { workspaceFromRequest, workspaceHasRole } from "@/lib/workspace";

const schema = z.object({ nonce: z.string().min(8).max(500) });

export async function POST(request: Request, context: { params: Promise<{ cardId: string }> }) {
  try {
    const workspace = await workspaceFromRequest(request);
    if (!workspace) return problem(401, "AUTH_REQUIRED", "Sign in before displaying card details.");
    if (!workspaceHasRole(workspace, ["OWNER"])) return problem(403, "ROLE_REQUIRED", "Owner access is required to display sensitive card details.");
    if (!hasRecentAuthentication(workspace.session)) return problem(428, "STEP_UP_REQUIRED", "Sign in again before displaying sensitive card details.");
    const { cardId } = await context.params;
    const input = schema.parse(await boundedJson(request));
    const card = await db.virtualCard.findFirst({ where: { id: cardId, organizationId: workspace.organization.id, status: { in: ["ACTIVE", "FROZEN"] } } });
    if (!card) return problem(404, "CARD_NOT_FOUND", "The card was not found or cannot display details.");
    if (card.provider !== "STRIPE") return problem(409, "CARD_DETAILS_UNAVAILABLE", "Sensitive details are only available through the live card provider.");
    const provider = getCardProvider();
    if (provider.name !== card.provider) return problem(409, "CARD_PROVIDER_MISMATCH", "The configured provider does not own this card.");
    const key = await provider.createCardDisplayKey(card.externalCardId, input.nonce);
    await db.auditEvent.create({ data: { organizationId: workspace.organization.id, actorType: "USER", actorId: workspace.user.id, action: "VIRTUAL_CARD_DETAILS_ACCESSED", targetType: "VIRTUAL_CARD", targetId: card.id, result: "SUCCESS", metadata: {} } });
    return ok({ issuingCard: card.externalCardId, nonce: input.nonce, ephemeralKeySecret: key.secret, publishableKey: getConfig().NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return handleApiError(error); }
}
