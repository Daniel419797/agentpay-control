import { proto } from "@hiero-ledger/proto";
import { PublicKey } from "@hiero-ledger/sdk";

export function prefixHederaMessage(message: string) {
  return `\x19Hedera Signed Message:\n${message.length}${message}`;
}

export function verifyHederaMessageSignature(
  message: string,
  base64SignatureMap: string,
  publicKey: PublicKey,
) {
  const signatureMap = proto.SignatureMap.decode(Buffer.from(base64SignatureMap, "base64"));
  const pair = signatureMap.sigPair[0];
  const signature = pair?.ed25519 ?? pair?.ECDSASecp256k1;
  if (!signature) return false;
  return publicKey.verify(Buffer.from(prefixHederaMessage(message)), signature);
}
