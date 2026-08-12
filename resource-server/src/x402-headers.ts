const MAX_HEADER_JSON_BYTES = 128 * 1024;

export function encodeX402Header(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeX402Header(value: string, maxJsonBytes = MAX_HEADER_JSON_BYTES): unknown {
  if (value.length > Math.ceil(maxJsonBytes * 4 / 3) + 8) throw new Error("PAYMENT_HEADER_TOO_LARGE");

  const candidates: string[] = [];
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded && Buffer.byteLength(decoded, "utf8") <= maxJsonBytes) candidates.push(decoded);
  } catch {
    // Fall through to the temporary raw-JSON compatibility path.
  }
  if (Buffer.byteLength(value, "utf8") <= maxJsonBytes) candidates.push(value);

  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try next representation */ }
  }
  throw new Error("PAYMENT_HEADER_INVALID");
}
