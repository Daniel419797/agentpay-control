import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function isPrivateIpv4(address) {
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

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase();
  return normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:") || normalized.startsWith("0:0:0:0:0:ffff:") || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe") || normalized.startsWith("ff");
}

export function isPrivateAddress(address) {
  const version = isIP(address);
  return version === 4 ? isPrivateIpv4(address) : version === 6 ? isPrivateIpv6(address) : true;
}

export function normalizeHost(value) {
  const host = value.trim().toLowerCase().replace(/\.$/, "");
  if (!host || host.length > 253 || host.includes("/") || host.includes(":") || host.includes("@") || host.includes("..")) throw new Error("EXECUTOR_HOST_INVALID");
  if (isIP(host) === 4) return host;
  const labels = host.split(".");
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error("EXECUTOR_HOST_INVALID");
  return host;
}

export function parseTrustedHosts(value = "") {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean).map(normalizeHost))];
}

export async function resolvePublicHost(hostname) {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host.endsWith(".localhost")) throw new Error("EXECUTOR_PRIVATE_NETWORK_BLOCKED");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("EXECUTOR_PRIVATE_NETWORK_BLOCKED");
    return { host, address: host, family: isIP(host) };
  }
  const addresses = await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("EXECUTOR_PRIVATE_NETWORK_BLOCKED");
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  return { host, address: selected.address, family: selected.family };
}

export function assertAllowedUrl(value, allowedHosts) {
  const url = new URL(value);
  if (url.protocol === "data:" || url.protocol === "blob:") return url;
  if (url.protocol !== "https:") throw new Error("EXECUTOR_HTTPS_REQUIRED");
  if (url.username || url.password) throw new Error("EXECUTOR_URL_CREDENTIALS_REJECTED");
  const host = normalizeHost(url.hostname);
  if (!allowedHosts.has(host)) throw new Error("EXECUTOR_EGRESS_BLOCKED");
  return url;
}

export async function buildPinnedNetworkPolicy(merchantUrl, trustedHosts = []) {
  const merchant = new URL(merchantUrl);
  if (merchant.protocol !== "https:") throw new Error("EXECUTOR_HTTPS_REQUIRED");
  const hosts = [...new Set([normalizeHost(merchant.hostname), ...trustedHosts.map(normalizeHost)])];
  const pins = await Promise.all(hosts.map(resolvePublicHost));
  const allowedHosts = new Set(hosts);
  const resolverRules = pins.map(({ host, address }) => `MAP ${host} ${address}`).join(",");
  return { merchantHost: normalizeHost(merchant.hostname), allowedHosts, pins, resolverRules };
}
