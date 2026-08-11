import { db } from "@/lib/db";
import { executeAuthorizedIntent } from "@/domain/payment-service";
import { executeAuthorizedMasumiIntent } from "@/domain/masumi-escrow-service";
import { revalidateOracleAuthorizationBeforeExecution } from "@/domain/oracle-authorization-guard";

export async function executeAuthorizedPayment(paymentIntentId: string) {
  const quote = await db.paymentQuote.findUnique({ where: { paymentIntentId }, select: { scheme: true } });
  if (!quote) throw new Error("PAYMENT_QUOTE_MISSING");
  await revalidateOracleAuthorizationBeforeExecution(paymentIntentId);
  if (quote.scheme === "masumi-escrow") return executeAuthorizedMasumiIntent(paymentIntentId);
  if (quote.scheme === "exact") return executeAuthorizedIntent(paymentIntentId);
  throw new Error("PAYMENT_SCHEME_UNSUPPORTED");
}
