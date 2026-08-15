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
import {
  isWalletNetwork,
  normalizeWalletAccount,
  verifyCardanoWalletSignature,
  verifyEvmWalletSignature,
  walletChallengeMessage,
} from "@/lib/wallet-identity";

const walletProviderSchema = z.string().trim().min(2).max(80);
const linkSchema = z.discriminatedUnion("proofType", [
  z.object({ proofType: z.literal("hedera"), challengeToken: z.string().min(20), signatureMap: z.string().min(20), walletProvider: walletProviderSchema }),
  z.object({ proofType: z.literal("evm"), challengeToken: z.string().min(20), signature: z.string().min(100).max(300), walletProvider: walletProviderSchema }),
  z.object({ proofType: z.literal("cardano"), challengeToken: z.string().min(20), signature: z.object({ key: z.string().min(20).max(1000), signature: z.string().min(20).max(2000) }), walletProvider: walletProviderSchema }),
]);

function mirrorNodeUrl(network: string): string {
  const config = getConfig();
  return network === "hedera:mainnet" ? config.HEDERA_MAINNET_MIRROR_NODE_URL : config.HEDERA_MIRROR_NODE_URL;
}

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
    const network = typeof payload.network === "string" ? payload.network : "hedera:testnet";
    if (!isWalletNetwork(network)) return problem(422, "NETWORK_UNSUPPORTED", `Network ${network} is not supported for wallet link.`);
    let accountId: string;
    try {
      accountId = normalizeWalletAccount(network, payload.accountId);
    } catch {
      return problem(422, "ACCOUNT_ID_INVALID", `The account is not valid for ${network}.`);
    }
    const challenge = await db.walletAuthChallenge.findFirst({ where: { id: payload.jti, accountId: payload.accountId, nonceHash: createHash("sha256").update(payload.nonce).digest("hex"), consumedAt: null, expiresAt: { gt: new Date() } } });
    if (!challenge) return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge is invalid, expired, or already used.");
    const message = walletChallengeMessage(network, accountId, payload.nonce);
    let verified = false;
    if (network.startsWith("hedera:") && input.proofType === "hedera") {
      const mirror = await fetch(`${mirrorNodeUrl(network)}/api/v1/accounts/${accountId}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!mirror.ok) return problem(422, "HEDERA_ACCOUNT_NOT_FOUND", `The selected ${network} account was not found.`);
      const account = await mirror.json() as { key?: { key?: string } };
      if (!account.key?.key) return problem(422, "HEDERA_KEY_NOT_FOUND", "The Hedera account does not expose a verifiable public key.");
      verified = verifyHederaMessageSignature(message, input.signatureMap, PublicKey.fromString(account.key.key));
    } else if (network.startsWith("eip155:") && input.proofType === "evm") {
      verified = verifyEvmWalletSignature(message, input.signature, accountId);
    } else if (network.startsWith("cardano:") && input.proofType === "cardano") {
      verified = await verifyCardanoWalletSignature(message, input.signature, accountId);
    } else {
      return problem(422, "WALLET_PROOF_TYPE_INVALID", `The proof type does not match ${network}.`);
    }
    if (!verified) return problem(401, "WALLET_SIGNATURE_INVALID", "The wallet signature could not be verified.");
    const identity = await db.$transaction(async (tx) => {
      const consumed = await tx.walletAuthChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new Error("WALLET_CHALLENGE_CONSUMED");
      const existing = await tx.walletIdentity.findUnique({ where: { network_accountId: { network, accountId } } });
      if (existing && existing.userId !== session.sub) throw new Error("WALLET_ALREADY_LINKED");
      return existing
        ? tx.walletIdentity.update({ where: { id: existing.id }, data: { verifiedAt: new Date(), walletProvider: input.walletProvider } })
        : tx.walletIdentity.create({ data: { userId: session.sub, network, accountId, walletProvider: input.walletProvider } });
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
  const url = new URL(request.url);
  const network = url.searchParams.get("network") ?? "hedera:testnet";
  if (!isWalletNetwork(network)) return problem(422, "NETWORK_UNSUPPORTED", `Network ${network} is not supported for wallet link.`);
  await db.walletIdentity.deleteMany({ where: { userId: session.sub, network } });
  return ok({ disconnected: true, network });
}
