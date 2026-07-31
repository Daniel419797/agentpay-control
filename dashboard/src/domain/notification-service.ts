import { createHmac, randomInt, randomUUID } from "node:crypto";

import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { safeFetch } from "@/lib/safe-url";
import { decryptSecret } from "@/lib/secret-box";

const MAX_ATTEMPTS = 8;
type DeliveryTarget = { type: "WEBHOOK" | "EMAIL" | "SLACK"; destination: string; signingSecretEncrypted: string | null };
type EventEnvelope = { id: string; type: string; createdAt: string; aggregate: { type: string; id: string }; data: unknown };

export function signedWebhookHeaders(eventId: string, timestamp: string, body: string, secret: string) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return { "content-type": "application/json", "user-agent": "AgentPay-Webhooks/1.0", "x-agentpay-event-id": eventId, "x-agentpay-timestamp": timestamp, "x-agentpay-signature": `v1=${signature}` };
}

async function deliver(target: DeliveryTarget, envelope: EventEnvelope) {
  const config = getConfig();
  if (target.type === "EMAIL") {
    if (!config.RESEND_API_KEY) throw new Error("RESEND_NOT_CONFIGURED");
    return fetch("https://api.resend.com/emails", {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${config.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.NOTIFICATION_FROM_EMAIL, to: [target.destination], subject: `AgentPay: ${envelope.type.replaceAll("_", " ")}`, text: JSON.stringify(envelope, null, 2) }),
    });
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = target.type === "SLACK"
    ? JSON.stringify({ text: `AgentPay ${envelope.type}`, attachments: [{ color: "#0f766e", text: `Event ${envelope.id}\n${JSON.stringify(envelope.data)}` }] })
    : JSON.stringify(envelope);
  const headers = target.type === "WEBHOOK"
    ? signedWebhookHeaders(envelope.id, timestamp, body, decryptSecret(target.signingSecretEncrypted ?? ""))
    : { "content-type": "application/json", "user-agent": "AgentPay-Notifications/1.0" };
  return safeFetch(target.destination, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers, body }, config.APP_ENV === "production");
}

function retryAt(attempt: number) {
  const delay = Math.min(3_600_000, 15_000 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + delay + randomInt(0, Math.max(1, Math.floor(delay / 4))));
}

async function claimEvents(limit: number) {
  const token = randomUUID();
  const now = new Date();
  const stale = new Date(now.getTime() - 5 * 60_000);
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH candidates AS (
      SELECT "id" FROM "OutboxEvent"
      WHERE "processedAt" IS NULL AND "deadLetteredAt" IS NULL AND "availableAt" <= ${now}
        AND ("claimedAt" IS NULL OR "claimedAt" < ${stale})
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "OutboxEvent" AS event
    SET "claimedAt" = ${now}, "claimToken" = ${token}::uuid, "attempts" = event."attempts" + 1
    FROM candidates
    WHERE event."id" = candidates."id"
    RETURNING event."id"
  `;
  return { token, ids: rows.map((row) => row.id) };
}

async function processEvent(eventId: string, claimToken: string) {
  const event = await db.outboxEvent.findFirst({
    where: { id: eventId, claimToken },
    include: { organization: { include: { notificationEndpoints: { where: { status: "ACTIVE" } } } } },
  });
  if (!event) return { eventId, outcome: "CLAIM_LOST" as const };
  const endpoints = event.organization.notificationEndpoints.filter((endpoint) => endpoint.eventTypes.includes("*") || endpoint.eventTypes.includes(event.eventType));
  const envelope: EventEnvelope = { id: event.id, type: event.eventType, createdAt: event.createdAt.toISOString(), aggregate: { type: event.aggregateType, id: event.aggregateId }, data: event.payload };
  if (event.directChannel && event.directDestination) {
    try {
      const response = await deliver({ type: event.directChannel, destination: event.directDestination, signingSecretEncrypted: null }, envelope);
      if (response.ok) {
        await db.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), claimedAt: null, claimToken: null, lastError: null } });
        return { eventId, outcome: "DELIVERED" as const };
      }
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      const dead = !retryable || event.attempts >= MAX_ATTEMPTS;
      await db.outboxEvent.update({ where: { id: event.id }, data: dead ? { deadLetteredAt: new Date(), claimedAt: null, claimToken: null, lastError: `HTTP_${response.status}` } : { availableAt: retryAt(event.attempts), claimedAt: null, claimToken: null, lastError: `HTTP_${response.status}` } });
      return { eventId, outcome: dead ? "DEAD_LETTER" as const : "RETRY_SCHEDULED" as const };
    } catch (error) {
      const dead = event.attempts >= MAX_ATTEMPTS;
      const message = error instanceof Error ? error.message.slice(0, 300) : "DELIVERY_FAILED";
      await db.outboxEvent.update({ where: { id: event.id }, data: dead ? { deadLetteredAt: new Date(), claimedAt: null, claimToken: null, lastError: message } : { availableAt: retryAt(event.attempts), claimedAt: null, claimToken: null, lastError: message } });
      return { eventId, outcome: dead ? "DEAD_LETTER" as const : "RETRY_SCHEDULED" as const };
    }
  }
  if (!endpoints.length) {
    await db.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date(), claimedAt: null, claimToken: null, lastError: null } });
    return { eventId, outcome: "NO_SUBSCRIBERS" as const };
  }
  await db.notificationDelivery.createMany({ data: endpoints.map((endpoint) => ({ outboxEventId: event.id, endpointId: endpoint.id })), skipDuplicates: true });
  const deliveries = await db.notificationDelivery.findMany({
    where: { outboxEventId: event.id, endpointId: { in: endpoints.map((endpoint) => endpoint.id) }, status: { in: ["PENDING", "RETRY_SCHEDULED"] }, nextAttemptAt: { lte: new Date() } },
    include: { endpoint: true },
  });
  for (const delivery of deliveries) {
    const attempt = delivery.attemptCount + 1;
    try {
      const response = await deliver(delivery.endpoint, envelope);
      if (response.ok) {
        await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: "DELIVERED", attemptCount: attempt, lastHttpStatus: response.status, lastError: null, deliveredAt: new Date() } });
      } else {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        const dead = !retryable || attempt >= MAX_ATTEMPTS;
        await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: dead ? "DEAD_LETTER" : "RETRY_SCHEDULED", attemptCount: attempt, lastHttpStatus: response.status, lastError: `HTTP_${response.status}`, nextAttemptAt: dead ? delivery.nextAttemptAt : retryAt(attempt) } });
      }
    } catch (error) {
      const dead = attempt >= MAX_ATTEMPTS;
      await db.notificationDelivery.update({ where: { id: delivery.id }, data: { status: dead ? "DEAD_LETTER" : "RETRY_SCHEDULED", attemptCount: attempt, lastError: error instanceof Error ? error.message.slice(0, 300) : "DELIVERY_FAILED", nextAttemptAt: dead ? delivery.nextAttemptAt : retryAt(attempt) } });
    }
  }
  const remaining = await db.notificationDelivery.findMany({ where: { outboxEventId: event.id }, select: { status: true, nextAttemptAt: true, lastError: true } });
  const dead = remaining.some((row) => row.status === "DEAD_LETTER");
  const pending = remaining.filter((row) => row.status === "PENDING" || row.status === "RETRY_SCHEDULED");
  await db.outboxEvent.update({
    where: { id: event.id },
    data: dead
      ? { deadLetteredAt: new Date(), claimedAt: null, claimToken: null, lastError: remaining.find((row) => row.status === "DEAD_LETTER")?.lastError }
      : pending.length
        ? { availableAt: pending.reduce((earliest, row) => row.nextAttemptAt < earliest ? row.nextAttemptAt : earliest, pending[0]!.nextAttemptAt), claimedAt: null, claimToken: null, lastError: pending[0]?.lastError }
        : { processedAt: new Date(), claimedAt: null, claimToken: null, lastError: null },
  });
  return { eventId, outcome: dead ? "DEAD_LETTER" as const : pending.length ? "RETRY_SCHEDULED" as const : "DELIVERED" as const };
}

export async function processNotificationOutbox(limit = 25) {
  const claim = await claimEvents(limit);
  const results = [];
  for (const eventId of claim.ids) results.push(await processEvent(eventId, claim.token));
  return results;
}
