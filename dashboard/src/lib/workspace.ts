import { cookies } from "next/headers";

import { db } from "@/lib/db";
import {
  SESSION_COOKIE,
  sessionFromRequest,
  verifyOperatorSession,
  type OperatorSession,
} from "@/lib/session";

export async function workspaceForSession(session: OperatorSession) {
  const membership = await db.membership.findFirst({
    where: { userId: session.sub },
    include: { organization: true, user: true },
    orderBy: { id: "asc" },
  });
  if (!membership) throw new Error("WORKSPACE_MEMBERSHIP_REQUIRED");
  return { session, membership, organization: membership.organization, user: membership.user };
}

export async function workspaceFromRequest(request: Request) {
  const session = await sessionFromRequest(request);
  return session ? workspaceForSession(session) : null;
}

export async function currentWorkspace() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await workspaceForSession(await verifyOperatorSession(token));
  } catch {
    return null;
  }
}
