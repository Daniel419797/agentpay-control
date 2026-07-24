type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

export function extractSignatureMap(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) return null;

  const directSignature = payload.signatureMap;
  if (typeof directSignature === "string" && directSignature.length > 0) {
    return directSignature;
  }

  const result = asRecord(payload.result);
  const nestedSignature = result?.signatureMap;
  return typeof nestedSignature === "string" && nestedSignature.length > 0
    ? nestedSignature
    : null;
}
