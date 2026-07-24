import { jwtVerify } from "jose";
import { PublicKey } from "@hiero-ledger/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";
import { handleApiError, ok, problem, requestBody } from "@/lib/api";
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
    const input = linkSchema.parse(await requestBody(request));
    const { payload } = await jwtVerify(input.challengeToken, new TextEncoder().encode(getConfig().AUTH_SECRET), { algorithms: ["HS256"] });
    if (payload.sub !== session.sub || payload.purpose !== "wallet-link" || typeof payload.accountId !== "string" || typeof payload.nonce !== "string") return problem(401, "WALLET_CHALLENGE_INVALID", "The wallet challenge is invalid or expired.");
    const message = `AgentPay Control wallet link\nNetwork: hedera:testnet\nAccount: ${payload.accountId}\nNonce: ${payload.nonce}`;
    const mirror = await fetch(`${getConfig().HEDERA_MIRROR_NODE_URL}/api/v1/accounts/${payload.accountId}`, { cache: "no-store" });
    if (!mirror.ok) return problem(422, "HEDERA_ACCOUNT_NOT_FOUND", "The selected Hedera testnet account was not found.");
    const account = await mirror.json() as { key?: { key?: string } };
    if (!account.key?.key) return problem(422, "HEDERA_KEY_NOT_FOUND", "The Hedera account does not expose a verifiable public key.");
    const verified = verifyHederaMessageSignature(message, input.signatureMap, PublicKey.fromString(account.key.key));
    if (!verified) return problem(401, "WALLET_SIGNATURE_INVALID", "The wallet signature could not be verified.");
    const existing = await db.walletIdentity.findUnique({ where: { network_accountId: { network: "hedera:testnet", accountId: payload.accountId } } });
    if (existing && existing.userId !== session.sub) return problem(409, "WALLET_ALREADY_LINKED", "This wallet is linked to another operator.");
    const identity = existing
      ? await db.walletIdentity.update({ where: { id: existing.id }, data: { verifiedAt: new Date(), walletProvider: input.walletProvider } })
      : await db.walletIdentity.create({ data: { userId: session.sub, network: "hedera:testnet", accountId: payload.accountId, walletProvider: input.walletProvider } });
    return ok({ identity, signatureVerified: true }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before disconnecting a wallet.");
  await db.walletIdentity.deleteMany({ where: { userId: session.sub, network: "hedera:testnet" } });
  return ok({ disconnected: true });
}
