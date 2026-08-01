import { describe, expect, it } from "vitest";

import { networkToLedgerIdName } from "./hedera-wallet-connect";

describe("Hedera wallet network mapping", () => {
  it("requests the HashPack mainnet chain for Hedera mainnet", () => {
    expect(networkToLedgerIdName("hedera:mainnet")).toBe("mainnet");
  });

  it("requests the HashPack testnet chain for Hedera testnet", () => {
    expect(networkToLedgerIdName("hedera:testnet")).toBe("testnet");
  });
});
