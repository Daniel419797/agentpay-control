export function encodeX402Header(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

export function decodeX402Header(value: string, maxJsonBytes = 128 * 1024): unknown {
  if (value.length > Math.ceil(maxJsonBytes * 4 / 3) + 8) throw new Error("X402_HEADER_TOO_LARGE");
  const candidates: string[] = [];
  try {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    if (decoded && Buffer.byteLength(decoded, "utf8") <= maxJsonBytes) candidates.push(decoded);
  } catch {
    // Continue to temporary raw-JSON compatibility handling.
  }
  if (Buffer.byteLength(value, "utf8") <= maxJsonBytes) candidates.push(value);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try next representation */ }
  }
  throw new Error("X402_HEADER_INVALID");
}
