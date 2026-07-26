import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { triggerAutomation, webhookSecretHash } from "@/domain/automation-service";
import { boundedJson, handleApiError, ok, problem } from "@/lib/api";
import { db } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ ruleId: string }> }) {
  try {
    const { ruleId } = await context.params;
    const rule = await db.automationRule.findFirst({ where: { id: ruleId, status: "ACTIVE", triggerType: "WEBHOOK" } });
    if (!rule) return problem(404, "AUTOMATION_RULE_NOT_FOUND", "Active webhook automation not found.");
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const config = z.object({ secretHash: z.string().length(64) }).parse(rule.triggerConfig);
    if (!token) return problem(401, "WEBHOOK_AUTH_REQUIRED", "A webhook bearer secret is required.");
    const actual = Buffer.from(webhookSecretHash(token)); const expected = Buffer.from(config.secretHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return problem(401, "WEBHOOK_AUTH_INVALID", "The webhook bearer secret is invalid.");
    const eventId = request.headers.get("x-event-id");
    if (!eventId || eventId.length < 8 || eventId.length > 100) return problem(400, "EVENT_ID_REQUIRED", "Provide a stable X-Event-Id header.");
    const body = await boundedJson(request, 32 * 1024);
    return ok(await triggerAutomation(rule.id, rule.organizationId, `webhook:${eventId}`, { body }), { status: 202 });
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") return problem(413, error.message, "Webhook bodies are limited to 32 KiB.");
    return handleApiError(error);
  }
}
