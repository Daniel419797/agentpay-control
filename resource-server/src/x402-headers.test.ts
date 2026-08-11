import assert from "node:assert/strict";
import test from "node:test";

import { decodeX402Header, encodeX402Header } from "./x402-headers.js";

test("round-trips standard Base64 x402 headers", () => {
  const value = { x402Version: 2, accepts: [{ network: "eip155:5042002" }] };
  const encoded = encodeX402Header(value);
  assert.ok(!encoded.includes("{"));
  assert.deepEqual(decodeX402Header(encoded), value);
});

test("accepts legacy raw JSON only as compatibility input", () => {
  const value = { x402Version: 2 };
  assert.deepEqual(decodeX402Header(JSON.stringify(value)), value);
});

test("rejects oversized x402 headers", () => {
  assert.throws(() => decodeX402Header("A".repeat(10_000), 32), /PAYMENT_HEADER_TOO_LARGE/);
});
