import { cookies } from "next/headers";

import { db } from "@/lib/db";
import {
  SESSION_COOKIE,
  sessionFromRequest,
  verifyOperatorSession,
  type OperatorSession,
} from "@/lib/session";

export const WORKSPACE_COOKIE = process.env.APP_ENV === "production" ? "__Host-agentpay_workspace" : "agentpay_workspace";
export const workspaceRoles = ["OWNER", "OPERATOR", "APPROVER", "VIEWER", "PROVIDER_ADMIN"] as const;
export type WorkspaceRole = (typeof workspaceRoles)[number];

function workspaceCookieValue(cookieHeader: string | null) {
  return cookieHeader?.match(new RegExp(`(?:^|;\\s*)${WORKSPACE_COOKIE}=([^;]+)`))?.[1];
}

export function workspaceCookie(organizationId: string) {
  return `${WORKSPACE_COOKIE}=${encodeURIComponent(organizationId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${process.env.APP_ENV === "production" ? "; Secure" : ""}`;
}

export function clearWorkspaceCookie() {
  return `${WORKSPACE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.APP_ENV === "production" ? "; Secure" : ""}`;
}

export async function workspaceForSession(session: OperatorSession, preferredOrganizationId?: string) {
  const baseWhere = { userId: session.sub, status: "ACTIVE" as const, organization: { status: "ACTIVE" as const } };
  const preferred = preferredOrganizationId
    ? await db.membership.findFirst({
        where: { ...baseWhere, organizationId: preferredOrganizationId },
        include: { organization: true, user: true },
      })
    : null;
  const membership = preferred ?? await db.membership.findFirst({
    where: baseWhere,
    include: { organization: true, user: true },
    orderBy: [{ activatedAt: "asc" }, { invitedAt: "asc" }, { id: "asc" }],
  });
  if (!membership) throw new Error("WORKSPACE_MEMBERSHIP_REQUIRED");
  return { session, membership, organization: membership.organization, user: membership.user };
}

export async function workspaceFromRequest(request: Request) {
  const session = await sessionFromRequest(request);
  if (!session) return null;
  const preferredOrganizationId = workspaceCookieValue(request.headers.get("cookie"));
  return workspaceForSession(session, preferredOrganizationId ? decodeURIComponent(preferredOrganizationId) : undefined);
}

export async function currentWorkspace() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const preferredOrganizationId = jar.get(WORKSPACE_COOKIE)?.value;
    return await workspaceForSession(await verifyOperatorSession(token), preferredOrganizationId);
  } catch {
    return null;
  }
}

export function workspaceHasRole(
  workspace: Awaited<ReturnType<typeof workspaceForSession>>,
  allowed: readonly WorkspaceRole[],
) {
  return workspace.membership.roles.some((role) => allowed.includes(role));
}
