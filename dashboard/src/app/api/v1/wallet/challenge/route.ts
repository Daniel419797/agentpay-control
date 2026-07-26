import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { ok, problem, rateLimitProblem } from "@/lib/api";
import { enforceRateLimit } from "@/lib/rate-limit";
import { sessionFromRequest } from "@/lib/session";
import { db } from "@/lib/db";

const accountSchema = z.string().regex(/^0\.0\.\d+$/);

export async function GET(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return problem(401, "AUTH_REQUIRED", "Sign in before connecting a wallet.");
  const rate = await enforceRateLimit(request, { scope: "wallet-link-challenge", subject: session.sub, limit: 10, windowMs: 15 * 60_000 });
  if (!rate.allowed) return rateLimitProblem(rate.retryAfterSeconds);
  const accountId = new URL(request.url).searchParams.get("accountId");
  const parsed = accountSchema.safeParse(accountId);
  if (!parsed.success) return problem(422, "ACCOUNT_ID_INVALID", "A Hedera account ID is required.");
  const nonce = randomBytes(18).toString("base64url");
  const challengeId = randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const message = `AgentPay Control wallet link\nNetwork: hedera:testnet\nAccount: ${parsed.data}\nNonce: ${nonce}`;
  await db.walletAuthChallenge.create({ data: { id: challengeId, accountId: parsed.data, nonceHash: createHash("sha256").update(nonce).digest("hex"), expiresAt } });
  const challengeToken = await new SignJWT({ accountId: parsed.data, nonce, purpose: "wallet-link" })
    .setProtectedHeader({ alg: "HS256" }).setSubject(session.sub).setJti(challengeId).setIssuedAt().setExpirationTime("5m")
    .sign(new TextEncoder().encode(getConfig().AUTH_SECRET));
  return ok({ accountId: parsed.data, network: "hedera:testnet", message, challengeToken });
}
