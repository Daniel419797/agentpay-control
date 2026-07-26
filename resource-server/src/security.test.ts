import assert from "node:assert/strict";
import test from "node:test";

import { boundedJson, sameRequirement, type ExactRequirement } from "./security.js";

const canonical: ExactRequirement = { scheme: "exact", network: "hedera:testnet", amount: "5000000", payTo: "0.0.1234", asset: "0.0.0" };

test("requires the exact canonical amount, payee, asset, and network", () => {
  assert.equal(sameRequirement(canonical, { ...canonical }), true);
  assert.equal(sameRequirement(canonical, { ...canonical, amount: "1" }), false);
  assert.equal(sameRequirement(canonical, { ...canonical, payTo: "0.0.9999" }), false);
});

test("rejects streamed bodies over the configured byte limit", async () => {
  await assert.rejects(
    boundedJson(new Request("http://localhost", { method: "POST", body: JSON.stringify({ prompt: "x".repeat(100) }) }), 32),
    /REQUEST_BODY_TOO_LARGE/,
  );
});
