import { jwtVerify } from "jose";
import { createHash } from "node:crypto";
import { PublicKey } from "@hiero-ledger/sdk";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { handleApiError, ok, problem, rateLimitProblem, requestBody } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createOperatorSession, provisionWalletOperator, sessionCookie } from "@/lib/session";
import { verifyHederaMessageSignature } from "@/lib/hedera-signature";
import { db } from "@/lib/db";

const verifySchema = z.object({
  challengeToken: z.string().min(20),
  signatureMap: z.string().min(20),
  walletProvider: z.string().min(2).max(80).default("HashPack via WalletConnect"),
});

export async function POST(request: Request) {
  try {
    const rate = await enforceRateLimit(request, { scope: "wallet-auth-verify", limit: 10, windowMs: 15 * 60_000 });
    if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
    const input = verifySchema.parse(await requestBody(request));
    const { payload } = await jwtVerify(input.challengeToken, new TextEncoder().encode(getConfig().AUTH_SECRET), { algorithms: ["HS256"] });
    if (payload.purpose !== "wallet-auth" || typeof payload.accountId !== "string" || typeof payload.nonce !== "string" || typeof payload.jti !== "string") {
      return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge is invalid or expired.");
    }
    const challenge = await db.walletAuthChallenge.findFirst({ where: { id: payload.jti, accountId: payload.accountId, nonceHash: createHash("sha256").update(payload.nonce).digest("hex"), consumedAt: null, expiresAt: { gt: new Date() } } });
    if (!challenge) return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge is invalid, expired, or already used.");
    const message = `AgentPay Control sign in\nNetwork: hedera:testnet\nAccount: ${payload.accountId}\nNonce: ${payload.nonce}`;
    const mirror = await fetch(`${getConfig().HEDERA_MIRROR_NODE_URL}/api/v1/accounts/${payload.accountId}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!mirror.ok) return problem(422, "HEDERA_ACCOUNT_NOT_FOUND", "The selected Hedera testnet account was not found.");
    const account = await mirror.json() as { key?: { key?: string } };
    if (!account.key?.key) return problem(422, "HEDERA_KEY_NOT_FOUND", "The Hedera account does not expose a verifiable public key.");
    const verified = verifyHederaMessageSignature(message, input.signatureMap, PublicKey.fromString(account.key.key));
    if (!verified) return problem(401, "WALLET_SIGNATURE_INVALID", "The wallet signature could not be verified.");
    const consumed = await db.walletAuthChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge has already been used.");
    const operator = await provisionWalletOperator(payload.accountId, input.walletProvider);
    const token = await createOperatorSession(operator);
    return ok({ user: { id: operator.sub, displayName: operator.name }, wallet: { accountId: payload.accountId, network: "hedera:testnet" } }, {
      status: 201,
      headers: { "set-cookie": sessionCookie(token) },
    });
  } catch (error) { return handleApiError(error); }
}
