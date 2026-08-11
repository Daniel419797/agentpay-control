import { describe, expect, it } from "vitest";
import { boundedBytes, boundedJson, boundedText, handleApiError, requestBody } from "./api";

describe("bounded request bodies", () => {
  it("parses a bounded body and rejects an oversized stream", async () => {
    await expect(boundedJson(new Request("http://localhost", { method: "POST", body: JSON.stringify({ ok: true }) }), 64)).resolves.toEqual({ ok: true });
    await expect(boundedJson(new Request("http://localhost", { method: "POST", body: JSON.stringify({ value: "x".repeat(100) }) }), 32)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("preserves raw webhook text while enforcing a byte limit", async () => {
    const raw = '{"id":"evt_123","type":"issuing_card.updated"}';
    await expect(boundedText(new Request("http://localhost", { method: "POST", body: raw }), 64)).resolves.toBe(raw);
    await expect(boundedText(new Request("http://localhost", { method: "POST", body: raw }), 16)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("rejects streamed bodies that exceed the limit", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(128) }),
    });
    await expect(boundedBytes(request, 32)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("parses bounded urlencoded forms", async () => {
    const request = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=user%40example.com&action=approve",
    });
    await expect(requestBody(request, 1024)).resolves.toEqual({
      email: "user@example.com",
      action: "approve",
    });
  });

  it("parses multipart data only after enforcing the byte limit", async () => {
    const form = new FormData();
    form.set("name", "agent-one");
    form.set("description", "bounded form payload");
    const request = new Request("http://localhost", { method: "POST", body: form });
    await expect(requestBody(request, 4096)).resolves.toEqual({
      name: "agent-one",
      description: "bounded form payload",
    });
  });

  it("rejects oversized multipart data without trusting Content-Length", async () => {
    const form = new FormData();
    form.set("payload", "x".repeat(4096));
    const request = new Request("http://localhost", { method: "POST", body: form });
    await expect(requestBody(request, 256)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("returns safe client errors for oversized and malformed bodies", async () => {
    expect(handleApiError(new Error("REQUEST_BODY_TOO_LARGE")).status).toBe(413);
    expect(handleApiError(new SyntaxError("Unexpected token")).status).toBe(400);
  });
});
