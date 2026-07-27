"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useNetwork } from "@/domain/network-context";

export function NetworkSwitcher({ compact }: { compact?: boolean }) {
  const { network, setNetwork, networks } = useNetwork();
  const [open, setOpen] = useState(false);
  const current = networks.find((n) => n.id === network) ?? networks[0];

  return (
    <div className={`network-switcher${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="network-switcher-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className={`network-dot${current.testnet ? " testnet" : " mainnet"}`} />
        <span>{current.label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <div className="network-switcher-scrim" onClick={() => setOpen(false)} />
          <div className="network-switcher-dropdown">
            {networks.map((n) => (
              <button
                key={n.id}
                type="button"
                className={`network-option${n.id === network ? " active" : ""}`}
                onClick={() => { setNetwork(n.id); setOpen(false); }}
              >
                <span className={`network-dot${n.testnet ? " testnet" : " mainnet"}`} />
                <span>{n.label}</span>
                {n.id === network && <span className="network-check">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
