import { afterEach, describe, expect, it, vi } from "vitest";

import { createManagedPaymentPayload, discoverX402, parsePaymentRequired, selectRequirement } from "@/domain/x402-client";

const challenge = parsePaymentRequired({
  x402Version: 2,
  resource: { url: "https://provider.example/v1/market-data/ETH", mimeType: "application/json" },
  accepts: [{
    scheme: "exact",
    network: "hedera:testnet",
    asset: "0.0.0",
    amount: "5000000",
    payTo: "0.0.1234",
    maxTimeoutSeconds: 900,
    extra: { feePayer: "0.0.5678" },
  }],
});

describe("x402 challenge binding", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("selects only an exact matching payment requirement", () => {
    const selected = selectRequirement(challenge, {
      network: "hedera:testnet",
      asset: "0.0.0",
      amount: "5000000",
      payTo: "0.0.1234",
      resourceUrl: "https://provider.example/v1/market-data/ETH",
    });
    expect(selected.extra.feePayer).toBe("0.0.5678");
  });

  it.each([
    ["network", { network: "hedera:mainnet" }],
    ["asset", { asset: "0.0.429274" }],
    ["amount", { amount: "5000001" }],
    ["payee", { payTo: "0.0.9999" }],
  ])("rejects a changed %s", (_, override) => {
    expect(() => selectRequirement(challenge, {
      network: "hedera:testnet",
      asset: "0.0.0",
      amount: "5000000",
      payTo: "0.0.1234",
      resourceUrl: "https://provider.example/v1/market-data/ETH",
      ...override,
    })).toThrow("X402_REQUIREMENT_MISMATCH");
  });

  it("rejects a challenge for a different resource", () => {
    expect(() => selectRequirement(challenge, {
      network: "hedera:testnet",
      asset: "0.0.0",
      amount: "5000000",
      payTo: "0.0.1234",
      resourceUrl: "https://provider.example/v1/market-data/BTC",
    })).toThrow("X402_RESOURCE_MISMATCH");
  });

  it("requires signing evidence and authenticates to the facilitator", async () => {
    const requirement = challenge.accepts[0]!;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer service-secret");
      return Response.json({
        transactionId: "0.0.1234@1753510000.123456789",
        paymentPayload: { x402Version: 2, accepted: requirement, payload: { transaction: "base64" } },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createManagedPaymentPayload("https://facilitator.example", requirement, "service-secret")).resolves.toMatchObject({
      transactionId: "0.0.1234@1753510000.123456789",
    });
  });

  it("stops reading an oversized chunked challenge response", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(40 * 1024)));
        controller.enqueue(new TextEncoder().encode("x".repeat(40 * 1024)));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 402 })));
    await expect(discoverX402(new URL("https://provider.example/large"))).rejects.toThrow("RESOURCE_RESPONSE_TOO_LARGE");
  });
});
