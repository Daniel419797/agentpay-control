"use client";

import { useState } from "react";
import { useNetwork } from "@/domain/network-context";
import { FormPage } from "@/components/workspace-page";

export default function NewAgentPage() {
  const { network } = useNetwork();

  const [custody, setCustody] = useState("PLATFORM_MANAGED_TESTNET");

  return (
    <FormPage
      title="Create agent"
      description="Create a policy-controlled payment identity with managed automation or wallet confirmation."
    >
      <form className="app-form" action="/api/v1/agents" method="post">
        <label>Name<input name="name" required placeholder="Research assistant" /></label>
        <label>Description<textarea name="description" placeholder="What this agent is allowed to purchase" /></label>
        <label>
          Network
          <select name="network" defaultValue={network}>
            <option value="hedera:testnet">Hedera Testnet</option>
            <option value="hedera:mainnet">Hedera Mainnet</option>
          </select>
        </label>
        <label>
          Custody
          <select name="custody" value={custody} onChange={(e) => setCustody(e.target.value)}>
            <option value="PLATFORM_MANAGED_TESTNET">Managed testnet signer · autonomous</option>
            <option value="SELF_CUSTODY">Connected HashPack · confirmation required</option>
          </select>
        </label>
        <label>Default asset<select name="asset"><option>HBAR</option><option>USDC</option></select></label>
        <p className="form-help">
          Managed agents share the isolated facilitator treasury while policies and reservations maintain per-agent spending boundaries. Private keys never enter the dashboard.
        </p>
        <button className="primary-button" type="submit">Create agent</button>
      </form>
    </FormPage>
  );
}
