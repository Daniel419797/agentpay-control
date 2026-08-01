import { describe, expect, it } from "vitest";

import { accountIdForNetwork } from "@/lib/hedera-wallet-appkit";

describe("Hedera wallet account selection", () => {
  it("selects the account approved for mainnet", () => {
    expect(accountIdForNetwork([
      "hedera:testnet:0.0.1234",
      "hedera:mainnet:0.0.5678",
    ], "hedera:mainnet")).toBe("0.0.5678");
  });

  it("does not reuse an account approved for another network", () => {
    expect(accountIdForNetwork([
      "hedera:mainnet:0.0.5678",
    ], "hedera:testnet")).toBeNull();
  });
});
