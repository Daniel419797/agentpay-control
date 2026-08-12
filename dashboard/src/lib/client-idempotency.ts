const PREFIX = "agentpay:idempotency:";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}

async function requestFingerprint(method: string, path: string, body: unknown) {
  const bytes = new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${stable(body)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function storage() {
  try { return window.sessionStorage; } catch { return null; }
}

export async function idempotencyKeyForRequest(method: string, path: string, body: unknown) {
  const fingerprint = await requestFingerprint(method, path, body);
  const storageKey = `${PREFIX}${fingerprint}`;
  const store = storage();
  const existing = store?.getItem(storageKey);
  if (existing) return { key: existing, fingerprint, storageKey };
  const key = crypto.randomUUID();
  store?.setItem(storageKey, key);
  return { key, fingerprint, storageKey };
}

export function releaseIdempotencyKey(storageKey: string) {
  storage()?.removeItem(storageKey);
}

export function shouldRetainIdempotencyKey(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}
