import { describe, expect, it } from "vitest";
import { boundedJson, boundedText, handleApiError } from "./api";

describe("bounded JSON bodies", () => {
  it("parses a bounded body and rejects an oversized stream", async () => {
    await expect(boundedJson(new Request("http://localhost", { method: "POST", body: JSON.stringify({ ok: true }) }), 64)).resolves.toEqual({ ok: true });
    await expect(boundedJson(new Request("http://localhost", { method: "POST", body: JSON.stringify({ value: "x".repeat(100) }) }), 32)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("preserves raw webhook text while enforcing a byte limit", async () => {
    const raw = '{"id":"evt_123","type":"issuing_card.updated"}';
    await expect(boundedText(new Request("http://localhost", { method: "POST", body: raw }), 64)).resolves.toBe(raw);
    await expect(boundedText(new Request("http://localhost", { method: "POST", body: raw }), 16)).rejects.toThrow("REQUEST_BODY_TOO_LARGE");
  });

  it("returns safe client errors for oversized and malformed bodies", async () => {
    expect(handleApiError(new Error("REQUEST_BODY_TOO_LARGE")).status).toBe(413);
    expect(handleApiError(new SyntaxError("Unexpected token")).status).toBe(400);
  });
});
