import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({ getConfig: vi.fn() }));

import { getConfig } from "@/lib/config";
import { facilitatorUrlForNetwork, getNetworkRouter, resetNetworkRouter } from "@/domain/network-router";

const mockedGetConfig = vi.mocked(getConfig);

function config(overrides: Record<string, unknown> = {}) {
  return {
    APP_ENV: "production",
    AGENTPAY_FACILITATOR_ORIGIN: "https://facilitator.example",
    FACILITATOR_URL: "",
    FACILITATOR_SIGNING_API_KEY: "hedera-testnet-signing-key",
    FACILITATOR_API_KEY: undefined,
    HEDERA_MAINNET_FACILITATOR_URL: "",
    HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY: undefined,
    HEDERA_MAINNET_FACILITATOR_API_KEY: undefined,
    ARC_FACILITATOR_URL: "",
    ARC_FACILITATOR_SIGNING_API_KEY: "arc-testnet-signing-key",
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

  it("derives every rail from one unified facilitator origin", () => {
    const cfg = config();
    expect(facilitatorUrlForNetwork(cfg, "hedera:testnet")).toBe("https://facilitator.example/hedera/testnet");
    expect(facilitatorUrlForNetwork(cfg, "hedera:mainnet")).toBe("https://facilitator.example/hedera/mainnet");
    expect(facilitatorUrlForNetwork(cfg, "eip155:5042002")).toBe("https://facilitator.example/arc/testnet");
    expect(facilitatorUrlForNetwork(cfg, "cardano:preprod")).toBe("https://facilitator.example/cardano/preprod");
    expect(facilitatorUrlForNetwork(cfg, "cardano:mainnet")).toBe("https://facilitator.example/cardano/mainnet");
  });

  it("advertises Hedera mainnet from the unified origin without managed mainnet custody", () => {
    mockedGetConfig.mockReturnValue(config());
    const route = getNetworkRouter().getRoute("hedera:mainnet");
    expect(route.facilitatorUrl).toBe("https://facilitator.example/hedera/mainnet");
    expect(route.facilitatorApiKey).toBeUndefined();
  });

  it("advertises managed Cardano Preprod only when its capability and provider evidence are configured", () => {
    mockedGetConfig.mockReturnValue(config({
      CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: "cardano-preprod-signing-key",
      CARDANO_PREPROD_PROVIDER_ADDRESS: "addr_test1provider",
    }));
    expect(getNetworkRouter().supportsNetwork("cardano:preprod")).toBe(false);

    resetNetworkRouter();
    mockedGetConfig.mockReturnValue(config({
      CARDANO_PREPROD_FACILITATOR_SIGNING_API_KEY: "cardano-preprod-signing-key",
      CARDANO_PREPROD_PROVIDER_ADDRESS: "addr_test1provider",
      CARDANO_PREPROD_BLOCKFROST_PROJECT_ID: "preprod-project-id",
    }));
    const route = getNetworkRouter().getRoute("cardano:preprod");
    expect(route.nativeAsset).toBe("lovelace");
    expect(route.facilitatorUrl).toBe("https://facilitator.example/cardano/preprod");
  });

  it("advertises Cardano Mainnet self-custody when its preparation capability and provider evidence exist", () => {
    mockedGetConfig.mockReturnValue(config({
      CARDANO_MAINNET_FACILITATOR_SIGNING_API_KEY: "cardano-mainnet-prepare-key",
      CARDANO_MAINNET_PROVIDER_ADDRESS: "addr1provider",
      CARDANO_MAINNET_BLOCKFROST_PROJECT_ID: "mainnet-project-id",
    }));
    const route = getNetworkRouter().getRoute("cardano:mainnet");
    expect(route.facilitatorUrl).toBe("https://facilitator.example/cardano/mainnet");
    expect(route.nativeAsset).toBe("lovelace");
    expect(route.explorerUrl).toContain("cardanoscan.io/transaction");
  });

  it("keeps explicit per-network URLs as migration overrides", () => {
    const cfg = config({ CARDANO_MAINNET_FACILITATOR_URL: "https://dedicated.example/cardano-mainnet" });
    expect(facilitatorUrlForNetwork(cfg, "cardano:mainnet")).toBe("https://dedicated.example/cardano-mainnet");
  });

  it("uses unified localhost paths in development", () => {
    mockedGetConfig.mockReturnValue(config({ APP_ENV: "development", AGENTPAY_FACILITATOR_ORIGIN: "" }));
    expect(getNetworkRouter().getRoute("hedera:mainnet").facilitatorUrl).toBe("http://localhost:8787/hedera/mainnet");
  });
});
