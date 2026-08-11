import { describe, expect, it } from "vitest";

import { hederaContractRoute } from "@/domain/hedera-contract-route";

const routingConfig = {
  FACILITATOR_URL: "https://testnet-facilitator.example/hedera",
  FACILITATOR_CONTRACT_API_KEY: "t".repeat(32),
  HEDERA_PAYER_ACCOUNT_ID: "0.0.111",
  HEDERA_MIRROR_NODE_URL: "https://testnet.mirrornode.hedera.com",
  HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.example/hedera",
  HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY: "m".repeat(32),
  HEDERA_MAINNET_PAYER_ACCOUNT_ID: "0.0.222",
  HEDERA_MAINNET_MIRROR_NODE_URL: "https://mainnet-public.mirrornode.hedera.com",
};

describe("Hedera contract routing", () => {
  it("binds testnet execution to testnet facilitator, payer, and mirror", () => {
    const route = hederaContractRoute("hedera:testnet", routingConfig);
    expect(route.networkId).toBe("hedera:testnet");
    expect(route.facilitatorUrl).toContain("testnet-facilitator");
    expect(route.payerAccountId).toBe("0.0.111");
    expect(route.mirrorNodeUrl).toContain("testnet.mirrornode");
  });

  it("binds mainnet execution to independent mainnet credentials", () => {
    const route = hederaContractRoute("hedera:mainnet", routingConfig);
    expect(route.networkId).toBe("hedera:mainnet");
    expect(route.facilitatorUrl).toContain("mainnet-facilitator");
    expect(route.contractApiKey).toBe("m".repeat(32));
    expect(route.payerAccountId).toBe("0.0.222");
    expect(route.mirrorNodeUrl).toContain("mainnet-public.mirrornode");
  });

  it("never falls back from mainnet to testnet credentials", () => {
    expect(() => hederaContractRoute("hedera:mainnet", {
      ...routingConfig,
      HEDERA_MAINNET_FACILITATOR_CONTRACT_API_KEY: undefined,
    })).toThrow("CONTRACT_MAINNET_CAPABILITY_NOT_CONFIGURED");
  });

  it("rejects non-Hedera contract networks", () => {
    expect(() => hederaContractRoute("eip155:5042002", routingConfig)).toThrow("CONTRACT_HEDERA_NETWORK_UNSUPPORTED");
  });
});
