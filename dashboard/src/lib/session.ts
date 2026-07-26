import { SignJWT, jwtVerify } from "jose";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/config";

export const SESSION_COOKIE = "agentpay_session";
export type OperatorSession = {
  sub: string;
  email: string | null;
  name: string;
  mode: "supabase" | "wallet";
  authenticatedAt: number;
};

export const STEP_UP_MAX_AGE_SECONDS = 10 * 60;

function key() { return new TextEncoder().encode(getConfig().AUTH_SECRET); }

export async function createOperatorSession(session: Omit<OperatorSession, "authenticatedAt">) {
  return new SignJWT({ email: session.email, name: session.name, mode: session.mode }).setProtectedHeader({ alg: "HS256" }).setSubject(session.sub).setIssuedAt().setExpirationTime("8h").sign(key());
}

export async function verifyOperatorSession(token: string): Promise<OperatorSession> {
  const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
  if (!payload.sub || typeof payload.name !== "string" || typeof payload.iat !== "number" || !["supabase", "wallet"].includes(payload.mode as string)) throw new Error("INVALID_SESSION");
  return { sub: payload.sub, email: (payload.email as string) ?? null, name: payload.name, mode: payload.mode as "supabase" | "wallet", authenticatedAt: payload.iat };
}

export function hasRecentAuthentication(
  session: OperatorSession,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const age = nowSeconds - session.authenticatedAt;
  return age >= 0 && age <= STEP_UP_MAX_AGE_SECONDS;
}

export async function sessionFromRequest(request: Request) {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)agentpay_session=([^;]+)/)?.[1];
  if (!token) return null;
  try { return await verifyOperatorSession(token); } catch { return null; }
}

export async function provisionSupabaseOperator(user: { id: string; email?: string; user_metadata?: { name?: string; full_name?: string } }) {
  const email = user.email?.toLowerCase();
  if (!email) throw new Error("SUPABASE_USER_EMAIL_REQUIRED");
  const displayName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? email.split("@")[0];
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`supabase-user:${email}`}, 0))`;
    const existing = await tx.user.findUnique({ where: { email } });
    const appUser = existing ?? await tx.user.create({ data: { id: user.id, email, displayName } });
    let membership = await tx.membership.findFirst({ where: { userId: appUser.id, status: { in: ["ACTIVE", "INVITED"] } }, orderBy: { invitedAt: "asc" } });
    if (membership?.status === "INVITED") {
      membership = await tx.membership.update({ where: { id: membership.id }, data: { status: "ACTIVE", activatedAt: new Date(), suspendedAt: null } });
      await tx.auditEvent.create({ data: { organizationId: membership.organizationId, actorType: "USER", actorId: appUser.id, action: "MEMBERSHIP_ACCEPTED", targetType: "MEMBERSHIP", targetId: membership.id, result: "SUCCESS", metadata: {} } });
    }
    if (!membership) {
      const slugBase = email.split("@")[0].replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
      const organization = await tx.organization.create({
        data: {
          name: `${displayName}'s workspace`,
          slug: `${slugBase}-${appUser.id.slice(0, 8)}`,
          memberships: { create: { userId: appUser.id, roles: ["OWNER", "OPERATOR", "APPROVER", "PROVIDER_ADMIN"], activatedAt: new Date() } },
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: organization.id,
          actorType: "USER",
          actorId: appUser.id,
          action: "WORKSPACE_CREATED",
          targetType: "ORGANIZATION",
          targetId: organization.id,
          result: "SUCCESS",
          metadata: {},
        },
      });
    }
    return { sub: appUser.id, email, name: appUser.displayName, mode: "supabase" as const };
  }, { isolationLevel: "Serializable" });
}

export function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${getConfig().APP_ENV === "production" ? "; Secure" : ""}`;
}

export async function provisionWalletOperator(accountId: string, walletProvider: string) {
  const network = "hedera:testnet";
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`wallet-user:${network}:${accountId}`}, 0))`;
    const existingIdentity = await tx.walletIdentity.findUnique({ where: { network_accountId: { network, accountId } } });
    if (existingIdentity) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: existingIdentity.userId } });
      return { sub: user.id, email: null, name: user.displayName, mode: "wallet" as const };
    }
    const displayName = `Wallet ${accountId}`;
    const user = await tx.user.create({ data: { displayName } });
    const slug = `wallet-${accountId.replace(/\./g, "-")}-${user.id.slice(0, 8)}`;
    const organization = await tx.organization.create({
      data: {
        name: `${displayName}'s workspace`,
        slug,
        memberships: { create: { userId: user.id, roles: ["OWNER", "OPERATOR", "APPROVER", "PROVIDER_ADMIN"], activatedAt: new Date() } },
      },
    });
    await tx.walletIdentity.create({ data: { userId: user.id, network, accountId, walletProvider } });
    await tx.auditEvent.create({
      data: {
        organizationId: organization.id, actorType: "USER", actorId: user.id,
        action: "WORKSPACE_CREATED", targetType: "ORGANIZATION", targetId: organization.id,
        result: "SUCCESS", metadata: { authMethod: "wallet", accountId },
      },
    });
    return { sub: user.id, email: null, name: displayName, mode: "wallet" as const };
  }, { isolationLevel: "Serializable" });
}
