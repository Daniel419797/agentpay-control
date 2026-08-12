import { expiredSessionCookie, revokeOperatorSessions, sessionFromRequest } from "@/lib/session";

export async function POST(request: Request) {
  const session = await sessionFromRequest(request);
  if (session) await revokeOperatorSessions(session.sub);
  return new Response(JSON.stringify({ data: { signedOut: true } }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "set-cookie": expiredSessionCookie(),
    },
  });
}
