import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("agentpay_session")?.value;
  if (!token) return NextResponse.redirect(new URL("/sign-in", request.url));
  try {
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET), { algorithms: ["HS256"] });
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/sign-in?error=session_expired", request.url));
  }
}

export const config = {
  matcher: ["/app/:path*"],
};
