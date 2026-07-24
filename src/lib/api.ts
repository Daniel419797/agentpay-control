import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export function ok<T>(data: T, init?: ResponseInit) { return NextResponse.json({ data }, init); }
export function problem(status: number, code: string, detail: string, meta?: unknown) { return NextResponse.json({ type: `https://agentpay.dev/problems/${code.toLowerCase()}`, title: code.replaceAll("_", " "), status, detail, code, meta }, { status }); }
export function handleApiError(error: unknown) {
  if (error instanceof ZodError) return problem(422, "VALIDATION_ERROR", "The request did not pass validation.", error.flatten());
  console.error(error);
  return problem(500, "INTERNAL_ERROR", "The request could not be completed.");
}

export async function requestBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
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
