import { z } from "zod";

import { handleApiError, ok, problem, rateLimitProblem, requestBody } from "@/lib/api";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import {
  formatTinybarsAsHbar,
  normalizeTransactionId,
  verifyHederaPayment,
  type MirrorTransaction,
} from "@/lib/hedera-payment";
import { sessionFromRequest } from "@/lib/session";
import { enforceRateLimit } from "@/lib/rate-limit";
import { workspaceForSession } from "@/lib/workspace";

const networkSchema = z.enum(["hedera:testnet", "hedera:mainnet"]).default("hedera:testnet");
const paymentSchema = z.object({
  transactionId: z.string().min(8).max(120),
  payeeAccountId: z.string().regex(/^0\.0\.\d+$/),
  amountTinybar: z.number().int().positive().max(10_000_000_000),
  purpose: z.string().min(2).max(120),
  network: networkSchema,
});
const action = "WALLET_PAYMENT_SETTLED";

function paymentView(event: { targetId: string | null; metadata: unknown; occurredAt: Date }) {
  const metadata = event.metadata as {
    payerAccountId: string;
    payeeAccountId: string;
    amountHbar: string;
    consensusTimestamp: string;
    purpose?: string;
    resource?: string;
    network?: string;
  };
  const network = metadata.network === "hedera:mainnet" ? "mainnet" : "testnet";
  return {
    transactionId: event.targetId,
    ...metadata,
    purpose: metadata.purpose ?? metadata.resource ?? "Hedera payment",
    occurredAt: event.occurredAt.toISOString(),
    hashscanUrl: `https://hashscan.io/${network}/transaction/${event.targetId}`,
  };
}

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before viewing wallet payments.");
  try {
    const workspace = await workspaceForSession(session);
    const events = await db.auditEvent.findMany({
      where: { organizationId: workspace.organization.id, actorId: session.sub, action },
      orderBy: { occurredAt: "desc" },
      take: 10,
    });
    return ok(events.map(paymentView));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before recording a wallet payment.");
    const rate = await enforceRateLimit(request, { scope: "wallet-payment", subject: session.sub, limit: 30, windowMs: 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const workspace = await workspaceForSession(session);
    const input = paymentSchema.parse(await requestBody(request));
    const transactionId = normalizeTransactionId(input.transactionId);
    const identity = await db.walletIdentity.findFirst({
      where: { userId: session.sub, network: input.network },
      orderBy: { verifiedAt: "desc" },
    });
    if (!identity) return problem(409, "WALLET_NOT_LINKED", `Connect and verify a ${input.network} wallet first.`);

    const existing = await db.auditEvent.findFirst({
      where: { organizationId: workspace.organization.id, actorId: session.sub, action, targetId: transactionId },
    });
    if (existing) return ok(paymentView(existing));

    const mirrorUrl = input.network === "hedera:mainnet"
      ? getConfig().HEDERA_MAINNET_MIRROR_NODE_URL
      : getConfig().HEDERA_MIRROR_NODE_URL;
    const mirrorResponse = await fetch(
      `${mirrorUrl}/api/v1/transactions/${encodeURIComponent(transactionId)}`,
      { cache: "no-store", signal: AbortSignal.timeout(10_000) },
    );
    if (mirrorResponse.status === 404) {
      return problem(409, "CONSENSUS_PENDING", "The payment is submitted but not visible on the mirror node yet.");
    }
    if (!mirrorResponse.ok) {
      return problem(502, "MIRROR_NODE_UNAVAILABLE", "The payment could not be verified on Hedera.");
    }
    const mirrorBody = await mirrorResponse.json() as { transactions?: MirrorTransaction[] };
    const transaction = mirrorBody.transactions?.[0];
    if (!transaction || !verifyHederaPayment(transaction, identity.accountId, input.payeeAccountId, input.amountTinybar)) {
      return problem(422, "PAYMENT_VERIFICATION_FAILED", "The Hedera transaction does not match the submitted payment details.");
    }

    const event = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-payment:${workspace.organization.id}:${transactionId}`}, 0))`;
      const duplicate = await tx.auditEvent.findFirst({ where: { organizationId: workspace.organization.id, actorId: session.sub, action, targetId: transactionId } });
      if (duplicate) return duplicate;
      return tx.auditEvent.create({
        data: {
          organizationId: workspace.organization.id,
          actorType: "USER",
          actorId: session.sub,
          action,
          targetType: "HEDERA_TRANSACTION",
          targetId: transaction.transaction_id,
          result: "SUCCESS",
          metadata: {
            payerAccountId: identity.accountId,
            payeeAccountId: input.payeeAccountId,
            amountHbar: formatTinybarsAsHbar(input.amountTinybar),
            consensusTimestamp: transaction.consensus_timestamp,
            purpose: input.purpose,
            network: input.network,
          },
        },
      });
    });
    return ok(paymentView(event), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
