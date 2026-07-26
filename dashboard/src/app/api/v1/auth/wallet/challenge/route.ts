import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { ok, problem } from "@/lib/api";

const accountSchema = z.string().regex(/^0\.0\.\d+$/);

export async function GET(request: Request) {
  const accountId = new URL(request.url).searchParams.get("accountId");
  const parsed = accountSchema.safeParse(accountId);
  if (!parsed.success) return problem(422, "ACCOUNT_ID_INVALID", "A Hedera account ID is required.");
  const nonce = randomBytes(18).toString("base64url");
  const message = `AgentPay Control sign in\nNetwork: hedera:testnet\nAccount: ${parsed.data}\nNonce: ${nonce}`;
  const challengeToken = await new SignJWT({ accountId: parsed.data, nonce, purpose: "wallet-auth" })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("5m")
    .sign(new TextEncoder().encode(getConfig().AUTH_SECRET));
  return ok({ accountId: parsed.data, network: "hedera:testnet", message, challengeToken });
}
