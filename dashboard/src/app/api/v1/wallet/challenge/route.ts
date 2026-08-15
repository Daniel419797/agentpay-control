import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { ok, problem, rateLimitProblem } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";
import { isWalletNetwork, normalizeWalletAccount, walletChallengeMessage } from "@/lib/wallet-identity";

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before connecting a wallet.");
  const rate = await enforceRateLimit(request, { scope: "wallet-link-challenge", subject: session.sub, limit: 10, windowMs: 15 * 60_000 });
  if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
  const url = new URL(request.url);
  const requestedNetwork = url.searchParams.get("network") ?? "hedera:testnet";
  if (!isWalletNetwork(requestedNetwork)) return problem(422, "NETWORK_UNSUPPORTED", `Network ${requestedNetwork} is not supported for wallet link.`);
  const parsed = z.string().min(1).max(180).safeParse(url.searchParams.get("accountId"));
  if (!parsed.success) return problem(422, "ACCOUNT_ID_INVALID", "A wallet account or address is required.");
  let accountId: string;
  try {
    accountId = normalizeWalletAccount(requestedNetwork, parsed.data);
  } catch {
    return problem(422, "ACCOUNT_ID_INVALID", `The account is not valid for ${requestedNetwork}.`);
  }
  const nonce = randomBytes(18).toString("base64url");
  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const message = walletChallengeMessage(requestedNetwork, accountId, nonce);
  await db.walletAuthChallenge.create({ data: { id: challengeId, accountId, nonceHash: createHash("sha256").update(nonce).digest("hex"), expiresAt } });
  const challengeToken = await new SignJWT({ accountId, network: requestedNetwork, nonce, purpose: "wallet-link" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(session.sub).setJti(challengeId).setIssuedAt().setExpirationTime("5m")
    .sign(new TextEncoder().encode(getConfig().AUTH_SECRET));
  return ok({ accountId, network: requestedNetwork, message, challengeToken });
}
