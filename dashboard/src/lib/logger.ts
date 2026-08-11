type LogFields = Record<string, unknown>;

const REDACTED = "[REDACTED]";
const sensitiveKey = /(?:^|_)(?:authorization|cookie|password|passphrase|secret|private(?:_?key)?|api_?key|access_?token|refresh_?token|session_?token|signing_?key|encryption_?key|mnemonic|seed)(?:$|_)/i;
const sensitiveCompactKey = /(?:authorization|cookie|password|passphrase|secret|privateKey|apiKey|accessToken|refreshToken|sessionToken|signingKey|encryptionKey|mnemonic|seed)/i;

function redactString(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bwhsec_[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\bap_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/([?&](?:token|secret|key|api_key|apikey|access_token|refresh_token)=)[^&#\s]+/gi, `$1${encodeURIComponent(REDACTED)}`)
    .replace(/(https?:\/\/[^:/\s]+:)[^@/\s]+@/gi, `$1${REDACTED}@`);
}

function shouldRedactKey(key: string) {
  return sensitiveKey.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2")) || sensitiveCompactKey.test(key);
}

function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return redactString(value);
  if (typeof value === "function" || typeof value === "symbol") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof URL) {
    const copy = new URL(value.toString());
    if (copy.password) copy.password = REDACTED;
    for (const key of [...copy.searchParams.keys()]) if (shouldRedactKey(key)) copy.searchParams.set(key, REDACTED);
    return copy.toString();
  }
  if (value instanceof Error) return serializeError(value);
  if (typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = shouldRedactKey(key) ? REDACTED : sanitize(item, seen);
  return output;
}

function serializeError(error: unknown) {
  if (!(error instanceof Error)) return { type: "UnknownError", message: redactString(String(error)) };
  return {
    type: error.name,
    message: redactString(error.message),
    ...(process.env.APP_ENV === "production" ? {} : { stack: error.stack ? redactString(error.stack) : undefined }),
  };
}

export function logError(event: string, error: unknown, fields: LogFields = {}) {
  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    service: "agentpay-control",
    event,
    ...(sanitize(fields) as LogFields),
    error: serializeError(error),
  }));
}
