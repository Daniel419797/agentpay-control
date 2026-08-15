"use client";

import { useEffect, useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useNetwork } from "@/domain/network-context";

export function NetworkSwitcher({ compact }: { compact?: boolean }) {
  const { network, setNetwork, networks } = useNetwork();
  const [open, setOpen] = useState(false);
  const switcherId = useId();
  const current = networks.find((n) => n.id === network) ?? networks[0];

  useEffect(() => {
    function closeWhenAnotherSwitcherOpens(event: Event) {
      if ((event as CustomEvent<string>).detail !== switcherId) setOpen(false);
    }

    window.addEventListener("agentpay:network-switcher-open", closeWhenAnotherSwitcherOpens);
    return () => window.removeEventListener("agentpay:network-switcher-open", closeWhenAnotherSwitcherOpens);
  }, [switcherId]);

  function toggleMenu() {
    if (!open) window.dispatchEvent(new CustomEvent("agentpay:network-switcher-open", { detail: switcherId }));
    setOpen(!open);
  }

  return (
    <div className={`network-switcher${compact ? " compact" : ""}`}>
      <button
        type="button"
        className="network-switcher-trigger"
        onClick={toggleMenu}
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
