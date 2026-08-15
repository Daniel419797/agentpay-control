import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { blake2b } from "blakejs";
import { decodeFirstSync, encodeCanonical } from "cbor";
import { decodeCardanoAddress } from "@/lib/cardano-address";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function equalBytes(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function headerValue(headers: unknown, label: string) {
  if (headers instanceof Map) return headers.get(label);
  if (headers && typeof headers === "object") return (headers as Record<string, unknown>)[label];
  return undefined;
}

export function verifyCardanoDataSignature(
  message: string,
  dataSignature: { key: string; signature: string },
  address: string,
): boolean {
  if (!/^[0-9a-f]+$/i.test(dataSignature.key) || !/^[0-9a-f]+$/i.test(dataSignature.signature)) return false;
  try {
    const coseKey = decodeFirstSync(Buffer.from(dataSignature.key, "hex"), { required: true }) as Map<unknown, unknown>;
    const coseSign1 = decodeFirstSync(Buffer.from(dataSignature.signature, "hex"), { required: true }) as unknown[];
    if (!(coseKey instanceof Map) || !Array.isArray(coseSign1) || coseSign1.length !== 4) return false;
    const [protectedBytes, unprotected, payload, signature] = coseSign1;
    if (!Buffer.isBuffer(protectedBytes) || !unprotected || typeof unprotected !== "object" || !Buffer.isBuffer(payload) || !Buffer.isBuffer(signature)) return false;
    const protectedHeaders = decodeFirstSync(protectedBytes, { required: true }) as Map<unknown, unknown>;
    if (!(protectedHeaders instanceof Map)) return false;
    const publicKey = coseKey.get(-2);
    const expectedPayload = new TextEncoder().encode(message);
    if (!Buffer.isBuffer(publicKey) || publicKey.length !== 32 || !equalBytes(payload, expectedPayload)) return false;

    const decodedAddress = decodeCardanoAddress(address);
    const addressHeader = headerValue(protectedHeaders, "address") ?? headerValue(unprotected, "address");
    if (!Buffer.isBuffer(addressHeader) || !equalBytes(addressHeader, decodedAddress.bytes)) return false;

    const credential = decodedAddress.bytes.slice(1, 29);
    if (!equalBytes(blake2b(publicKey, undefined, 28), credential)) return false;
    const keyObject = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey)]), format: "der", type: "spki" });
    const signatureStructure = encodeCanonical(["Signature1", protectedBytes, Buffer.alloc(0), payload]);
    return verify(null, signatureStructure, keyObject, signature);
  } catch {
    return false;
  }
}
