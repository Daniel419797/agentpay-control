import { randomUUID } from "node:crypto";
import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const suppliedRequestId = request.headers.get("x-request-id");
  const requestId = suppliedRequestId && /^[a-zA-Z0-9._:-]{1,128}$/.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const proceed = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  };
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const cookieAuthenticated = Boolean(request.cookies.get("agentpay_session")?.value);
    if (unsafe && cookieAuthenticated) {
      const origin = request.headers.get("origin");
      if (!origin || origin !== request.nextUrl.origin) {
        return NextResponse.json({
          type: "https://agentpay.dev/problems/csrf-rejected",
          title: "CSRF REJECTED",
          status: 403,
          detail: "The request origin could not be verified.",
          code: "CSRF_REJECTED",
        }, { status: 403, headers: { "x-request-id": requestId } });
      }
    }
    return proceed();
  }
  const token = request.cookies.get("agentpay_session")?.value;
  if (!token) return NextResponse.redirect(new URL("/sign-in", request.url));
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET), { algorithms: ["HS256"] });
    return proceed();
  } catch {
    return NextResponse.redirect(new URL("/sign-in?error=session_expired", request.url));
  }
}

export const config = {
  matcher: ["/app/:path*", "/api/:path*"],
};
