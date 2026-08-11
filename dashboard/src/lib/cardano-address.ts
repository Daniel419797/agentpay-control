const BECH32_ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function polymod(values: number[]) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) if ((top >>> i) & 1) checksum ^= generators[i];
  }
  return checksum >>> 0;
}

function expandHrp(hrp: string) {
  return [...hrp].map((char) => char.charCodeAt(0) >> 5).concat(0, [...hrp].map((char) => char.charCodeAt(0) & 31));
}

function convertBits(values: number[], fromBits: number, toBits: number): Uint8Array {
  let accumulator = 0;
  let bits = 0;
  const result: number[] = [];
  const maxValue = (1 << toBits) - 1;
  for (const value of values) {
    if (value < 0 || value >> fromBits !== 0) throw new Error("CARDANO_ADDRESS_DATA_INVALID");
    accumulator = (accumulator << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      result.push((accumulator >> bits) & maxValue);
    }
  }
  if (bits >= fromBits || ((accumulator << (toBits - bits)) & maxValue) !== 0) throw new Error("CARDANO_ADDRESS_PADDING_INVALID");
  return Uint8Array.from(result);
}

export function decodeCardanoAddress(address: string) {
  if (address !== address.toLowerCase()) throw new Error("CARDANO_ADDRESS_CASE_INVALID");
  const separator = address.lastIndexOf("1");
  if (separator < 1 || separator + 7 > address.length) throw new Error("CARDANO_ADDRESS_INVALID");
  const hrp = address.slice(0, separator);
  const values = [...address.slice(separator + 1)].map((char) => BECH32_ALPHABET.indexOf(char));
  if (values.some((value) => value < 0) || polymod([...expandHrp(hrp), ...values]) !== 1) throw new Error("CARDANO_ADDRESS_CHECKSUM_INVALID");
  const bytes = convertBits(values.slice(0, -6), 5, 8);
  if (bytes.length < 29) throw new Error("CARDANO_ADDRESS_LENGTH_INVALID");
  return { hrp, bytes, type: bytes[0] >> 4, networkId: bytes[0] & 15 };
}

export function cardanoPaymentCredentialHash(address: string, network: "Preprod" | "Mainnet"): string {
  const decoded = decodeCardanoAddress(address);
  const expectedHrp = network === "Mainnet" ? "addr" : "addr_test";
  const expectedNetworkId = network === "Mainnet" ? 1 : 0;
  if (decoded.hrp !== expectedHrp || decoded.networkId !== expectedNetworkId) throw new Error("CARDANO_ADDRESS_NETWORK_MISMATCH");
  // Base/enterprise key-payment credentials. Script-payment credentials are
  // intentionally rejected because Masumi sellingWalletVkey is a key hash.
  if (![0, 2, 6].includes(decoded.type)) throw new Error("CARDANO_PAYMENT_KEY_CREDENTIAL_REQUIRED");
  return Buffer.from(decoded.bytes.slice(1, 29)).toString("hex");
}

export function assertCardanoPaymentCredential(address: string, network: "Preprod" | "Mainnet", expectedHash: string) {
  if (!/^[0-9a-fA-F]{56}$/.test(expectedHash)) throw new Error("CARDANO_PAYMENT_KEY_HASH_INVALID");
  const actual = cardanoPaymentCredentialHash(address, network);
  if (actual !== expectedHash.toLowerCase()) throw new Error("MASUMI_SELLER_PAYMENT_KEY_MISMATCH");
  return actual;
}
