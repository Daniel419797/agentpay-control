export const supportedNetworkIds = [
  "hedera:testnet",
  "hedera:mainnet",
  "eip155:5042002",
  "cardano:preprod",
  "cardano:mainnet",
] as const;

export type SupportedNetworkId = (typeof supportedNetworkIds)[number];

const supportedNetworkSet = new Set<string>(supportedNetworkIds);

export function parseEnabledNetworks(value: string): Set<SupportedNetworkId> {
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (entries.length === 0) throw new Error("ENABLED_NETWORKS_EMPTY");
  const invalid = entries.find((entry) => !supportedNetworkSet.has(entry));
  if (invalid) throw new Error(`ENABLED_NETWORK_UNSUPPORTED:${invalid}`);
  return new Set(entries as SupportedNetworkId[]);
}

export function requiresNetwork(enabled: ReadonlySet<SupportedNetworkId>, network: SupportedNetworkId): boolean {
  return enabled.has(network);
}
