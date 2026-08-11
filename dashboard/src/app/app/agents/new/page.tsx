"use client";

import { useEffect, useState } from "react";
import { useNetwork, type NetworkId } from "@/domain/network-context";
import { FormPage } from "@/components/workspace-page";

export default function NewAgentPage() {
  const { network, setNetwork, networks } = useNetwork();
  const [custody, setCustody] = useState("PLATFORM_MANAGED_TESTNET");
  const [asset, setAsset] = useState("HBAR");

  useEffect(() => {
    if (network === "eip155:5042002") {
      setCustody("PLATFORM_MANAGED_TESTNET");
      setAsset("USDC");
    } else if (network === "hedera:mainnet") {
      setCustody("SELF_CUSTODY");
    }
  }, [network]);

  const handleNetwork = (value: NetworkId) => {
    setNetwork(value);
    if (value === "eip155:5042002") {
      setCustody("PLATFORM_MANAGED_TESTNET");
      setAsset("USDC");
    } else if (value === "hedera:mainnet") {
      setCustody("SELF_CUSTODY");
    }
  };

  return (
    <FormPage
      title="Create agent"
      description="Create a policy-controlled payment identity with a signer appropriate to the selected rail."
    >
      <form className="app-form" action="/api/v1/agents" method="post">
        <label>Name<input name="name" required placeholder="Research assistant" /></label>
        <label>Description<textarea name="description" placeholder="What this agent is allowed to purchase" /></label>
        <label>
          Network
          <select name="network" value={network} onChange={(event) => handleNetwork(event.target.value as NetworkId)}>
            {networks.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        </label>
        <label>
          Custody
          <select name="custody" value={custody} onChange={(event) => setCustody(event.target.value)}>
            {network === "hedera:testnet" && <option value="PLATFORM_MANAGED_TESTNET">Managed testnet signer · autonomous</option>}
            {network === "eip155:5042002" && <option value="PLATFORM_MANAGED_TESTNET">Managed Arc signer · autonomous</option>}
            {network !== "eip155:5042002" && <option value="SELF_CUSTODY">Connected HashPack · confirmation required</option>}
          </select>
        </label>
        <label>
          Default asset
          <select name="asset" value={asset} onChange={(event) => setAsset(event.target.value)}>
            {network !== "eip155:5042002" && <option value="HBAR">HBAR</option>}
            <option value="USDC">USDC</option>
          </select>
        </label>
        <p className="form-help">
          {network === "eip155:5042002"
            ? "Arc testnet agents use the isolated managed facilitator and USDC rail. The Arc private key remains outside the dashboard."
            : network === "hedera:mainnet"
              ? "Hedera mainnet agents require a verified connected wallet; platform-managed custody is intentionally disabled for real-value mainnet accounts."
              : "Managed testnet agents share the isolated facilitator treasury while policies and reservations maintain per-agent spending boundaries. Private keys never enter the dashboard."}
        </p>
        <button className="primary-button" type="submit">Create agent</button>
      </form>
    </FormPage>
  );
}
