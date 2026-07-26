import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19));
}

function isPrivateIpv6(address: string) {
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") ||
    normalized.startsWith("fea") || normalized.startsWith("feb");
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
