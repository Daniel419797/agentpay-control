import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertMooveAmount,
  assertMooveSettlementToken,
  createMoovePaymentLink,
  listMoovePaymentLinks,
  mooveConfigFromEnv,
  MooveProviderError,
  retrieveMoovePaymentLink,
  type MooveConfig,
  type MoovePaymentLink,
} from "@/lib/moove";

const config: MooveConfig = {
  baseUrl: "https://api.moove.xyz",
  apiKey: "mk_live_test_key_1234567890",
  organizationId: "11111111-1111-4111-8111-111111111111",
  timeoutMs: 5_000,
  maxReconcilePages: 5,
};

const link: MoovePaymentLink = {
  id: "0c8f2e5a-4b91-4c3e-9d17-2f6a8b0d1e34",
  userId: "9b1d4c77-0a3e-4f52-8c61-77ab2d90ef15",
  toAmount: "49.99",
  destinationAddress: "0x5f3ac81b",
  url: "https://www.moove.xyz/@agentpay/pay/0c8f2e5a-4b91-4c3e-9d17-2f6a8b0d1e34",
  dateCreated: "2026-09-07T10:00:00Z",
  token: {
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    decimals: 6,
    symbol: "USDC",
    name: "USD Coin",
    logo: null,
    isNative: false,
    isStablecoin: true,
    currencyCode: "USD",
    commodityCode: null,
    chain: { id: "8453", name: "Base", symbol: "BAS", chainType: "EVM", logo: "https://cdn.moove.xyz/base.svg" },
  },
  status: "active",
  description: "AP:11111111-1111-4111-8111-111111111111",
  maxUsage: 1,
  receivedAmount: null,
  expirationDate: null,
  transactionUrl: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("Moove Receive API client", () => {
  it("requires the production Moove host unless explicitly overridden", () => {
    expect(() => mooveConfigFromEnv({
      APP_ENV: "production",
      MOOVE_RECEIVE_ENABLED: "true",
      MOOVE_API_BASE_URL: "https://example.com",
      MOOVE_API_KEY: "mk_live_test_key_1234567890",
      MOOVE_ACCOUNT_ORGANIZATION_ID: config.organizationId,
    })).toThrow("MOOVE_PRODUCTION_HOST_INVALID");
  });

  it("rejects partially configured invoice settlement identity", () => {
    expect(() => mooveConfigFromEnv({
      MOOVE_RECEIVE_ENABLED: "true",
      MOOVE_API_KEY: "mk_live_test_key_1234567890",
      MOOVE_ACCOUNT_ORGANIZATION_ID: config.organizationId,
      MOOVE_SETTLEMENT_NETWORK: "eip155:8453",
      MOOVE_SETTLEMENT_SYMBOL: "USDC",
    })).toThrow("MOOVE_SETTLEMENT_CONFIG_INCOMPLETE");
  });

  it("normalizes an EVM provider chain and verifies the configured settlement token", () => {
    expect(() => assertMooveSettlementToken(link.token, { network: "eip155:8453", symbol: "USDC", decimals: 6 })).not.toThrow();
    expect(() => assertMooveSettlementToken(link.token, { network: "eip155:8453", symbol: "USDT", decimals: 6 })).toThrow("MOOVE_SETTLEMENT_TOKEN_MISMATCH");
  });

  it("creates a payment link with X-API-Key and preserves decimal strings", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: link.id, url: link.url }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createMoovePaymentLink({ toAmount: "49.990001", description: "invoice", maxUsage: 1 }, config);
    expect(result.id).toBe(link.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe(config.apiKey);
    expect(JSON.parse(String(init.body))).toMatchObject({ toAmount: "49.990001", maxUsage: 1 });
  });

  it("does not retry an ambiguous create failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ code: "CANNOT_CREATE_PAYMENT_LINK", message: "temporary" }] }), { status: 500, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const error = await createMoovePaymentLink({ toAmount: "1" }, config).catch((cause) => cause);
    expect(error).toBeInstanceOf(MooveProviderError);
    expect((error as MooveProviderError).ambiguous).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a safe list request after rate limiting", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ code: "429", message: "rate limited" }] }), { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [link], limit: 10, offset: 0, nextOffset: null }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await listMoovePaymentLinks({}, config);
    expect(result.data).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the public retrieve endpoint without leaking the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...link, user: { id: link.userId, handle: "agentpay", username: "AgentPay" } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await retrieveMoovePaymentLink(link.id, config);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBeUndefined();
  });

  it("rejects zero, exponent notation and malformed amounts before network I/O", () => {
    expect(() => assertMooveAmount("0")).toThrow("MOOVE_AMOUNT_INVALID");
    expect(() => assertMooveAmount("1e3")).toThrow("MOOVE_AMOUNT_INVALID");
    expect(() => assertMooveAmount("01.00")).toThrow("MOOVE_AMOUNT_INVALID");
    expect(assertMooveAmount("100.000000")).toBe("100.000000");
  });
});
