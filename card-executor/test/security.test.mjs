import assert from "node:assert/strict";
import test from "node:test";

import { assertAllowedUrl, isPrivateAddress, normalizeHost, parseTrustedHosts } from "../src/security.mjs";

test("private and special-use addresses are blocked", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.1.1", "192.168.1.1", "169.254.1.1", "100.64.1.1", "0.0.0.0", "224.0.0.1", "::1", "fc00::1", "fe80::1"]) {
    assert.equal(isPrivateAddress(address), true, address);
  }
  assert.equal(isPrivateAddress("8.8.8.8"), false);
});

test("host normalization rejects malformed values", () => {
  assert.equal(normalizeHost("Example.COM."), "example.com");
  for (const value of ["", "example.com/path", "user@example.com", "bad..example.com", "-bad.example.com", "bad-.example.com"]) {
    assert.throws(() => normalizeHost(value));
  }
});

test("trusted hosts are exact and deduplicated", () => {
  assert.deepEqual(parseTrustedHosts("js.stripe.com,JS.STRIPE.COM, checkout.stripe.com"), ["js.stripe.com", "checkout.stripe.com"]);
});

test("egress permits only HTTPS URLs on explicitly allowed hosts", () => {
  const allowed = new Set(["merchant.example"]);
  assert.equal(assertAllowedUrl("https://merchant.example/checkout", allowed).hostname, "merchant.example");
  assert.throws(() => assertAllowedUrl("http://merchant.example/checkout", allowed), /EXECUTOR_HTTPS_REQUIRED/);
  assert.throws(() => assertAllowedUrl("https://other.example/checkout", allowed), /EXECUTOR_EGRESS_BLOCKED/);
  assert.throws(() => assertAllowedUrl("https://user:pass@merchant.example/checkout", allowed), /EXECUTOR_URL_CREDENTIALS_REJECTED/);
});
