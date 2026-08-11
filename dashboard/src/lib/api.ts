import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { logError } from "@/lib/logger";

export function ok<T>(data: T, init?: ResponseInit) { return NextResponse.json({ data }, init); }
export function problem(status: number, code: string, detail: string, meta?: unknown) { return NextResponse.json({ type: `https://agentpay.dev/problems/${code.toLowerCase()}`, title: code.replaceAll("_", " "), status, detail, code, meta }, { status }); }
export function rateLimitProblem(retryAfterSeconds: number) {
  return NextResponse.json({
    type: "https://agentpay.dev/problems/rate-limited",
    title: "RATE LIMITED",
    status: 429,
    detail: "Too many requests. Try again after the indicated delay.",
    code: "RATE_LIMITED",
  }, { status: 429, headers: { "retry-after": String(retryAfterSeconds) } });
}
export function handleApiError(error: unknown) {
  if (error instanceof ZodError) return problem(422, "VALIDATION_ERROR", "The request did not pass validation.", error.flatten());
  if (error instanceof Error && error.message === "REQUEST_BODY_TOO_LARGE") return problem(413, "REQUEST_BODY_TOO_LARGE", "The request body exceeds the allowed size.");
  if (error instanceof SyntaxError) return problem(400, "INVALID_JSON", "The request body is not valid JSON.");
  logError("api_request_failed", error);
  return problem(500, "INTERNAL_ERROR", "The request could not be completed.");
}

export async function requestBody(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return boundedJson(request, maxBytes);

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(await boundedText(request, maxBytes)).entries());
  }

  // FormData does not expose a streaming size limit. Read the body through the
  // same bounded reader first, then parse a reconstructed in-memory request.
  // This prevents chunked multipart requests from bypassing Content-Length checks.
  const bytes = await boundedBytes(request, maxBytes);
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const boundedRequest = new Request(request.url, {
    method: request.method,
    headers,
    body,
  });
  const form = await boundedRequest.formData();
  return Object.fromEntries(form.entries());
}

export async function boundedJson(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  return JSON.parse(await boundedText(request, maxBytes));
}

export async function boundedText(request: Request, maxBytes = 64 * 1024): Promise<string> {
  return new TextDecoder().decode(await boundedBytes(request, maxBytes));
}

export async function boundedBytes(request: Request, maxBytes = 64 * 1024): Promise<Uint8Array> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("REQUEST_BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function authorizeAgentRequest(request: Request, agentId: string, scope: string) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const secret = authorization.slice(7);
  const prefix = secret.slice(0, 14);
  const credential = await db.agentCredential.findUnique({ where: { prefix } });
  if (!credential || credential.agentId !== agentId || credential.status !== "ACTIVE" || credential.revokedAt || (credential.expiresAt && credential.expiresAt <= new Date()) || !credential.scopes.includes(scope)) return false;
  const actual = Buffer.from(createHash("sha256").update(secret).digest("hex"));
  const expected = Buffer.from(credential.secretHash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
  await db.agentCredential.update({ where: { id: credential.id }, data: { lastUsedAt: new Date() } });
  return true;
}
