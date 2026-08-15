import { afterEach, describe, expect, it, vi } from "vitest";
import { createCardanoNativeApp, parseCardanoNativeEnv } from "./cardano-native.js";

const MANAGED_PAYER = "addr_test1qzjeazrvkpc3twtg9xu7na0dw5zshqwwh354gmh0626gv4r9vh67k4754l9ugvw5uex30x4u6lyfvr0a34vynjmk2nzq7hqhjn";
const WALLET_PAYER = "addr_test1qzj8e3xsl4pk6k5hsdtsd0zahfcfsqjq0x6c25pcrsr7gpwvmfgfdlwkq3mkwqdqw569ghrrhyacd56u9lekvxrdujlq97kaac";
const SIGNING_KEY = "managed-signing-secret-abcdefghijklmnopqrstuvwxyz";

function app() {
  return createCardanoNativeApp(parseCardanoNativeEnv({
    APP_ENV: "test",
    CARDANO_NETWORK: "preprod",
    CARDANO_PAYER_ADDRESS: MANAGED_PAYER,
    CARDANO_BLOCKFROST_URL: "https://cardano-preprod.blockfrost.io/api/v0",
    CARDANO_BLOCKFROST_PROJECT_ID: "preprod-project-id-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SIGNER_URL: "https://signer.example/cardano",
    CARDANO_SIGNER_API_KEY: "signer-secret-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SETTLEMENT_STORE_URL: "https://app.example/api/v1/internal/cardano-settlement-claims",
    CARDANO_SETTLEMENT_STORE_API_KEY: "store-secret-abcdefghijklmnopqrstuvwxyz",
    MANAGED_SIGNING_API_KEY: SIGNING_KEY,
    SETTLEMENT_API_KEY: "settlement-secret-abcdefghijklmnopqrstuvwxyz",
  })).app;
}

const requirement = {
  scheme: "exact",
  network: "cardano:preprod",
  amount: "1000000",
  payTo: MANAGED_PAYER,
  asset: "lovelace",
  maxTimeoutSeconds: 900,
  extra: { resourceBinding: "ab".repeat(32), submissionPolicy: "server", assetTransferMethod: "default", confirmationPolicy: { l1Confirmations: 1 } },
};

afterEach(() => vi.restoreAllMocks());

describe("Cardano self-custody preparation", () => {
  it("prepares unsigned CBOR for a valid external CIP-30 payer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { payerAddress: string };
      expect(body.payerAddress).toBe(WALLET_PAYER);
      return new Response(JSON.stringify({ transaction: "84a0a0f5f6", nonce: `${"cd".repeat(32)}#1`, transactionId: "ef".repeat(32) }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const response = await app().request("/prepare", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SIGNING_KEY}` },
      body: JSON.stringify({ payerAddress: WALLET_PAYER, paymentRequirements: requirement }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ payerAddress: WALLET_PAYER, unsignedTransaction: "84a0a0f5f6", nonce: `${"cd".repeat(32)}#1` });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://signer.example/cardano/unsigned");
  });

  it("rejects a Mainnet address before contacting the signer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const response = await app().request("/prepare", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SIGNING_KEY}` },
      body: JSON.stringify({ payerAddress: "addr1q9invalid", paymentRequirements: requirement }),
    });
    expect(response.status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
