import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/config", () => ({
  getConfig: vi.fn(),
}));

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
    ...overrides,
  } as ReturnType<typeof getConfig>;
}

describe("network router", () => {
  beforeEach(() => {
    resetNetworkRouter();
    vi.clearAllMocks();
  });

  it("does not advertise unconfigured mainnet in production", () => {
    mockedGetConfig.mockReturnValue(config());
    const router = getNetworkRouter();
    expect(router.supportsNetwork("hedera:testnet")).toBe(true);
    expect(router.supportsNetwork("eip155:5042002")).toBe(true);
    expect(router.supportsNetwork("hedera:mainnet")).toBe(false);
    expect(() => router.getRoute("hedera:mainnet")).toThrow(/NETWORK_UNSUPPORTED/);
  });

  it("advertises mainnet when a production mainnet facilitator is configured", () => {
    mockedGetConfig.mockReturnValue(config({
      HEDERA_MAINNET_FACILITATOR_URL: "https://mainnet-facilitator.example/hedera",
      HEDERA_MAINNET_FACILITATOR_SIGNING_API_KEY: "mainnet-signing-key",
    }));
    const route = getNetworkRouter().getRoute("hedera:mainnet");
    expect(route.facilitatorUrl).toBe("https://mainnet-facilitator.example/hedera");
  });

  it("keeps localhost mainnet available for local development", () => {
    mockedGetConfig.mockReturnValue(config({ APP_ENV: "development" }));
    expect(getNetworkRouter().supportsNetwork("hedera:mainnet")).toBe(true);
  });
});
