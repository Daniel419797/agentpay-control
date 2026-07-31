import { NextResponse } from "next/server";
import { z } from "zod";

import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";

const requirementSchema = z.object({ scheme: z.literal("exact"), network: z.string(), asset: z.string(), amount: z.string().regex(/^\d+$/), payTo: z.string(), maxTimeoutSeconds: z.number().int().positive(), extra: z.record(z.string(), z.unknown()).default({}) });
const paymentPayloadSchema = z.object({ x402Version: z.literal(2), accepted: requirementSchema, payload: z.record(z.string(), z.unknown()) }).passthrough();
const verifySchema = z.object({ isValid: z.boolean(), invalidReason: z.string().optional() });
const settleSchema = z.object({ success: z.boolean(), transaction: z.string().optional(), transactionId: z.string().optional(), errorReason: z.string().optional() });

function sameRequirement(left: z.infer<typeof requirementSchema>, right: z.infer<typeof requirementSchema>) {
  return left.scheme === right.scheme && left.network === right.network && left.asset === right.asset && left.amount === right.amount && left.payTo === right.payTo;
}

export async function GET(request: Request, context: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await context.params;
  const config = getConfig();
  const invoice = await db.agentInvoice.findUnique({ where: { id: invoiceId }, include: { asset: true, issuerAgent: { include: { accounts: { where: { status: "ACTIVE" } } } }, settlement: true } });
  if (!invoice) return NextResponse.json({ code: "INVOICE_NOT_FOUND" }, { status: 404 });
  if (invoice.status === "VOID" || invoice.status === "DRAFT") return NextResponse.json({ code: "INVOICE_NOT_COLLECTIBLE" }, { status: 409 });
  const canonicalUrl = new URL(`/api/v1/invoices/${invoice.id}/collect`, config.NEXT_PUBLIC_APP_URL).toString();
  if (invoice.settlement) {
    const paymentResponse = { x402Version: 2, transactionId: invoice.settlement.transactionId, network: invoice.settlement.network, settledAt: invoice.settlement.settledAt.toISOString() };
    return NextResponse.json({ invoiceId: invoice.id, invoiceNumber: invoice.number, status: "PAID", settled: paymentResponse }, { headers: { "payment-response": JSON.stringify(paymentResponse), "cache-control": "private, no-store" } });
  }
  const payTo = invoice.issuerAgent.accounts[0]?.accountId;
  if (!payTo) return NextResponse.json({ code: "INVOICE_PAYEE_UNAVAILABLE" }, { status: 503 });
  const requirement = requirementSchema.parse({ scheme: "exact", network: invoice.issuerAgent.network, asset: invoice.asset.type === "NATIVE" ? "0.0.0" : invoice.asset.hederaTokenId, amount: invoice.totalAtomic.toString(), payTo, maxTimeoutSeconds: 900, extra: config.HEDERA_PAYER_ACCOUNT_ID ? { feePayer: config.HEDERA_PAYER_ACCOUNT_ID } : {} });
  const challenge = { x402Version: 2, accepts: [requirement], resource: { url: canonicalUrl, description: `Settlement for invoice ${invoice.number}`, mimeType: "application/json", serviceName: "AgentPay Invoicing" } };
  const signatureHeader = request.headers.get("payment-signature");
  if (!signatureHeader) return NextResponse.json({ code: "PAYMENT_REQUIRED", message: `Payment is required for invoice ${invoice.number}`, paymentRequirements: challenge }, { status: 402, headers: { "payment-required": JSON.stringify(challenge), "cache-control": "no-store" } });
  if (signatureHeader.length > 128 * 1024) return NextResponse.json({ code: "PAYMENT_PAYLOAD_TOO_LARGE" }, { status: 413 });
  let paymentPayload: z.infer<typeof paymentPayloadSchema>;
  let clientRequirement: z.infer<typeof requirementSchema>;
  try {
    paymentPayload = paymentPayloadSchema.parse(JSON.parse(signatureHeader));
    clientRequirement = requirementSchema.parse(JSON.parse(request.headers.get("payment-requirements") ?? "{}"));
  } catch { return NextResponse.json({ code: "PAYMENT_INVALID" }, { status: 402 }); }
  if (!sameRequirement(clientRequirement, requirement) || !sameRequirement(paymentPayload.accepted, requirement)) return NextResponse.json({ code: "PAYMENT_REQUIREMENT_MISMATCH" }, { status: 402 });
  const intent = await db.paymentIntent.findFirst({ where: { agentId: invoice.recipientAgentId, resourceUrl: canonicalUrl, status: "SIGNING", quote: { amountAtomic: invoice.totalAtomic, payToAccountId: payTo, assetId: invoice.assetId } }, orderBy: { updatedAt: "desc" } });
  if (!intent) return NextResponse.json({ code: "INVOICE_PAYMENT_INTENT_NOT_FOUND" }, { status: 409 });
  const settlementApiKey = config.FACILITATOR_SETTLEMENT_API_KEY ?? config.FACILITATOR_API_KEY;
  if (!config.FACILITATOR_URL || !settlementApiKey) return NextResponse.json({ code: "FACILITATOR_UNAVAILABLE" }, { status: 503 });
  const facilitatorHeaders = { "content-type": "application/json", authorization: `Bearer ${settlementApiKey}` };
  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`invoice-collect:${invoice.id}`}, 0))`;
    const existing = await tx.invoiceSettlement.findUnique({ where: { invoiceId: invoice.id } });
    if (existing) return { transactionId: existing.transactionId, settledAt: existing.settledAt };
    const currentInvoice = await tx.agentInvoice.findUnique({ where: { id: invoice.id }, select: { status: true } });
    if (!currentInvoice || ["PAID", "VOID", "DRAFT"].includes(currentInvoice.status)) throw new Error("INVOICE_NOT_COLLECTIBLE");
    const verifyResponse = await fetch(`${config.FACILITATOR_URL}/verify`, { method: "POST", headers: { ...facilitatorHeaders, "idempotency-key": `invoice:${invoice.id}:${intent.id}` }, body: JSON.stringify({ paymentPayload, paymentRequirements: requirement }), signal: AbortSignal.timeout(15_000) });
    const verified = verifySchema.safeParse(await verifyResponse.json().catch(() => ({})));
    if (!verifyResponse.ok || !verified.success || !verified.data.isValid) throw new Error(`PAYMENT_INVALID:${verified.success ? verified.data.invalidReason ?? "invalid" : "invalid_response"}`);
    const settleResponse = await fetch(`${config.FACILITATOR_URL}/settle`, { method: "POST", headers: { ...facilitatorHeaders, "idempotency-key": `invoice:${invoice.id}:${intent.id}` }, body: JSON.stringify({ paymentPayload, paymentRequirements: requirement }), signal: AbortSignal.timeout(30_000) });
    const settled = settleSchema.safeParse(await settleResponse.json().catch(() => ({})));
    const transactionId = settled.success ? settled.data.transactionId ?? settled.data.transaction : undefined;
    if (!settleResponse.ok || !settled.success || !settled.data.success || !transactionId) throw new Error(`SETTLEMENT_FAILED:${settled.success ? settled.data.errorReason ?? "failed" : "invalid_response"}`);
    const settledAt = new Date();
    await tx.agentInvoice.update({ where: { id: invoice.id }, data: { status: "PAID", paidAt: settledAt } });
    await tx.invoiceSettlement.create({ data: { invoiceId: invoice.id, paymentIntentId: intent.id, transactionId, network: requirement.network, settledAt } });
    await tx.resourceListing.updateMany({ where: { endpoint: canonicalUrl }, data: { status: "PAUSED" } });
    await tx.invoiceEvent.create({ data: { invoiceId: invoice.id, actorType: "AGENT", actorId: invoice.recipientAgentId, action: "INVOICE_PAID", metadata: { paymentIntentId: intent.id, transactionId } } });
    await tx.outboxEvent.createMany({ data: [invoice.issuerOrganizationId, invoice.recipientOrganizationId].map((organizationId) => ({ organizationId, eventType: "AGENT_INVOICE_PAID", aggregateType: "AGENT_INVOICE", aggregateId: invoice.id, payload: { invoiceNumber: invoice.number, transactionId, totalAtomic: invoice.totalAtomic.toString(), asset: invoice.asset.symbol } })) });
    return { transactionId, settledAt };
  }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 60_000 }).catch((error: unknown) => {
    if (error instanceof Error && error.message.startsWith("PAYMENT_INVALID:")) return { error: "PAYMENT_INVALID", reason: error.message.slice(16) } as const;
    if (error instanceof Error && error.message.startsWith("SETTLEMENT_FAILED:")) return { error: "SETTLEMENT_FAILED", reason: error.message.slice(18) } as const;
    if (error instanceof Error && error.message === "INVOICE_NOT_COLLECTIBLE") return { error: error.message, reason: "Invoice state changed before settlement." } as const;
    throw error;
  });
  if ("error" in result) return NextResponse.json({ code: result.error, reason: result.reason }, { status: result.error === "PAYMENT_INVALID" ? 402 : result.error === "INVOICE_NOT_COLLECTIBLE" ? 409 : 422 });
  const paymentResponse = { x402Version: 2, transactionId: result.transactionId, network: requirement.network, settledAt: result.settledAt.toISOString() };
  return NextResponse.json({ invoiceId: invoice.id, invoiceNumber: invoice.number, status: "PAID", settled: paymentResponse }, { headers: { "payment-response": JSON.stringify(paymentResponse), "cache-control": "private, no-store" } });
}
