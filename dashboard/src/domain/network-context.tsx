"use client";

import { createContext, useContext, useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";

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

function setNetwork(value: NetworkId) {
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
  networks: [
    { id: "hedera:testnet", label: "Hedera Testnet", testnet: true },
    { id: "hedera:mainnet", label: "Hedera Mainnet", testnet: false },
  ],
});

export function NetworkProvider({ children }: { children: ReactNode }) {
  const network = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const resolved = resolveNetwork();
    if (resolved !== snapshot) {
      snapshot = resolved;
      notifyListeners();
    }
  }, []);

  const handleSetNetwork = useCallback((value: NetworkId) => {
    setNetwork(value);
  }, []);

  return (
    <NetworkContext.Provider
      value={{
        network,
        setNetwork: handleSetNetwork,
        networks: [
          { id: "hedera:testnet", label: "Hedera Testnet", testnet: true },
          { id: "hedera:mainnet", label: "Hedera Mainnet", testnet: false },
        ],
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  return useContext(NetworkContext);
}
