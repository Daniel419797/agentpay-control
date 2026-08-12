import { describe, expect, it } from "vitest";
import { createCardanoApp, parseCardanoEnv } from "./cardano.js";

const PAYER = "addr_test1qzjeazrvkpc3twtg9xu7na0dw5zshqwwh354gmh0626gv4r9vh67k4754l9ugvw5uex30x4u6lyfvr0a34vynjmk2nzq7hqhjn";
const SETTLEMENT_KEY = "settlement-secret-abcdefghijklmnopqrstuvwxyz";
const ZERO_HASH = "00".repeat(32);

function cborHead(major: number, value: number): Buffer {
  if (value < 24) return Buffer.from([(major << 5) | value]);
  if (value <= 0xff) return Buffer.from([(major << 5) | 24, value]);
  if (value <= 0xffff) { const out = Buffer.alloc(3); out[0] = (major << 5) | 25; out.writeUInt16BE(value, 1); return out; }
  const out = Buffer.alloc(5); out[0] = (major << 5) | 26; out.writeUInt32BE(value, 1); return out;
}

function uint(value: number) { return cborHead(0, value); }
function bytes(value: Buffer) { return Buffer.concat([cborHead(2, value.length), value]); }
function array(values: Buffer[]) { return Buffer.concat([cborHead(4, values.length), ...values]); }
function map(entries: Array<[Buffer, Buffer]>) { return Buffer.concat([cborHead(5, entries.length), ...entries.flatMap(([key, value]) => [key, value])]); }

function multiAssetTransaction() {
  const input = array([bytes(Buffer.alloc(32)), uint(0)]);
  const multiAssetValue = array([uint(1_000_000), map([])]);
  const output = array([bytes(Buffer.alloc(29)), multiAssetValue]);
  const body = map([
    [uint(0), array([input])],
    [uint(1), array([output])],
    [uint(2), uint(200_000)],
    [uint(3), uint(4_000_000_000)],
  ]);
  return array([body, map([])]).toString("base64");
}

function app() {
  const env = parseCardanoEnv({
    APP_ENV: "test",
    CARDANO_NETWORK: "preprod",
    CARDANO_PAYER_ADDRESS: PAYER,
    CARDANO_BLOCKFROST_URL: "https://cardano-preprod.blockfrost.io/api/v0",
    CARDANO_BLOCKFROST_PROJECT_ID: "preprod-project-id-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SIGNER_URL: "https://signer.example/cardano",
    CARDANO_SIGNER_API_KEY: "signer-secret-abcdefghijklmnopqrstuvwxyz",
    CARDANO_SETTLEMENT_STORE_URL: "https://app.example/api/v1/internal/cardano-settlement-claims",
    CARDANO_SETTLEMENT_STORE_API_KEY: "store-secret-abcdefghijklmnopqrstuvwxyz",
    SETTLEMENT_API_KEY: SETTLEMENT_KEY,
  });
  return createCardanoApp(env).app;
}

describe("Cardano ADA-only verifier", () => {
  it("rejects a multi-asset output before any chain or signer trust is used", async () => {
    const requirement = { scheme: "exact", network: "cardano:preprod", amount: "1000000", payTo: PAYER, asset: "lovelace", maxTimeoutSeconds: 900, extra: {} };
    const response = await app().request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SETTLEMENT_KEY}` },
      body: JSON.stringify({
        paymentRequirements: requirement,
        paymentPayload: { x402Version: 2, accepted: requirement, payload: { transaction: multiAssetTransaction(), nonce: `${ZERO_HASH}#0`, submissionMode: "server" } },
      }),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ isValid: false, invalidReason: "cardano_multi_asset_output_unsupported" });
  });
});
