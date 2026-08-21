import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createManagedPaymentPayload, discoverX402, fulfillX402Resource, parsePaymentRequired, selectRequirement, X402SubmissionUnknownError } from "@/domain/x402-client";

const RESOURCE_URL = "https://provider.example/v1/market-data/ETH";
const resourceBinding = createHash("sha256").update(RESOURCE_URL).digest("hex");
const challenge = parsePaymentRequired({
  x402Version: 2,
  resource: { url: RESOURCE_URL, mimeType: "application/json" },
  accepts: [{ scheme: "exact", network: "hedera:testnet", asset: "0.0.0", amount: "5000000", payTo: "0.0.1234", maxTimeoutSeconds: 900, extra: { feePayer: "0.0.5678" } }],
});
const identity = { agentId: "11111111-1111-4111-8111-111111111111", payerAccountId: "0.0.4321" };

describe("x402 challenge binding", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("selects only an exact matching payment requirement", () => {
    const selected = selectRequirement(challenge, { network: "hedera:testnet", asset: "0.0.0", amount: "5000000", payTo: "0.0.1234", resourceUrl: RESOURCE_URL });
    expect(selected.extra.feePayer).toBe("0.0.5678");
  });

  it.each([
    ["network", { network: "hedera:mainnet" }],
    ["asset", { asset: "0.0.429274" }],
    ["amount", { amount: "5000001" }],
    ["payee", { payTo: "0.0.9999" }],
  ])("rejects a changed %s", (_, override) => {
    expect(() => selectRequirement(challenge, { network: "hedera:testnet", asset: "0.0.0", amount: "5000000", payTo: "0.0.1234", resourceUrl: RESOURCE_URL, ...override })).toThrow("X402_REQUIREMENT_MISMATCH");
  });

  it("matches EVM asset and payee addresses case-insensitively", () => {
    const arc = parsePaymentRequired({
      x402Version: 2,
      resource: { url: RESOURCE_URL },
      accepts: [{ scheme: "exact", network: "eip155:5042002", asset: "0x360000000000000000000000000000000000ABCD", amount: "1000000", payTo: "0x111111111111111111111111111111111111ABCD", maxTimeoutSeconds: 900, extra: {} }],
    });
    expect(selectRequirement(arc, { network: "eip155:5042002", asset: "0x360000000000000000000000000000000000abcd", amount: "1000000", payTo: "0x111111111111111111111111111111111111abcd", resourceUrl: RESOURCE_URL }).network).toBe("eip155:5042002");
  });

  it("requires exact Cardano resource binding and direct server-submitted settlement semantics", () => {
    const base = {
      scheme: "exact",
      network: "cardano:preprod",
      asset: "lovelace",
      amount: "1000000",
      payTo: "addr_test1vz8nl3s7rk0tqn4rd9u49s0k52f9sezrt98rs4cnpfj47wg9example",
      maxTimeoutSeconds: 900,
    } as const;
    const cardano = parsePaymentRequired({
      x402Version: 2,
      resource: { url: RESOURCE_URL },
      accepts: [{ ...base, extra: { assetTransferMethod: "default", submissionPolicy: "server", confirmationPolicy: { l1Confirmations: 1 }, resourceBinding } }],
    });
    expect(selectRequirement(cardano, { network: base.network, asset: base.asset, amount: base.amount, payTo: base.payTo, resourceUrl: RESOURCE_URL }).network).toBe("cardano:preprod");

    for (const extra of [
      { assetTransferMethod: "masumi", submissionPolicy: "server", confirmationPolicy: { l1Confirmations: 1 }, resourceBinding },
      { assetTransferMethod: "default", submissionPolicy: "client", confirmationPolicy: { l1Confirmations: 1 }, resourceBinding },
      { assetTransferMethod: "default", submissionPolicy: "server", confirmationPolicy: { l1Confirmations: 1 }, resourceBinding: "0".repeat(64) },
      { assetTransferMethod: "default", submissionPolicy: "server", confirmationPolicy: { l1Confirmations: 0 }, resourceBinding },
    ]) {
      const invalid = parsePaymentRequired({ x402Version: 2, resource: { url: RESOURCE_URL }, accepts: [{ ...base, extra }] });
      expect(() => selectRequirement(invalid, { network: base.network, asset: base.asset, amount: base.amount, payTo: base.payTo, resourceUrl: RESOURCE_URL })).toThrow("X402_REQUIREMENT_MISMATCH");
    }
  });

  it("rejects a challenge for a different resource", () => {
    expect(() => selectRequirement(challenge, { network: "hedera:testnet", asset: "0.0.0", amount: "5000000", payTo: "0.0.1234", resourceUrl: "https://provider.example/v1/market-data/BTC" })).toThrow("X402_RESOURCE_MISMATCH");
  });

  it("requires signing evidence, agent identity, and facilitator authentication", async () => {
    const requirement = challenge.accepts[0]!;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe("https://facilitator.example/managed-agent-sign");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer service-secret");
      expect(JSON.parse(String(init?.body))).toEqual({ paymentRequirements: requirement, ...identity });
      return Response.json({ transactionId: "0.0.1234@1753510000.123456789", paymentPayload: { x402Version: 2, accepted: requirement, payload: { transaction: "base64" } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(createManagedPaymentPayload("https://facilitator.example", requirement, identity, "service-secret")).resolves.toMatchObject({ transactionId: "0.0.1234@1753510000.123456789" });
  });

  it("rejects managed signing without an isolated identity", async () => {
    const requirement = challenge.accepts[0]!;
    await expect(createManagedPaymentPayload("https://facilitator.example", requirement, { agentId: "", payerAccountId: "" }, "service-secret")).rejects.toThrow("MANAGED_SIGNER_IDENTITY_REQUIRED");
  });

  it("rejects a facilitator that mutates the signed requirement", async () => {
    const requirement = challenge.accepts[0]!;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      transactionId: "0.0.1234@1753510000.123456789",
      paymentPayload: { x402Version: 2, accepted: { ...requirement, amount: "1" }, payload: { transaction: "base64" } },
    })));
    await expect(createManagedPaymentPayload("https://facilitator.example", requirement, identity, "service-secret")).rejects.toThrow("FACILITATOR_REQUIREMENT_MISMATCH");
  });

  it("stops reading an oversized chunked challenge response", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(40 * 1024))); controller.enqueue(new TextEncoder().encode("x".repeat(40 * 1024))); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 402 })));
    await expect(discoverX402(new URL("https://provider.example/large"))).rejects.toThrow("RESOURCE_RESPONSE_TOO_LARGE");
  });

  it.each([
    [502, "FACILITATOR_ERROR"],
    [502, "SETTLEMENT_UNKNOWN"],
    [422, "SETTLEMENT_FAILED"],
  ])("treats post-sign %s %s as submission unknown", async (status, code) => {
    const requirement = challenge.accepts[0]!;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code }, { status })));
    await expect(fulfillX402Resource(RESOURCE_URL, requirement, { x402Version: 2, accepted: requirement, payload: { transaction: "signed" } })).rejects.toThrow("X402_SUBMISSION_UNKNOWN");
  });

  it("preserves an Arc transaction hash returned with an ambiguous settlement", async () => {
    const arc = parsePaymentRequired({
      x402Version: 2,
      resource: { url: RESOURCE_URL },
      accepts: [{ scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", amount: "1000000", payTo: "0x2222222222222222222222222222222222222222", maxTimeoutSeconds: 900, extra: { name: "USD Coin", version: "2", assetTransferMethod: "eip3009" } }],
    });
    const requirement = arc.accepts[0]!;
    const transactionId = `0x${"a".repeat(64)}`;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "SETTLEMENT_UNKNOWN", network: requirement.network, transactionId }, { status: 503 })));

    try {
      await fulfillX402Resource(RESOURCE_URL, requirement, { x402Version: 2, accepted: requirement, payload: { transaction: "signed" } });
      throw new Error("expected X402SubmissionUnknownError");
    } catch (error) {
      expect(error).toBeInstanceOf(X402SubmissionUnknownError);
      expect((error as X402SubmissionUnknownError).candidateTransactionId).toBe(transactionId);
    }
  });

  it("does not invent transaction evidence when an ambiguous response has none", async () => {
    const requirement = challenge.accepts[0]!;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "FACILITATOR_ERROR" }, { status: 502 })));

    try {
      await fulfillX402Resource(RESOURCE_URL, requirement, { x402Version: 2, accepted: requirement, payload: { transaction: "signed" } });
      throw new Error("expected X402SubmissionUnknownError");
    } catch (error) {
      expect(error).toBeInstanceOf(X402SubmissionUnknownError);
      expect((error as X402SubmissionUnknownError).candidateTransactionId).toBeUndefined();
    }
  });

  it("keeps a verified pre-settlement rejection deterministic", async () => {
    const requirement = challenge.accepts[0]!;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "PAYMENT_INVALID" }, { status: 402 })));
    await expect(fulfillX402Resource(RESOURCE_URL, requirement, { x402Version: 2, accepted: requirement, payload: { transaction: "signed" } })).rejects.toThrow("RESOURCE_FULFILLMENT_PAYMENT_INVALID");
  });

  it("treats a successful HTTP response without settlement evidence as unknown", async () => {
    const requirement = challenge.accepts[0]!;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ content: { ok: true } }, { status: 200 })));
    await expect(fulfillX402Resource(RESOURCE_URL, requirement, { x402Version: 2, accepted: requirement, payload: { transaction: "signed" } })).rejects.toThrow("X402_SUBMISSION_UNKNOWN");
  });
});
