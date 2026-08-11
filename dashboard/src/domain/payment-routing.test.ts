import { describe, expect, it } from "vitest";

import { managedPayerMatches, paymentAccountForNetwork, providerPayeeForNetwork, x402AssetIdentifier } from "@/domain/payment-routing";
import { parseEnv } from "@/lib/config";

const config = parseEnv({
  ARC_PAYER_ADDRESS: "0x1111111111111111111111111111111111111111",
  ARC_PROVIDER_ADDRESS: "0x2222222222222222222222222222222222222222",
  ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  HEDERA_PAYER_ACCOUNT_ID: "0.0.123",
  HEDERA_PROVIDER_ACCOUNT_ID: "0.0.456",
  HEDERA_MAINNET_PROVIDER_ACCOUNT_ID: "0.0.789",
});

describe("x402 payment routing", () => {
  it("uses Arc USDC contract identity instead of a Hedera token id", () => {
    expect(x402AssetIdentifier({ type: "TOKEN", symbol: "USDC", hederaTokenId: null }, "eip155:5042002", config)).toBe("0x3600000000000000000000000000000000000000");
  });

  it("selects the active payment account on the quoted network", () => {
    const accounts = [
      { network: "hedera:testnet", accountId: "0.0.123", status: "ACTIVE", marker: "hedera" },
      { network: "eip155:5042002", accountId: "0x1111111111111111111111111111111111111111", status: "ACTIVE", marker: "arc" },
    ];
    expect(paymentAccountForNetwork(accounts, "eip155:5042002").marker).toBe("arc");
    expect(() => paymentAccountForNetwork(accounts, "hedera:mainnet")).toThrow("PAYMENT_ACCOUNT_UNAVAILABLE");
  });

  it("binds managed payer identity to its network", () => {
    expect(managedPayerMatches({ network: "hedera:testnet", accountId: "0.0.123", status: "ACTIVE" }, config)).toBe(true);
    expect(managedPayerMatches({ network: "eip155:5042002", accountId: "0x1111111111111111111111111111111111111111", status: "ACTIVE" }, config)).toBe(true);
    expect(managedPayerMatches({ network: "eip155:5042002", accountId: "0x3333333333333333333333333333333333333333", status: "ACTIVE" }, config)).toBe(false);
  });

  it("uses deployment payees for platform-owned resources", () => {
    const platform = { organizationId: null, status: "ACTIVE", verificationStatus: "VERIFIED", settlementAccountId: "0.0.legacy", settlementAccountVerified: true };
    expect(providerPayeeForNetwork(platform, "hedera:testnet", config)).toBe("0.0.456");
    expect(providerPayeeForNetwork(platform, "hedera:mainnet", config)).toBe("0.0.789");
    expect(providerPayeeForNetwork(platform, "eip155:5042002", config)).toBe("0x2222222222222222222222222222222222222222");
  });

  it("fails closed for organization marketplace settlement outside verified Hedera testnet", () => {
    const provider = { organizationId: "org", status: "ACTIVE", verificationStatus: "VERIFIED", settlementAccountId: "0.0.999", settlementAccountVerified: true };
    expect(providerPayeeForNetwork(provider, "hedera:testnet", config)).toBe("0.0.999");
    expect(() => providerPayeeForNetwork(provider, "hedera:mainnet", config)).toThrow("PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED");
    expect(() => providerPayeeForNetwork(provider, "eip155:5042002", config)).toThrow("PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED");
  });
});
