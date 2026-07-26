import { jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { PublicKey } from "@hiero-ledger/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { handleApiError, ok, problem, rateLimitProblem, requestBody } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sessionFromRequest } from "@/lib/session";
import { verifyHederaMessageSignature } from "@/lib/hedera-signature";

const linkSchema = z.object({ challengeToken: z.string().min(20), signatureMap: z.string().min(20), walletProvider: z.string().min(2).max(80).default("HashPack via WalletConnect") });

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before viewing wallet identities.");
  try {
    const identities = await db.walletIdentity.findMany({ where: { userId: session.sub }, orderBy: { verifiedAt: "desc" } });
    return ok({ identities, walletOptional: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before connecting a wallet.");
    const rate = await enforceRateLimit(request, { scope: "wallet-link-verify", subject: session.sub, limit: 10, windowMs: 15 * 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const input = linkSchema.parse(await requestBody(request));
    const { payload } = await jwtVerify(input.challengeToken, new TextEncoder().encode(getConfig().AUTH_SECRET), { algorithms: ["HS256"] });
    if (payload.sub !== session.sub || payload.purpose !== "wallet-link" || typeof payload.accountId !== "string" || typeof payload.nonce !== "string" || typeof payload.jti !== "string") return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge is invalid or expired.");
    const challenge = await db.walletAuthChallenge.findFirst({ where: { id: payload.jti, accountId: payload.accountId, nonceHash: createHash("sha256").update(payload.nonce).digest("hex"), consumedAt: null, expiresAt: { gt: new Date() } } });
    if (!challenge) return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge is invalid, expired, or already used.");
    const message = `AgentPay Control wallet link\nNetwork: hedera:testnet\nAccount: ${payload.accountId}\nNonce: ${payload.nonce}`;
    const mirror = await fetch(`${getConfig().HEDERA_MIRROR_NODE_URL}/api/v1/accounts/${payload.accountId}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!mirror.ok) return problem(422, "HEDERA_ACCOUNT_NOT_FOUND", "The selected Hedera testnet account was not found.");
    const account = await mirror.json() as { key?: { key?: string } };
    if (!account.key?.key) return problem(422, "HEDERA_KEY_NOT_FOUND", "The Hedera account does not expose a verifiable public key.");
    const verified = verifyHederaMessageSignature(message, input.signatureMap, PublicKey.fromString(account.key.key));
    if (!verified) return problem(401, "WALLET_SIGNATURE_INVALID", "The wallet signature could not be verified.");
    const identity = await db.$transaction(async (tx) => {
      const consumed = await tx.walletAuthChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new Error("WALLET_CHALLENGE_CONSUMED");
      const existing = await tx.walletIdentity.findUnique({ where: { network_accountId: { network: "hedera:testnet", accountId: payload.accountId as string } } });
      if (existing && existing.userId !== session.sub) throw new Error("WALLET_ALREADY_LINKED");
      return existing
        ? tx.walletIdentity.update({ where: { id: existing.id }, data: { verifiedAt: new Date(), walletProvider: input.walletProvider } })
        : tx.walletIdentity.create({ data: { userId: session.sub, network: "hedera:testnet", accountId: payload.accountId as string, walletProvider: input.walletProvider } });
    });
    return ok({ identity, signatureVerified: true }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "WALLET_CHALLENGE_CONSUMED") return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge has already been used.");
    if (error instanceof Error && error.message === "WALLET_ALREADY_LINKED") return problem(409, error.message, "This wallet is linked to another operator.");
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before disconnecting a wallet.");
  await db.walletIdentity.deleteMany({ where: { userId: session.sub, network: "hedera:testnet" } });
  return ok({ disconnected: true });
}
