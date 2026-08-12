const MASK_64 = 0xffffffffffffffffn;

const IV = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
] as const;

const SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
] as const;

function add(...values: bigint[]) {
  let result = 0n;
  for (const value of values) result = (result + value) & MASK_64;
  return result;
}

function rotr(value: bigint, bits: bigint) {
  return ((value >> bits) | (value << (64n - bits))) & MASK_64;
}

function readWordLE(block: Buffer, offset: number) {
  return block.readBigUInt64LE(offset);
}

function compress(h: bigint[], block: Buffer, bytesCompressed: bigint, last: boolean) {
  const m = Array.from({ length: 16 }, (_, index) => readWordLE(block, index * 8));
  const v = [...h, ...IV];
  v[12] = (v[12] ^ (bytesCompressed & MASK_64)) & MASK_64;
  v[13] = (v[13] ^ ((bytesCompressed >> 64n) & MASK_64)) & MASK_64;
  if (last) v[14] = (~v[14]) & MASK_64;

  function g(a: number, b: number, c: number, d: number, x: bigint, y: bigint) {
    v[a] = add(v[a], v[b], x);
    v[d] = rotr(v[d] ^ v[a], 32n);
    v[c] = add(v[c], v[d]);
    v[b] = rotr(v[b] ^ v[c], 24n);
    v[a] = add(v[a], v[b], y);
    v[d] = rotr(v[d] ^ v[a], 16n);
    v[c] = add(v[c], v[d]);
    v[b] = rotr(v[b] ^ v[c], 63n);
  }

  for (let round = 0; round < 12; round++) {
    const s = SIGMA[round];
    g(0, 4, 8, 12, m[s[0]], m[s[1]]);
    g(1, 5, 9, 13, m[s[2]], m[s[3]]);
    g(2, 6, 10, 14, m[s[4]], m[s[5]]);
    g(3, 7, 11, 15, m[s[6]], m[s[7]]);
    g(0, 5, 10, 15, m[s[8]], m[s[9]]);
    g(1, 6, 11, 12, m[s[10]], m[s[11]]);
    g(2, 7, 8, 13, m[s[12]], m[s[13]]);
    g(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }

  for (let index = 0; index < 8; index++) h[index] = (h[index] ^ v[index] ^ v[index + 8]) & MASK_64;
}

/**
 * One-shot unkeyed BLAKE2b with the digest length encoded in the parameter
 * block, as required by Cardano transaction IDs (32 bytes) and key hashes
 * (28 bytes). Truncating a BLAKE2b-512 digest is not equivalent.
 */
export function blake2b(input: Uint8Array, outputLength: number) {
  if (!Number.isInteger(outputLength) || outputLength < 1 || outputLength > 64) throw new Error("BLAKE2B_OUTPUT_LENGTH_INVALID");
  const data = Buffer.from(input);
  const h = [...IV];
  h[0] = (h[0] ^ BigInt(0x01010000 ^ outputLength)) & MASK_64;

  let offset = 0;
  let compressed = 0n;
  while (offset + 128 < data.length) {
    const block = data.subarray(offset, offset + 128);
    compressed += 128n;
    compress(h, block, compressed, false);
    offset += 128;
  }

  const finalLength = data.length - offset;
  const finalBlock = Buffer.alloc(128);
  if (finalLength > 0) data.copy(finalBlock, 0, offset);
  compressed += BigInt(finalLength);
  compress(h, finalBlock, compressed, true);

  const output = Buffer.alloc(64);
  for (let index = 0; index < 8; index++) output.writeBigUInt64LE(h[index], index * 8);
  return output.subarray(0, outputLength);
}
