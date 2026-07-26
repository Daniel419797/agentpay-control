import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordCardAuthorization } from "@/domain/card-authorization-service";
import { getCardProvider, verifyStripeSignature } from "@/domain/card-provider";
import { boundedText } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

const MAX_STRIPE_WEBHOOK_BYTES = 1024 * 1024;

const eventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  created: z.union([z.number().int().positive(), z.string().datetime()]).optional(),
  data: z.object({ object: z.record(z.string(), z.unknown()) }).optional(),
  related_object: z.object({ id: z.string(), type: z.string(), url: z.string() }).optional(),
});

const authorizationSchema = z.object({
  id: z.string(),
  card: z.union([z.string(), z.object({ id: z.string() })]),
  amount: z.number().int().positive(),
  currency: z.string().length(3),
  approved: z.boolean().optional(),
  status: z.string().optional(),
  merchant_data: z.object({ name: z.string().optional(), category: z.string().optional(), country: z.string().optional() }).optional(),
});

const cardSchema = z.object({ id: z.string(), status: z.enum(["active", "inactive", "canceled"]) });

function externalCardId(value: z.infer<typeof authorizationSchema>["card"]) { return typeof value === "string" ? value : value.id; }

async function markEvent(id: string, status: "PROCESSED" | "IGNORED" | "FAILED", errorCode?: string) {
  await db.providerWebhookEvent.update({ where: { id }, data: { status, errorCode, processedAt: new Date() } });
}

export async function POST(request: Request) {
  const config = getConfig();
  if (!config.VIRTUAL_CARDS_ENABLED || config.CARD_PROVIDER !== "STRIPE") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!config.STRIPE_WEBHOOK_SECRET) return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  let rawBody: string;
  try {
    rawBody = await boundedText(request, MAX_STRIPE_WEBHOOK_BYTES);
  } catch (error) {
    if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") {
      return NextResponse.json({ error: "request_body_too_large" }, { status: 413 });
    }
    throw error;
  }
  if (!verifyStripeSignature(rawBody, request.headers.get("stripe-signature"), config.STRIPE_WEBHOOK_SECRET)) return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = eventSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "invalid_event" }, { status: 400 });
  const event = parsed.data;
  const payloadHash = createHash("sha256").update(rawBody).digest("hex");
  const record = await db.providerWebhookEvent.upsert({ where: { provider_externalEventId: { provider: "STRIPE", externalEventId: event.id } }, update: {}, create: { provider: "STRIPE", externalEventId: event.id, eventType: event.type, payloadHash } });
  if (record.payloadHash !== payloadHash) {
    await markEvent(record.id, "FAILED", "EVENT_ID_PAYLOAD_MISMATCH");
    return NextResponse.json({ error: "event_id_payload_mismatch" }, { status: 409 });
  }
  if (record.status === "PROCESSED" || record.status === "IGNORED") return NextResponse.json({ received: true, duplicate: true });
  try {
    if (["issuing_authorization.request", "issuing_authorization.created"].includes(event.type)) {
      const authorization = authorizationSchema.parse(event.data?.object);
      const result = await recordCardAuthorization({
        provider: "STRIPE",
        externalAuthorizationId: authorization.id,
        externalCardId: externalCardId(authorization.card),
        amountMinor: BigInt(authorization.amount),
        currency: authorization.currency,
        merchantName: authorization.merchant_data?.name,
        merchantCategory: authorization.merchant_data?.category,
        merchantCountry: authorization.merchant_data?.country,
        requestedAt: typeof event.created === "number" ? new Date(event.created * 1_000) : event.created ? new Date(event.created) : new Date(),
      });
      await markEvent(record.id, "PROCESSED");
      if (event.type === "issuing_authorization.request") return NextResponse.json({ approved: result.approved === true });
      return NextResponse.json({ received: true });
    }
    if (event.type === "issuing_authorization.updated") {
      const authorization = authorizationSchema.parse(event.data?.object);
      const status = authorization.status === "reversed" ? "REVERSED" : authorization.status === "closed" ? "CLOSED" : authorization.approved === false ? "DECLINED" : authorization.approved === true ? "APPROVED" : "PENDING";
      await db.cardAuthorization.updateMany({ where: { provider: "STRIPE", externalAuthorizationId: authorization.id }, data: { status, approved: authorization.approved, resolvedAt: status === "PENDING" ? null : new Date() } });
      await markEvent(record.id, "PROCESSED");
      return NextResponse.json({ received: true });
    }
    if (["issuing_card.created", "issuing_card.updated"].includes(event.type)) {
      const card = cardSchema.parse(event.data?.object);
      await db.virtualCard.updateMany({ where: { provider: "STRIPE", externalCardId: card.id }, data: { status: card.status === "active" ? "ACTIVE" : card.status === "canceled" ? "CANCELED" : "FROZEN", version: { increment: 1 } } });
      await markEvent(record.id, "PROCESSED");
      return NextResponse.json({ received: true });
    }
    if (event.type.startsWith("v2.money_management.financial_account.")) {
      if (!event.related_object) throw new Error("MISSING_RELATED_OBJECT");
      const local = await db.fiatAccount.findUnique({ where: { provider_externalAccountId: { provider: "STRIPE", externalAccountId: event.related_object.id } } });
      if (!local) { await markEvent(record.id, "IGNORED"); return NextResponse.json({ received: true, ignored: true }); }
      const external = await getCardProvider().retrieveFiatAccount(local.externalAccountId);
      await db.fiatAccount.update({ where: { id: local.id }, data: { status: external.status, availableMinor: external.availableMinor, pendingMinor: external.pendingMinor } });
      await markEvent(record.id, "PROCESSED");
      return NextResponse.json({ received: true });
    }
    if (event.type.startsWith("v2.money_management.inbound_transfer.") || event.type.startsWith("v2.money_management.outbound_transfer.")) {
      if (!event.related_object) throw new Error("MISSING_RELATED_OBJECT");
      const local = await db.fiatTransfer.findUnique({ where: { provider_externalTransferId: { provider: "STRIPE", externalTransferId: event.related_object.id } }, include: { fiatAccount: true } });
      if (!local) { await markEvent(record.id, "IGNORED"); return NextResponse.json({ received: true, ignored: true }); }
      const provider = getCardProvider();
      const external = await provider.retrieveFiatTransfer(local.externalTransferId, local.direction);
      const account = await provider.retrieveFiatAccount(local.fiatAccount.externalAccountId);
      await db.$transaction(async (tx) => {
        await tx.fiatTransfer.update({ where: { id: local.id }, data: { status: external.status } });
        await tx.fiatAccount.update({ where: { id: local.fiatAccountId }, data: { status: account.status, availableMinor: account.availableMinor, pendingMinor: account.pendingMinor } });
        if (local.status !== external.status) await tx.outboxEvent.create({ data: { organizationId: local.organizationId, eventType: `FIAT_${local.direction}_${external.status}`, aggregateType: "FIAT_TRANSFER", aggregateId: local.id, payload: { amountMinor: local.amountMinor.toString(), currency: local.currency, status: external.status } } });
      });
      await markEvent(record.id, "PROCESSED");
      return NextResponse.json({ received: true });
    }
    await markEvent(record.id, "IGNORED");
    return NextResponse.json({ received: true, ignored: true });
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 120) : "PROCESSING_FAILED";
    await markEvent(record.id, "FAILED", code);
    if (event.type === "issuing_authorization.request" && code === "CARD_NOT_FOUND") return NextResponse.json({ approved: false });
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
