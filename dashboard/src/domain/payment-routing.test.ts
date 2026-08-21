import { describe, expect, it } from "vitest";

import { paymentAccountForNetwork, providerPayeeForNetwork, x402AssetIdentifier } from "@/domain/payment-routing";
import { parseEnv } from "@/lib/config";

const CARDANO_PREPROD_PROVIDER = "addr_test1vr8nl3s7rk0tqn4rd9u49s0k52f9sezrt98rs4cnpfj47wggeuy4d";
const CARDANO_MAINNET_PROVIDER = "addr1v9x7y0l7m8k3cq4k8w8n6wsysr7t9u3kz3q4j5t6u7v8w9x0y2z3a";

const config = parseEnv({
  ARC_PROVIDER_ADDRESS: "0x2222222222222222222222222222222222222222",
  ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
  HEDERA_PROVIDER_ACCOUNT_ID: "0.0.456",
  HEDERA_MAINNET_PROVIDER_ACCOUNT_ID: "0.0.789",
  CARDANO_PREPROD_PROVIDER_ADDRESS: CARDANO_PREPROD_PROVIDER,
  CARDANO_MAINNET_PROVIDER_ADDRESS: CARDANO_MAINNET_PROVIDER,
});

describe("x402 payment routing", () => {
  it("uses network-native asset identifiers", () => {
    expect(x402AssetIdentifier({ type: "TOKEN", symbol: "USDC", hederaTokenId: null }, "eip155:5042002", config)).toBe("0x3600000000000000000000000000000000000000");
    expect(x402AssetIdentifier({ type: "NATIVE", symbol: "ADA", hederaTokenId: null }, "cardano:preprod", config)).toBe("lovelace");
    expect(x402AssetIdentifier({ type: "NATIVE", symbol: "ADA", hederaTokenId: null }, "cardano:mainnet", config)).toBe("lovelace");
    expect(() => x402AssetIdentifier({ type: "TOKEN", symbol: "USDC", hederaTokenId: null }, "cardano:preprod", config)).toThrow("CARDANO_ASSET_UNSUPPORTED");
  });

  it("selects the active payment account on the quoted network without assuming a deployment-wide payer", () => {
    const accounts = [
      { network: "hedera:testnet", accountId: "0.0.123", status: "ACTIVE", marker: "hedera-agent-a" },
      { network: "eip155:5042002", accountId: "0x1111111111111111111111111111111111111111", status: "ACTIVE", marker: "arc-agent-a" },
      { network: "cardano:preprod", accountId: "addr_test1vr8nl3s7rk0tqn4rd9u49s0k52f9sezrt98rs4cnpfj47wggeuy4d", status: "ACTIVE", marker: "cardano-agent-a" },
    ];
    expect(paymentAccountForNetwork(accounts, "cardano:preprod").marker).toBe("cardano-agent-a");
    expect(() => paymentAccountForNetwork(accounts, "hedera:mainnet")).toThrow("PAYMENT_ACCOUNT_UNAVAILABLE");
  });

  it("uses deployment payees for platform-owned resources", () => {
    const platform = { organizationId: null, status: "ACTIVE", verificationStatus: "VERIFIED", settlementAccountId: "0.0.legacy", settlementAccountVerified: true };
    expect(providerPayeeForNetwork(platform, "hedera:testnet", config)).toBe("0.0.456");
    expect(providerPayeeForNetwork(platform, "hedera:mainnet", config)).toBe("0.0.789");
    expect(providerPayeeForNetwork(platform, "eip155:5042002", config)).toBe("0x2222222222222222222222222222222222222222");
    expect(providerPayeeForNetwork(platform, "cardano:preprod", config)).toBe(CARDANO_PREPROD_PROVIDER);
    expect(providerPayeeForNetwork(platform, "cardano:mainnet", config)).toBe(CARDANO_MAINNET_PROVIDER);
  });

  it("fails closed for organization marketplace settlement outside verified Hedera testnet", () => {
    const provider = { organizationId: "org", status: "ACTIVE", verificationStatus: "VERIFIED", settlementAccountId: "0.0.999", settlementAccountVerified: true };
    expect(providerPayeeForNetwork(provider, "hedera:testnet", config)).toBe("0.0.999");
    expect(() => providerPayeeForNetwork(provider, "hedera:mainnet", config)).toThrow("PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED");
    expect(() => providerPayeeForNetwork(provider, "eip155:5042002", config)).toThrow("PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED");
    expect(() => providerPayeeForNetwork(provider, "cardano:preprod", config)).toThrow("PROVIDER_NETWORK_SETTLEMENT_UNSUPPORTED");
  });
});
