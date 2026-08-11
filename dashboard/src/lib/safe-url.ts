import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as pinnedFetch, type Dispatcher, type RequestInit as UndiciRequestInit } from "undici";

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" ||
    normalized.startsWith("::ffff:") || normalized.startsWith("0:0:0:0:0:ffff:") ||
    normalized.startsWith("fc") || normalized.startsWith("fd") ||
    normalized.startsWith("fe") ||
    normalized.startsWith("ff");
}

export function isPrivateAddress(address: string) {
  const version = isIP(address);
  return version === 4 ? isPrivateIpv4(address) : version === 6 ? isPrivateIpv6(address) : true;
}

export function validateResourceUrl(value: string, production: boolean) {
  const url = new URL(value);
  if (url.username || url.password || url.hash) throw new Error("RESOURCE_URL_UNSAFE");
  if (production && url.protocol !== "https:") throw new Error("RESOURCE_URL_HTTPS_REQUIRED");
  if (!production && !["http:", "https:"].includes(url.protocol)) throw new Error("RESOURCE_URL_UNSAFE");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase()) && production) throw new Error("RESOURCE_URL_PRIVATE_NETWORK");
  if (isIP(url.hostname) && isPrivateAddress(url.hostname) && production) throw new Error("RESOURCE_URL_PRIVATE_NETWORK");
  return url;
}

export async function assertSafeResourceUrl(value: string, production: boolean) {
  const url = validateResourceUrl(value, production);
  if (!production) return url;
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("RESOURCE_URL_PRIVATE_NETWORK");
  return url;
}

type ResolvedAddress = { address: string; family: 4 | 6 };
const MAX_PINNED_DISPATCHERS = 64;
const pinnedDispatchers = new Map<string, Dispatcher>();

export function createPinnedLookup(resolved: ResolvedAddress) {
  return (_hostname: string, options: { all?: boolean }, callback: (error: Error | null, address: string | Array<ResolvedAddress>, family?: number) => void) => {
    if (options.all) callback(null, [resolved]);
    else callback(null, resolved.address, resolved.family);
  };
}

function dispatcherFor(hostname: string, resolved: ResolvedAddress): Dispatcher {
  const key = `${hostname}:${resolved.family}:${resolved.address}`;
  const existing = pinnedDispatchers.get(key);
  if (existing) {
    pinnedDispatchers.delete(key);
    pinnedDispatchers.set(key, existing);
    return existing;
  }
  const dispatcher = new Agent({ connect: { lookup: createPinnedLookup(resolved) as never } });
  pinnedDispatchers.set(key, dispatcher);
  if (pinnedDispatchers.size > MAX_PINNED_DISPATCHERS) {
    const oldestKey = pinnedDispatchers.keys().next().value as string | undefined;
    const oldest = oldestKey ? pinnedDispatchers.get(oldestKey) : undefined;
    if (oldestKey) pinnedDispatchers.delete(oldestKey);
    if (oldest) void oldest.destroy();
  }
  return dispatcher;
}

/**
 * Validates and pins DNS for the actual socket connection, preventing a hostname
 * from resolving publicly during validation and privately during fetch.
 */
export async function safeFetch(value: string | URL, init: RequestInit, production: boolean): Promise<Response> {
  const url = validateResourceUrl(value.toString(), production);
  if (!production) return fetch(url, init);
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("RESOURCE_URL_PRIVATE_NETWORK");
  const selected = addresses[0] as ResolvedAddress;
  const dispatcher = dispatcherFor(url.hostname, selected);
  return await pinnedFetch(url, { ...init, dispatcher } as unknown as UndiciRequestInit) as unknown as Response;
}
