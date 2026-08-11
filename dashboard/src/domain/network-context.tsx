"use client";

import { createContext, useContext, useCallback, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type NetworkId = "hedera:testnet" | "hedera:mainnet";

const NETWORK_STORAGE_KEY = "agentpay:network";

function getNetworkFromUrl(): NetworkId | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("network");
  if (value === "hedera:testnet" || value === "hedera:mainnet") return value;
  return null;
}

function getNetworkFromStorage(): NetworkId {
  if (typeof window === "undefined") return "hedera:testnet";
  const stored = localStorage.getItem(NETWORK_STORAGE_KEY);
  if (stored === "hedera:testnet" || stored === "hedera:mainnet") return stored;
  return "hedera:testnet";
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

const NetworkContext = createContext<{
  network: NetworkId;
  setNetwork: (value: NetworkId) => void;
  networks: { id: NetworkId; label: string; testnet: boolean }[];
}>({
  network: "hedera:testnet",
  setNetwork: () => {},
  networks: [{ id: "hedera:testnet", label: "Hedera Testnet", testnet: true }],
});

export function NetworkProvider({ children, mainnetEnabled = true }: { children: ReactNode; mainnetEnabled?: boolean }) {
  const network = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const networks = useMemo(() => [
    { id: "hedera:testnet" as const, label: "Hedera Testnet", testnet: true },
    ...(mainnetEnabled ? [{ id: "hedera:mainnet" as const, label: "Hedera Mainnet", testnet: false }] : []),
  ], [mainnetEnabled]);

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
