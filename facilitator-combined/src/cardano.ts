import { createHash, createPublicKey, timingSafeEqual, verify as verifySignature } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";

const CARDANO_TRANSACTION_MAX_BYTES = 64 * 1024;
const CARDANO_MAX_INPUTS = 64;
const CARDANO_UTXO_PAGE_LIMIT = 10;
const CARDANO_UTXO_PAGE_SIZE = 100;
const CARDANO_TTL_SLOP_SLOTS = 30n;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

type CardanoNetwork = "cardano:preprod" | "cardano:mainnet";
type ClaimState = "CLAIMED" | "SUBMISSION_STARTED" | "CONFIRMED" | "REJECTED";

type Requirement = {
  scheme: "exact";
  network: CardanoNetwork;
  amount: string;
  payTo: string;
  asset: "lovelace";
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

type ExactPayload = {
  x402Version: 2;
  accepted: Requirement;
  payload: { transaction: string; nonce: string; submissionMode?: "server" };
};

type CborNode = {
  value: unknown;
  start: number;
  end: number;
  children?: CborNode[];
  entries?: Array<[CborNode, CborNode]>;
};

const requirementSchema = z.object({
  scheme: z.literal("exact"),
  network: z.enum(["cardano:preprod", "cardano:mainnet"]),
  amount: z.string().regex(/^[1-9]\d*$/),
  payTo: z.string().min(20).max(200),
  asset: z.literal("lovelace"),
  maxTimeoutSeconds: z.number().int().positive().max(3600),
  extra: z.record(z.string(), z.unknown()).default({}),
});

const payloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: requirementSchema,
  payload: z.object({
    transaction: z.string().min(4),
    nonce: z.string().regex(/^[0-9a-f]{64}#\d+$/),
    submissionMode: z.literal("server").optional(),
  }),
});

const requestSchema = z.object({ paymentPayload: payloadSchema, paymentRequirements: requirementSchema });
const signerResponseSchema = z.object({ transaction: z.string().min(4), nonce: z.string().regex(/^[0-9a-f]{64}#\d+$/) });

export const cardanoEnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]).default("development"),
  CARDANO_NETWORK: z.enum(["preprod", "mainnet"]).default("preprod"),
  CARDANO_PAYER_ADDRESS: z.string().min(20).max(200),
  CARDANO_BLOCKFROST_URL: z.string().url(),
  CARDANO_BLOCKFROST_PROJECT_ID: z.string().min(20),
  CARDANO_SIGNER_URL: z.string().url(),
  CARDANO_SIGNER_API_KEY: z.string().min(32),
  CARDANO_SETTLEMENT_STORE_URL: z.string().url(),
  CARDANO_SETTLEMENT_STORE_API_KEY: z.string().min(32),
  MANAGED_SIGNING_API_KEY: z.string().min(32).optional(),
  SETTLEMENT_API_KEY: z.string().min(32).optional(),
  FACILITATOR_API_KEY: z.string().min(32).optional(),
  CARDANO_MAX_FEE_LOVELACE: z.string().regex(/^[1-9]\d*$/).default("1000000"),
  CARDANO_CONFIRMATION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(90000),
  CARDANO_CONFIRMATION_POLL_MS: z.coerce.number().int().min(250).max(30000).default(3000),
});

export type CardanoFacilitatorEnv = z.infer<typeof cardanoEnvSchema>;

function httpsOnly(name: string, value: string) {
  if (new URL(value).protocol !== "https:") throw new Error(`${name} must use HTTPS in production`);
}

export function parseCardanoEnv(input: unknown = process.env): CardanoFacilitatorEnv {
  const env = cardanoEnvSchema.parse(input);
  const network: CardanoNetwork = `cardano:${env.CARDANO_NETWORK}`;
  assertAddressNetwork(env.CARDANO_PAYER_ADDRESS, network);
  if (env.APP_ENV !== "production" && env.CARDANO_NETWORK === "mainnet") throw new Error("Cardano Mainnet is prohibited outside production");
  if (env.APP_ENV === "production") {
    if (!env.MANAGED_SIGNING_API_KEY || !env.SETTLEMENT_API_KEY) throw new Error("Production Cardano facilitator capability keys are required");
    httpsOnly("CARDANO_BLOCKFROST_URL", env.CARDANO_BLOCKFROST_URL);
    httpsOnly("CARDANO_SIGNER_URL", env.CARDANO_SIGNER_URL);
    httpsOnly("CARDANO_SETTLEMENT_STORE_URL", env.CARDANO_SETTLEMENT_STORE_URL);
    const secrets = [env.MANAGED_SIGNING_API_KEY, env.SETTLEMENT_API_KEY, env.CARDANO_SIGNER_API_KEY, env.CARDANO_SETTLEMENT_STORE_API_KEY];
    if (new Set(secrets).size !== secrets.length) throw new Error("Production Cardano capability, signer, and settlement-store secrets must be distinct");
  }
  return env;
}

function secretMatches(primary: string | undefined, fallback: string | undefined, authorization: string | undefined) {
  const expected = primary ?? fallback;
  if (!expected || !authorization?.startsWith("Bearer ")) return false;
  const actualHash = createHash("sha256").update(authorization.slice(7)).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

async function boundedJson(request: Request, maxBytes = 128 * 1024) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("REQUEST_BODY_TOO_LARGE");
  return JSON.parse(text) as unknown;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

function sameRequirement(left: Requirement, right: Requirement) {
  return left.scheme === right.scheme && left.network === right.network && left.amount === right.amount && left.payTo === right.payTo && left.asset === right.asset && left.maxTimeoutSeconds === right.maxTimeoutSeconds && stable(left.extra) === stable(right.extra);
}

function blake2b(bytes: Uint8Array, length: number) {
  return createHash("blake2b512", { outputLength: length }).update(bytes).digest();
}

function cborLength(buffer: Buffer, offset: number, additional: number): { value: bigint | null; offset: number } {
  if (additional < 24) return { value: BigInt(additional), offset };
  if (additional === 24) return { value: BigInt(buffer.readUInt8(offset)), offset: offset + 1 };
  if (additional === 25) return { value: BigInt(buffer.readUInt16BE(offset)), offset: offset + 2 };
  if (additional === 26) return { value: BigInt(buffer.readUInt32BE(offset)), offset: offset + 4 };
  if (additional === 27) return { value: buffer.readBigUInt64BE(offset), offset: offset + 8 };
  if (additional === 31) return { value: null, offset };
  throw new Error("CBOR_LENGTH_UNSUPPORTED");
}

function parseCbor(buffer: Buffer, start = 0): CborNode {
  if (start >= buffer.length) throw new Error("CBOR_TRUNCATED");
  const initial = buffer[start];
  const major = initial >> 5;
  const additional = initial & 31;
  let offset = start + 1;
  const length = cborLength(buffer, offset, additional);
  offset = length.offset;

  if (major === 0) {
    if (length.value === null) throw new Error("CBOR_UINT_INDEFINITE");
    return { value: length.value, start, end: offset };
  }
  if (major === 1) {
    if (length.value === null) throw new Error("CBOR_NEGATIVE_INDEFINITE");
    return { value: -1n - length.value, start, end: offset };
  }
  if (major === 2 || major === 3) {
    if (length.value === null) throw new Error("CBOR_INDEFINITE_STRING_UNSUPPORTED");
    const size = Number(length.value);
    if (!Number.isSafeInteger(size) || offset + size > buffer.length) throw new Error("CBOR_TRUNCATED");
    const bytes = buffer.subarray(offset, offset + size);
    return { value: major === 2 ? Buffer.from(bytes) : bytes.toString("utf8"), start, end: offset + size };
  }
  if (major === 4) {
    const children: CborNode[] = [];
    if (length.value === null) {
      while (true) {
        if (offset >= buffer.length) throw new Error("CBOR_TRUNCATED");
        if (buffer[offset] === 0xff) { offset += 1; break; }
        const child = parseCbor(buffer, offset); children.push(child); offset = child.end;
      }
    } else {
      const count = Number(length.value);
      if (!Number.isSafeInteger(count) || count > 10000) throw new Error("CBOR_ARRAY_TOO_LARGE");
      for (let index = 0; index < count; index++) { const child = parseCbor(buffer, offset); children.push(child); offset = child.end; }
    }
    return { value: children.map((child) => child.value), children, start, end: offset };
  }
  if (major === 5) {
    const entries: Array<[CborNode, CborNode]> = [];
    if (length.value === null) {
      while (true) {
        if (offset >= buffer.length) throw new Error("CBOR_TRUNCATED");
        if (buffer[offset] === 0xff) { offset += 1; break; }
        const key = parseCbor(buffer, offset); offset = key.end;
        const value = parseCbor(buffer, offset); offset = value.end;
        entries.push([key, value]);
      }
    } else {
      const count = Number(length.value);
      if (!Number.isSafeInteger(count) || count > 10000) throw new Error("CBOR_MAP_TOO_LARGE");
      for (let index = 0; index < count; index++) {
        const key = parseCbor(buffer, offset); offset = key.end;
        const value = parseCbor(buffer, offset); offset = value.end;
        entries.push([key, value]);
      }
    }
    return { value: new Map(entries.map(([key, value]) => [key.value, value.value])), entries, start, end: offset };
  }
  if (major === 6) {
    if (length.value === null) throw new Error("CBOR_TAG_INDEFINITE");
    const child = parseCbor(buffer, offset);
    return { value: { tag: length.value, value: child.value }, children: [child], start, end: child.end };
  }
  if (major === 7) {
    if (additional === 20) return { value: false, start, end: offset };
    if (additional === 21) return { value: true, start, end: offset };
    if (additional === 22 || additional === 23) return { value: null, start, end: offset };
    if (additional === 31) throw new Error("CBOR_UNEXPECTED_BREAK");
    throw new Error("CBOR_SIMPLE_UNSUPPORTED");
  }
  throw new Error("CBOR_MAJOR_UNSUPPORTED");
}

function untag(node: CborNode): CborNode {
  let current = node;
  while (current.children?.length === 1 && current.value && typeof current.value === "object" && "tag" in (current.value as object)) current = current.children[0];
  return current;
}

function asArray(node: CborNode, code: string) {
  const value = untag(node);
  if (!value.children || !Array.isArray(value.value)) throw new Error(code);
  return value.children;
}

function asMap(node: CborNode, code: string) {
  const value = untag(node);
  if (!value.entries || !(value.value instanceof Map)) throw new Error(code);
  return value;
}

function mapEntry(node: CborNode, key: bigint) {
  return asMap(node, "CBOR_MAP_REQUIRED").entries!.find(([candidate]) => candidate.value === key)?.[1];
}

function asBigInt(node: CborNode | undefined, code: string) {
  if (!node || typeof node.value !== "bigint") throw new Error(code);
  return node.value;
}

function asBytes(node: CborNode | undefined, code: string) {
  if (!node || !Buffer.isBuffer(node.value)) throw new Error(code);
  return node.value as Buffer;
}

function bech32Polymod(values: number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const value of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index++) if ((top >>> index) & 1) chk ^= generators[index];
  }
  return chk >>> 0;
}

function bech32ExpandHrp(hrp: string) { return [...hrp].map((char) => char.charCodeAt(0) >> 5).concat(0, [...hrp].map((char) => char.charCodeAt(0) & 31)); }

function convertBits(values: number[], fromBits: number, toBits: number) {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const value of values) {
    if (value < 0 || value >> fromBits !== 0) throw new Error("BECH32_DATA_INVALID");
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) { bits -= toBits; result.push((acc >> bits) & maxv); }
  }
  if (bits >= fromBits || ((acc << (toBits - bits)) & maxv) !== 0) throw new Error("BECH32_PADDING_INVALID");
  return Buffer.from(result);
}

function decodeAddress(address: string) {
  if (address !== address.toLowerCase()) throw new Error("CARDANO_ADDRESS_CASE_INVALID");
  const separator = address.lastIndexOf("1");
  if (separator < 1 || separator + 7 > address.length) throw new Error("CARDANO_ADDRESS_INVALID");
  const hrp = address.slice(0, separator);
  const values = [...address.slice(separator + 1)].map((char) => BECH32_ALPHABET.indexOf(char));
  if (values.some((value) => value < 0) || bech32Polymod([...bech32ExpandHrp(hrp), ...values]) !== 1) throw new Error("CARDANO_ADDRESS_CHECKSUM_INVALID");
  const bytes = convertBits(values.slice(0, -6), 5, 8);
  if (bytes.length < 29) throw new Error("CARDANO_ADDRESS_LENGTH_INVALID");
  return { hrp, bytes, networkId: bytes[0] & 0x0f, type: bytes[0] >> 4 };
}

function assertAddressNetwork(address: string, network: CardanoNetwork) {
  const decoded = decodeAddress(address);
  const expectedNetworkId = network === "cardano:mainnet" ? 1 : 0;
  const expectedHrp = network === "cardano:mainnet" ? "addr" : "addr_test";
  if (decoded.networkId !== expectedNetworkId || decoded.hrp !== expectedHrp) throw new Error("CARDANO_ADDRESS_NETWORK_MISMATCH");
  return decoded;
}

function paymentKeyHash(address: string, network: CardanoNetwork) {
  const decoded = assertAddressNetwork(address, network);
  if (![0, 2, 4, 6].includes(decoded.type)) throw new Error("CARDANO_PAYER_KEY_CREDENTIAL_REQUIRED");
  return decoded.bytes.subarray(1, 29);
}

function decodeSignedTransaction(transactionBase64: string) {
  if (transactionBase64.length > Math.ceil(CARDANO_TRANSACTION_MAX_BYTES / 3) * 4) throw new Error("CARDANO_TRANSACTION_TOO_LARGE");
  const bytes = Buffer.from(transactionBase64, "base64");
  if (!bytes.length || bytes.length > CARDANO_TRANSACTION_MAX_BYTES || bytes.toString("base64") !== transactionBase64) throw new Error("CARDANO_TRANSACTION_BASE64_INVALID");
  const root = parseCbor(bytes);
  if (root.end !== bytes.length) throw new Error("CARDANO_TRANSACTION_TRAILING_DATA");
  const txParts = asArray(root, "CARDANO_TRANSACTION_ARRAY_REQUIRED");
  if (txParts.length < 2 || txParts.length > 4) throw new Error("CARDANO_TRANSACTION_SHAPE_INVALID");
  const body = asMap(txParts[0], "CARDANO_TRANSACTION_BODY_INVALID");
  const witnessSet = asMap(txParts[1], "CARDANO_WITNESS_SET_INVALID");
  if (txParts[2] && txParts[2].value === false) throw new Error("CARDANO_TRANSACTION_PHASE2_INVALID");
  if (txParts[3] && txParts[3].value !== null) throw new Error("CARDANO_AUXILIARY_DATA_UNSUPPORTED");

  const allowedBodyKeys = new Set([0n, 1n, 2n, 3n, 8n, 15n]);
  for (const [key] of body.entries!) if (typeof key.value !== "bigint" || !allowedBodyKeys.has(key.value)) throw new Error("CARDANO_PHASE1_OPERATION_UNSUPPORTED");
  for (const [key] of witnessSet.entries!) if (key.value !== 0n) throw new Error("CARDANO_SCRIPT_OR_BOOTSTRAP_WITNESS_UNSUPPORTED");

  const inputNodes = asArray(mapEntry(body, 0n)!, "CARDANO_INPUTS_INVALID");
  if (!inputNodes.length || inputNodes.length > CARDANO_MAX_INPUTS) throw new Error("CARDANO_INPUT_COUNT_INVALID");
  const inputs = inputNodes.map((node) => {
    const pair = asArray(node, "CARDANO_INPUT_INVALID");
    if (pair.length !== 2) throw new Error("CARDANO_INPUT_INVALID");
    const hash = asBytes(pair[0], "CARDANO_INPUT_HASH_INVALID");
    const index = asBigInt(pair[1], "CARDANO_INPUT_INDEX_INVALID");
    if (hash.length !== 32 || index < 0n || index > 65535n) throw new Error("CARDANO_INPUT_INVALID");
    return `${hash.toString("hex")}#${index.toString()}`;
  });

  const outputNodes = asArray(mapEntry(body, 1n)!, "CARDANO_OUTPUTS_INVALID");
  if (!outputNodes.length) throw new Error("CARDANO_OUTPUTS_INVALID");
  const outputs = outputNodes.map((node) => {
    const untagged = untag(node);
    let addressNode: CborNode | undefined;
    let valueNode: CborNode | undefined;
    if (untagged.entries) {
      const allowedOutputKeys = new Set([0n, 1n]);
      for (const [key] of untagged.entries) if (typeof key.value !== "bigint" || !allowedOutputKeys.has(key.value)) throw new Error("CARDANO_OUTPUT_FEATURE_UNSUPPORTED");
      addressNode = mapEntry(untagged, 0n);
      valueNode = mapEntry(untagged, 1n);
    } else {
      const items = asArray(untagged, "CARDANO_OUTPUT_INVALID");
      if (items.length !== 2) throw new Error("CARDANO_OUTPUT_FEATURE_UNSUPPORTED");
      [addressNode, valueNode] = items;
    }
    const addressBytes = asBytes(addressNode, "CARDANO_OUTPUT_ADDRESS_INVALID");
    const value = untag(valueNode!);
    let lovelace: bigint;
    if (typeof value.value === "bigint") lovelace = value.value;
    else {
      const parts = asArray(value, "CARDANO_OUTPUT_VALUE_INVALID");
      if (parts.length !== 2) throw new Error("CARDANO_OUTPUT_VALUE_INVALID");
      lovelace = asBigInt(parts[0], "CARDANO_OUTPUT_VALUE_INVALID");
    }
    if (lovelace < 0n) throw new Error("CARDANO_OUTPUT_VALUE_INVALID");
    return { addressBytes, lovelace };
  });

  const fee = asBigInt(mapEntry(body, 2n), "CARDANO_FEE_REQUIRED");
  const ttl = asBigInt(mapEntry(body, 3n), "CARDANO_TTL_REQUIRED");
  const validityStart = mapEntry(body, 8n) ? asBigInt(mapEntry(body, 8n), "CARDANO_VALIDITY_START_INVALID") : undefined;
  const networkId = mapEntry(body, 15n) ? asBigInt(mapEntry(body, 15n), "CARDANO_NETWORK_ID_INVALID") : undefined;
  if (fee < 0n || ttl < 0n) throw new Error("CARDANO_TRANSACTION_NUMERIC_INVALID");

  const bodyBytes = bytes.subarray(body.start, body.end);
  const bodyHash = blake2b(bodyBytes, 32);
  const transactionId = bodyHash.toString("hex");
  const vkeyNode = mapEntry(witnessSet, 0n);
  const witnesses = vkeyNode ? asArray(vkeyNode, "CARDANO_VKEY_WITNESSES_INVALID") : [];
  if (!witnesses.length) throw new Error("CARDANO_TRANSACTION_UNSIGNED");
  const witnessKeys: Buffer[] = [];
  for (const witness of witnesses) {
    const pair = asArray(witness, "CARDANO_VKEY_WITNESS_INVALID");
    if (pair.length !== 2) throw new Error("CARDANO_VKEY_WITNESS_INVALID");
    const vkey = asBytes(pair[0], "CARDANO_VKEY_INVALID");
    const signature = asBytes(pair[1], "CARDANO_SIGNATURE_INVALID");
    if (vkey.length !== 32 || signature.length !== 64) throw new Error("CARDANO_VKEY_WITNESS_INVALID");
    const publicKey = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, vkey]), format: "der", type: "spki" });
    if (!verifySignature(null, bodyHash, publicKey, signature)) throw new Error("CARDANO_INVALID_SIGNATURE");
    witnessKeys.push(vkey);
  }
  return { bytes, transactionId, inputs, outputs, fee, ttl, validityStart, networkId, witnessKeys };
}

function amountOf(rows: Array<{ unit: string; quantity: string }>, unit = "lovelace") {
  return BigInt(rows.find((row) => row.unit === unit)?.quantity ?? "0");
}

async function jsonFetch(env: CardanoFacilitatorEnv, path: string, init?: RequestInit, allowNotFound = false) {
  const response = await fetch(`${env.CARDANO_BLOCKFROST_URL.replace(/\/$/, "")}${path}`, {
    ...init,
    redirect: "error",
    cache: "no-store",
    headers: { project_id: env.CARDANO_BLOCKFROST_PROJECT_ID, accept: "application/json", ...(init?.headers ?? {}) },
    signal: init?.signal ?? AbortSignal.timeout(10000),
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`CARDANO_PROVIDER_${response.status}`);
  return response.json();
}

const txUtxosSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  outputs: z.array(z.object({ output_index: z.number().int().nonnegative(), address: z.string(), amount: z.array(z.object({ unit: z.string(), quantity: z.string().regex(/^\d+$/) })) })),
});
const addressUtxoSchema = z.array(z.object({ tx_hash: z.string().regex(/^[0-9a-f]{64}$/), output_index: z.number().int().nonnegative(), amount: z.array(z.object({ unit: z.string(), quantity: z.string().regex(/^\d+$/) })) }));
const latestBlockSchema = z.object({ height: z.number().int().nonnegative(), slot: z.number().int().nonnegative().nullable() });
const transactionEvidenceSchema = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), block_height: z.number().int().nonnegative(), valid_contract: z.boolean().optional() });

async function sourceOutput(env: CardanoFacilitatorEnv, ref: string) {
  const [hash, indexRaw] = ref.split("#");
  const index = Number(indexRaw);
  const data = txUtxosSchema.parse(await jsonFetch(env, `/txs/${hash}/utxos`));
  if (data.hash !== hash) throw new Error("CARDANO_INPUT_EVIDENCE_HASH_MISMATCH");
  const output = data.outputs.find((row) => row.output_index === index);
  if (!output) throw new Error("CARDANO_INPUT_EVIDENCE_MISSING");
  return output;
}

async function nonceIsUnspent(env: CardanoFacilitatorEnv, payer: string, nonce: string) {
  const [hash, indexRaw] = nonce.split("#");
  const index = Number(indexRaw);
  for (let page = 1; page <= CARDANO_UTXO_PAGE_LIMIT; page++) {
    const rows = addressUtxoSchema.parse(await jsonFetch(env, `/addresses/${encodeURIComponent(payer)}/utxos?count=${CARDANO_UTXO_PAGE_SIZE}&page=${page}&order=asc`));
    if (rows.some((row) => row.tx_hash === hash && row.output_index === index)) return true;
    if (rows.length < CARDANO_UTXO_PAGE_SIZE) return false;
  }
  throw new Error("CARDANO_PAYER_UTXO_SET_TOO_LARGE");
}

function claimBinding(requirement: Requirement, nonce: string, payer: string) {
  return createHash("sha256").update(stable({ requirement, nonce, payer })).digest("hex");
}

const claimSchema = z.object({ data: z.object({ transactionHash: z.string(), network: z.string(), bindingHash: z.string(), state: z.enum(["CLAIMED", "SUBMISSION_STARTED", "CONFIRMED", "REJECTED"]) }) });

async function claimRequest(env: CardanoFacilitatorEnv, action: "CLAIM" | "MARK_SUBMISSION_STARTED" | "CONFIRM" | "REJECT", transactionHash: string, bindingHash: string) {
  const response = await fetch(env.CARDANO_SETTLEMENT_STORE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.CARDANO_SETTLEMENT_STORE_API_KEY}` },
    body: JSON.stringify({ action, transactionHash, network: `cardano:${env.CARDANO_NETWORK}`, bindingHash }),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 409) throw new Error("CARDANO_SETTLEMENT_REPLAY");
  if (!response.ok) throw new Error(`CARDANO_SETTLEMENT_STORE_${response.status}`);
  return claimSchema.parse(await response.json()).data;
}

async function readClaim(env: CardanoFacilitatorEnv, transactionHash: string) {
  const url = new URL(env.CARDANO_SETTLEMENT_STORE_URL);
  url.searchParams.set("transactionHash", transactionHash);
  const response = await fetch(url, { headers: { authorization: `Bearer ${env.CARDANO_SETTLEMENT_STORE_API_KEY}` }, signal: AbortSignal.timeout(10000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`CARDANO_SETTLEMENT_STORE_${response.status}`);
  return claimSchema.parse(await response.json()).data;
}

async function verifyTransaction(env: CardanoFacilitatorEnv, payload: ExactPayload, requirement: Requirement) {
  const network = `cardano:${env.CARDANO_NETWORK}` as CardanoNetwork;
  if (requirement.network !== network || payload.accepted.network !== network) throw new Error("CARDANO_NETWORK_MISMATCH");
  if (!sameRequirement(payload.accepted, requirement)) throw new Error("CARDANO_REQUIREMENT_MISMATCH");
  if ((payload.payload.submissionMode ?? "server") !== "server") throw new Error("CARDANO_SUBMISSION_MODE_MISMATCH");
  assertAddressNetwork(requirement.payTo, network);
  const payerDecoded = assertAddressNetwork(env.CARDANO_PAYER_ADDRESS, network);
  const payeeDecoded = assertAddressNetwork(requirement.payTo, network);
  const transaction = decodeSignedTransaction(payload.payload.transaction);
  if (!transaction.inputs.includes(payload.payload.nonce)) throw new Error("CARDANO_NONCE_NOT_IN_INPUTS");
  const expectedNetworkId = network === "cardano:mainnet" ? 1n : 0n;
  if (transaction.networkId !== undefined && transaction.networkId !== expectedNetworkId) throw new Error("CARDANO_NETWORK_ID_MISMATCH");
  if (transaction.fee > BigInt(env.CARDANO_MAX_FEE_LOVELACE)) throw new Error("CARDANO_FEE_LIMIT_EXCEEDED");

  const payerKey = paymentKeyHash(env.CARDANO_PAYER_ADDRESS, network);
  if (!transaction.witnessKeys.some((vkey) => blake2b(vkey, 28).equals(payerKey))) throw new Error("CARDANO_PAYER_SIGNATURE_MISSING");

  const block = latestBlockSchema.parse(await jsonFetch(env, "/blocks/latest"));
  if (block.slot === null) throw new Error("CARDANO_LATEST_SLOT_UNAVAILABLE");
  const currentSlot = BigInt(block.slot);
  if (transaction.ttl <= currentSlot) throw new Error("CARDANO_TTL_EXPIRED");
  if (transaction.ttl > currentSlot + BigInt(requirement.maxTimeoutSeconds) + CARDANO_TTL_SLOP_SLOTS) throw new Error("CARDANO_TTL_TOO_FAR");
  if (transaction.validityStart !== undefined && transaction.validityStart > currentSlot + CARDANO_TTL_SLOP_SLOTS) throw new Error("CARDANO_VALIDITY_NOT_YET_VALID");

  let inputLovelace = 0n;
  for (const ref of transaction.inputs) {
    const output = await sourceOutput(env, ref);
    if (output.address !== env.CARDANO_PAYER_ADDRESS) throw new Error("CARDANO_INPUT_PAYER_MISMATCH");
    inputLovelace += amountOf(output.amount);
  }

  let payeeLovelace = 0n;
  let outputLovelace = 0n;
  for (const output of transaction.outputs) {
    outputLovelace += output.lovelace;
    if (output.addressBytes.equals(payeeDecoded.bytes)) payeeLovelace += output.lovelace;
    else if (!output.addressBytes.equals(payerDecoded.bytes)) throw new Error("CARDANO_UNAUTHORIZED_OUTPUT");
  }
  if (payeeLovelace !== BigInt(requirement.amount)) throw new Error("CARDANO_RECIPIENT_AMOUNT_MISMATCH");
  if (inputLovelace !== outputLovelace + transaction.fee) throw new Error("CARDANO_VALUE_CONSERVATION_MISMATCH");

  const bindingHash = claimBinding(requirement, payload.payload.nonce, env.CARDANO_PAYER_ADDRESS);
  const existing = await readClaim(env, transaction.transactionId);
  if (existing && (existing.bindingHash !== bindingHash || existing.network !== network)) throw new Error("CARDANO_SETTLEMENT_REPLAY");
  if (!existing && !(await nonceIsUnspent(env, env.CARDANO_PAYER_ADDRESS, payload.payload.nonce))) throw new Error("CARDANO_NONCE_NOT_AVAILABLE");
  if (existing?.state === "REJECTED") throw new Error("CARDANO_SETTLEMENT_DEFINITIVELY_REJECTED");

  return { transaction, bindingHash, existingClaim: existing };
}

async function transactionConfirmations(env: CardanoFacilitatorEnv, transactionId: string) {
  const txRaw = await jsonFetch(env, `/txs/${transactionId}`, undefined, true);
  if (txRaw === null) return null;
  const [tx, latest] = await Promise.all([
    Promise.resolve(transactionEvidenceSchema.parse(txRaw)),
    jsonFetch(env, "/blocks/latest").then((value) => latestBlockSchema.parse(value)),
  ]);
  if (tx.hash !== transactionId || tx.valid_contract === false || latest.height < tx.block_height) throw new Error("CARDANO_SETTLEMENT_EVIDENCE_MISMATCH");
  return latest.height - tx.block_height;
}

function requiredConfirmations(requirement: Requirement) {
  const value = (requirement.extra.confirmationPolicy as { l1Confirmations?: unknown } | undefined)?.l1Confirmations;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 120 ? value : 1;
}

async function waitForConfirmation(env: CardanoFacilitatorEnv, transactionId: string, confirmations: number) {
  const deadline = Date.now() + env.CARDANO_CONFIRMATION_TIMEOUT_MS;
  do {
    const observed = await transactionConfirmations(env, transactionId);
    if (observed !== null && observed >= confirmations) return true;
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, env.CARDANO_CONFIRMATION_POLL_MS));
  } while (true);
  return false;
}

async function submitTransaction(env: CardanoFacilitatorEnv, transaction: { bytes: Buffer; transactionId: string }) {
  const response = await fetch(`${env.CARDANO_BLOCKFROST_URL.replace(/\/$/, "")}/tx/submit`, {
    method: "POST",
    headers: { project_id: env.CARDANO_BLOCKFROST_PROJECT_ID, "content-type": "application/cbor", accept: "application/json" },
    body: transaction.bytes,
    signal: AbortSignal.timeout(60000),
    redirect: "error",
  });
  const raw = (await response.text()).trim();
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return { kind: "rejected" as const, code: response.status };
    return { kind: "unknown" as const, code: response.status };
  }
  const reported = raw.replace(/^"|"$/g, "").toLowerCase();
  if (reported && reported !== transaction.transactionId) return { kind: "unknown" as const, code: 502 };
  return { kind: "submitted" as const };
}

function publicInvalid(error: unknown) {
  const message = error instanceof Error ? error.message : "CARDANO_PAYMENT_INVALID";
  const safe = message.startsWith("CARDANO_") ? message.slice(0, 120) : "CARDANO_PAYMENT_INVALID";
  return { isValid: false, invalidReason: safe.toLowerCase(), invalidMessage: safe };
}

export function createCardanoApp(env: CardanoFacilitatorEnv): { app: Hono; network: CardanoNetwork } {
  const network = `cardano:${env.CARDANO_NETWORK}` as CardanoNetwork;
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok", network, x402Version: 2, signing: "isolated-remote" }));
  app.get("/supported", (c) => c.json({ kinds: [{ x402Version: 2, scheme: "exact", network, extra: { assetTransferMethods: ["default"], settlementLayers: ["l1"], areFeesSponsored: false, submissionModes: ["server"], l1Confirmations: { server: { minimum: 0, maximum: 120 } } } }] }));

  app.post("/managed-sign", async (c) => {
    if (!secretMatches(env.MANAGED_SIGNING_API_KEY, env.FACILITATOR_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const { paymentRequirements } = z.object({ paymentRequirements: requirementSchema }).parse(await boundedJson(c.req.raw));
      if (paymentRequirements.network !== network) return c.json({ code: "NETWORK_MISMATCH" }, 422);
      const signerResponse = await fetch(env.CARDANO_SIGNER_URL, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.CARDANO_SIGNER_API_KEY}` },
        body: JSON.stringify({ network, payerAddress: env.CARDANO_PAYER_ADDRESS, paymentRequirements, submissionMode: "server" }),
        signal: AbortSignal.timeout(30000),
        redirect: "error",
      });
      if (!signerResponse.ok) return c.json({ code: "SIGNER_UNAVAILABLE" }, 502);
      const signed = signerResponseSchema.parse(await signerResponse.json());
      const paymentPayload: ExactPayload = { x402Version: 2, accepted: paymentRequirements, payload: { transaction: signed.transaction, nonce: signed.nonce, submissionMode: "server" } };
      const verified = await verifyTransaction(env, paymentPayload, paymentRequirements);
      return c.json({ paymentPayload, transactionId: verified.transaction.transactionId });
    } catch (error) {
      console.error(JSON.stringify({ event: "cardano_managed_sign_failed", error: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN" }));
      return c.json({ code: error instanceof Error && error.message.startsWith("CARDANO_") ? error.message : "SIGNING_FAILED" }, 422);
    }
  });

  app.post("/verify", async (c) => {
    if (!secretMatches(env.SETTLEMENT_API_KEY, env.FACILITATOR_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    try {
      const body = requestSchema.parse(await boundedJson(c.req.raw));
      await verifyTransaction(env, body.paymentPayload, body.paymentRequirements);
      return c.json({ isValid: true, payer: env.CARDANO_PAYER_ADDRESS });
    } catch (error) {
      return c.json(publicInvalid(error), 200);
    }
  });

  app.post("/settle", async (c) => {
    if (!secretMatches(env.SETTLEMENT_API_KEY, env.FACILITATOR_API_KEY, c.req.header("authorization"))) return c.json({ code: "UNAUTHORIZED" }, 401);
    let body: z.infer<typeof requestSchema>;
    let verified: Awaited<ReturnType<typeof verifyTransaction>>;
    try {
      body = requestSchema.parse(await boundedJson(c.req.raw));
      verified = await verifyTransaction(env, body.paymentPayload, body.paymentRequirements);
    } catch (error) {
      const invalid = publicInvalid(error);
      return c.json({ success: false, errorReason: invalid.invalidReason, errorMessage: invalid.invalidMessage, transaction: "", network }, 422);
    }

    const transactionId = verified.transaction.transactionId;
    try {
      let claim = await claimRequest(env, "CLAIM", transactionId, verified.bindingHash);
      if (claim.state === "CONFIRMED") return c.json({ success: true, payer: env.CARDANO_PAYER_ADDRESS, transaction: transactionId, transactionId, network, amount: body.paymentRequirements.amount });
      if (claim.state === "REJECTED") return c.json({ success: false, errorReason: "settlement_definitively_rejected", transaction: transactionId, transactionId, network }, 422);

      const confirmations = requiredConfirmations(body.paymentRequirements);
      if (claim.state === "SUBMISSION_STARTED") {
        const confirmed = await waitForConfirmation(env, transactionId, confirmations);
        if (confirmed) {
          await claimRequest(env, "CONFIRM", transactionId, verified.bindingHash);
          return c.json({ success: true, payer: env.CARDANO_PAYER_ADDRESS, transaction: transactionId, transactionId, network, amount: body.paymentRequirements.amount });
        }
        return c.json({ success: false, errorReason: "payment_pending", errorMessage: "CARDANO_SETTLEMENT_PENDING", transaction: transactionId, transactionId, network }, 503);
      }

      claim = await claimRequest(env, "MARK_SUBMISSION_STARTED", transactionId, verified.bindingHash);
      if (claim.state !== "SUBMISSION_STARTED") throw new Error("CARDANO_SETTLEMENT_STATE_INVALID");
      let submission: Awaited<ReturnType<typeof submitTransaction>>;
      try { submission = await submitTransaction(env, verified.transaction); }
      catch (error) {
        console.error(JSON.stringify({ event: "cardano_submission_unknown", transactionId, error: error instanceof Error ? error.name : "UNKNOWN" }));
        return c.json({ success: false, errorReason: "settlement_unknown", errorMessage: "CARDANO_SUBMISSION_UNKNOWN", transaction: transactionId, transactionId, network }, 503);
      }
      if (submission.kind === "rejected") {
        await claimRequest(env, "REJECT", transactionId, verified.bindingHash);
        return c.json({ success: false, errorReason: "settlement_definitively_rejected", errorMessage: `CARDANO_PROVIDER_${submission.code}`, transaction: transactionId, transactionId, network }, 422);
      }
      if (submission.kind === "unknown") return c.json({ success: false, errorReason: "settlement_unknown", errorMessage: `CARDANO_PROVIDER_${submission.code}`, transaction: transactionId, transactionId, network }, 503);

      const confirmed = await waitForConfirmation(env, transactionId, confirmations);
      if (!confirmed) return c.json({ success: false, errorReason: "payment_pending", errorMessage: "CARDANO_SETTLEMENT_PENDING", transaction: transactionId, transactionId, network }, 503);
      await claimRequest(env, "CONFIRM", transactionId, verified.bindingHash);
      return c.json({ success: true, payer: env.CARDANO_PAYER_ADDRESS, transaction: transactionId, transactionId, network, amount: body.paymentRequirements.amount });
    } catch (error) {
      console.error(JSON.stringify({ event: "cardano_settlement_failed", transactionId, error: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN" }));
      const reason = error instanceof Error && error.message === "CARDANO_SETTLEMENT_REPLAY" ? "duplicate_settlement" : "settlement_unknown";
      return c.json({ success: false, errorReason: reason, errorMessage: reason === "duplicate_settlement" ? "CARDANO_SETTLEMENT_REPLAY" : "CARDANO_SETTLEMENT_CONTROL_PLANE_UNAVAILABLE", transaction: transactionId, transactionId, network }, reason === "duplicate_settlement" ? 422 : 503);
    }
  });

  return { app, network };
}
