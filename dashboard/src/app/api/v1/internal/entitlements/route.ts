import { z } from "zod";

import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";
import { authorizeInternalRequest } from "@/lib/internal-auth";

const schema = z.object({ organizationId: z.string().uuid(), tier: z.enum(["FREE", "STARTER", "GROWTH", "ENTERPRISE"]), active: z.boolean().default(true), maxActiveAgents: z.number().int().min(0).max(100_000), maxMembers: z.number().int().min(1).max(100_000), maxMonthlyPaymentIntents: z.number().int().min(0).max(100_000_000), maxNotificationEndpoints: z.number().int().min(0).max(10_000), currentPeriodEnd: z.coerce.date() });

export async function PUT(request: Request) {
  try {
    if (!authorizeInternalRequest(request)) return problem(401, "UNAUTHORIZED", "A valid billing service credential is required.");
    const input = schema.parse(await boundedJson(request));
    const { organizationId, ...data } = input;
    const entitlement = await db.organizationEntitlement.upsert({ where: { organizationId }, update: data, create: { organizationId, currentPeriodStart: new Date(), ...data } });
    await db.auditEvent.create({ data: { organizationId, actorType: "SYSTEM", action: "ENTITLEMENT_UPDATED", targetType: "ORGANIZATION", targetId: organizationId, result: "SUCCESS", metadata: { tier: entitlement.tier, active: entitlement.active } } });
    return ok(entitlement);
  } catch (error) {
    return handleApiError(error);
  }
}
