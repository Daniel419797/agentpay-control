import { db } from "@/lib/db";
import { executeAuthorizedIntent } from "@/domain/payment-service";
import { executeAuthorizedMasumiIntent } from "@/domain/masumi-escrow-service";

export async function executeAuthorizedPayment(paymentIntentId: string) {
  const quote = await db.paymentQuote.findUnique({ where: { paymentIntentId }, select: { scheme: true } });
  if (!quote) throw new Error("PAYMENT_QUOTE_MISSING");
  if (quote.scheme === "masumi-escrow") return executeAuthorizedMasumiIntent(paymentIntentId);
  if (quote.scheme === "exact") return executeAuthorizedIntent(paymentIntentId);
  throw new Error("PAYMENT_SCHEME_UNSUPPORTED");
}
