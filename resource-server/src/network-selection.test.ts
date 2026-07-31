import assert from "node:assert/strict";
import test from "node:test";
import { parseEnabledNetworks, requiresNetwork } from "./network-selection.js";

test("parses a bounded set of enabled networks", () => {
  const enabled = parseEnabledNetworks("hedera:testnet, eip155:5042002");
  assert.equal(enabled.size, 2);
  assert.equal(requiresNetwork(enabled, "hedera:testnet"), true);
  assert.equal(requiresNetwork(enabled, "hedera:mainnet"), false);
});

test("rejects empty and unsupported network configuration", () => {
  assert.throws(() => parseEnabledNetworks(""), /ENABLED_NETWORKS_EMPTY/);
  assert.throws(
    () => parseEnabledNetworks("eip155:1"),
    /ENABLED_NETWORK_UNSUPPORTED:eip155:1/,
  );
});
