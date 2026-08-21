import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({ getConfig: vi.fn() }));

import { getConfig } from "@/lib/config";
import { getNetworkRouter, resetNetworkRouter } from "@/domain/network-router";

const mockedGetConfig = vi.mocked(getConfig);

function config(overrides: Record<string, unknown> = {}) {
  return {
    APP_ENV: "production",
    FACILITATOR_URL: "https://facilitator.example/hedera",
    FACILITATOR_SIGNING_API_KEY: "hedera-signing-key",
    FACILITATOR_API_KEY: undefined,
    HEDERA_MAINNET_FACILITATOR_URL: "",
    HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY: undefined,
    HEDERA_MAINNET_FACILITATOR_API_KEY: undefined,
    ARC_FACILITATOR_URL: "https://facilitator.example/arc",
    ARC_FACILITATOR_SIGNING_API_KEY: "arc-signing-key",
    ARC_FACILITATOR_API_KEY: undefined,
    ARC_USDC_ADDRESS: "0x3600000000000000000000000000000000000000",
    CARDANO_PREPROD_FACILITATOR_URL: "",
    CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: undefined,
    CARDANO_PREPROD_FACILITATOR_API_KEY: undefined,
    CARDANO_PREPROD_PROVIDER_ADDRESS: undefined,
    CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: undefined,
    CARDANO_MAINNET_FACILITATOR_URL: "",
    CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY: undefined,
    CARDANO_MAINNET_FACILITATOR_API_KEY: undefined,
    CARDANO_MAINNET_PROVIDER_ADDRESS: undefined,
    CARDANO_MAINNET_BLOCKFROST_PROJECT_ID: undefined,
    ...overrides,
  } as ReturnType<typeof getConfig>;
}

describe("network router", () => {
  beforeEach(() => { resetNetworkRouter(); vi.clearAllMocks(); });

  it("does not advertise unconfigured mainnet or Cardano rails in production", () => {
    mockedGetConfig.mockReturnValue(config());
    const router = getNetworkRouter();
    expect(router.supportsNetwork("hedera:testnet")).toBe(true);
    expect(router.supportsNetwork("eip155:5042002")).toBe(true);
    expect(router.supportsNetwork("hedera:mainnet")).toBe(false);
    expect(router.supportsNetwork("cardano:preprod")).toBe(false);
    expect(router.supportsNetwork("cardano:mainnet")).toBe(false);
    expect(() => router.getRoute("hedera:mainnet")).toThrow(/NETWORK_UNSUPPORTED/);
  });

  it("does not advertise a production mainnet URL without its signing credential", () => {
    mockedGetConfig.mockReturnValue(config({ HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.example/hedera" }));
    expect(getNetworkRouter().supportsNetwork("hedera:mainnet")).toBe(false);
  });

  it("advertises Hedera mainnet when its production facilitator and signer are configured", () => {
    mockedGetConfig.mockReturnValue(config({ HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.example/hedera", HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY: "mainnet-signing-key" }));
    const route = getNetworkRouter().getRoute("hedera:mainnet");
    expect(route.facilitatorUrl).toBe("https://mainnet-facilitator.example/hedera");
    expect(route.facilitatorApiKey).toBe("mainnet-signing-key");
  });

  it("advertises Cardano Preprod without requiring a shared payer address", () => {
    mockedGetConfig.mockReturnValue(config({
      CARDANO_PREPROD_FACILITATOR_URL: "https://facilitator.example/cardano",
      CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: "cardano-signing-key",
      CARDANO_PREPROD_PROVIDER_ADDRESS: "addr_test1provider",
    }));
    expect(getNetworkRouter().supportsNetwork("cardano:preprod")).toBe(false);

    resetNetworkRouter();
    mockedGetConfig.mockReturnValue(config({
      CARDANO_PREPROD_FACILITATOR_URL: "https://facilitator.example/cardano",
      CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: "cardano-signing-key",
      CARDANO_PREPROD_PROVIDER_ADDRESS: "addr_test1provider",
      CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: "preprod-project-id",
    }));
    const route = getNetworkRouter().getRoute("cardano:preprod");
    expect(route.nativeAsset).toBe("lovelace");
    expect(route.facilitatorUrl).toBe("https://facilitator.example/cardano");
  });

  it("advertises Cardano Mainnet self-custody without an operator payer", () => {
    mockedGetConfig.mockReturnValue(config({
      CARDANO_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.example/cardano",
      CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY: "cardano-mainnet-signing-key",
      CARDANO_MAINNET_PROVIDER_ADDRESS: "addr1provider",
      CARDANO_MAINNET_BLOCKFROST_PROJECT_ID: "mainnet-project-id",
    }));
    const route = getNetworkRouter().getRoute("cardano:mainnet");
    expect(route.nativeAsset).toBe("lovelace");
    expect(route.explorerUrl).toContain("cardanoscan.io/transaction");
  });

  it("keeps localhost Hedera mainnet available for local development", () => {
    mockedGetConfig.mockReturnValue(config({ APP_ENV: "development" }));
    expect(getNetworkRouter().supportsNetwork("hedera:mainnet")).toBe(true);
  });
});
