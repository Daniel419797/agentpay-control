import { proto } from "@hiero-ledger/proto";
import { PrivateKey } from "@hiero-ledger/sdk";
import { describe, expect, it } from "vitest";
import { prefixHederaMessage, verifyHederaMessageSignature } from "./hedera-signature";

describe("Hedera wallet message verification", () => {
  it("accepts the signature map returned for the exact challenge", async () => {
    const privateKey = PrivateKey.generateED25519();
    const message = "AgentPay Control wallet link\nNetwork: hedera:testnet\nAccount: 0.0.123\nNonce: test";
    const signature = await privateKey.sign(Buffer.from(prefixHederaMessage(message)));
    const signatureMap = proto.SignatureMap.encode({ sigPair: [{ ed25519: signature }] }).finish();

    expect(verifyHederaMessageSignature(message, Buffer.from(signatureMap).toString("base64"), privateKey.publicKey)).toBe(true);
    expect(verifyHederaMessageSignature(`${message}!`, Buffer.from(signatureMap).toString("base64"), privateKey.publicKey)).toBe(false);
  });
});
