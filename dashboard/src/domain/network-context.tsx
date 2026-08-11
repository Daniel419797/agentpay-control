"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type NetworkId = "hedera:testnet" | "hedera:mainnet" | "eip155:5042002";

const NETWORK_STORAGE_KEY = "agentpay:network";

function isNetworkId(value: string | null): value is NetworkId {
  return value === "hedera:testnet" || value === "hedera:mainnet" || value === "eip155:5042002";
}

function getNetworkFromUrl(): NetworkId | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("network");
  return isNetworkId(value) ? value : null;
}

function getNetworkFromStorage(): NetworkId {
  if (typeof window === "undefined") return "hedera:testnet";
  const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
  return isNetworkId(stored) ? stored : "hedera:testnet";
}

function resolveNetwork(): NetworkId {
  return getNetworkFromUrl() ?? getNetworkFromStorage();
}

let snapshot: NetworkId = "hedera:testnet";
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) listener();
}

function persistNetwork(value: NetworkId) {
  snapshot = value;
  localStorage.setItem(NETWORK_STORAGE_KEY, value);
  const url = new URL(window.location.href);
  url.searchParams.set("network", value);
  window.history.replaceState(null, "", url.toString());
  notifyListeners();
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function getSnapshot(): NetworkId {
  return snapshot;
}

function getServerSnapshot(): NetworkId {
  return "hedera:testnet";
}

export type NetworkOption = { id: NetworkId; label: string; testnet: boolean; family: "HEDERA" | "EVM" };

const NetworkContext = createContext<{
  network: NetworkId;
  setNetwork: (value: NetworkId) => void;
  networks: NetworkOption[];
}>({
  network: "hedera:testnet",
  setNetwork: () => {},
  networks: [{ id: "hedera:testnet", label: "Hedera Testnet", testnet: true, family: "HEDERA" }],
});

export function NetworkProvider({ children, mainnetEnabled = true, arcEnabled = false }: { children: ReactNode; mainnetEnabled?: boolean; arcEnabled?: boolean }) {
  const network = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const networks = useMemo<NetworkOption[]>(() => [
    { id: "hedera:testnet", label: "Hedera Testnet", testnet: true, family: "HEDERA" },
    ...(mainnetEnabled ? [{ id: "hedera:mainnet" as const, label: "Hedera Mainnet", testnet: false, family: "HEDERA" as const }] : []),
    ...(arcEnabled ? [{ id: "eip155:5042002" as const, label: "Arc Testnet", testnet: true, family: "EVM" as const }] : []),
  ], [arcEnabled, mainnetEnabled]);

  useEffect(() => {
    const resolved = resolveNetwork();
    const allowed = networks.some((candidate) => candidate.id === resolved) ? resolved : "hedera:testnet";
    if (allowed !== snapshot || allowed !== resolved) persistNetwork(allowed);
  }, [networks]);

  const handleSetNetwork = useCallback((value: NetworkId) => {
    if (!networks.some((candidate) => candidate.id === value)) return;
    persistNetwork(value);
  }, [networks]);

  const activeNetwork = networks.some((candidate) => candidate.id === network) ? network : "hedera:testnet";

  return (
    <NetworkContext.Provider value={{ network: activeNetwork, setNetwork: handleSetNetwork, networks }}>
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
