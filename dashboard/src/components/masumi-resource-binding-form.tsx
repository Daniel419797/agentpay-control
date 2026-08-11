"use client";

import { useEffect, useState } from "react";

type Network = "Preprod" | "Mainnet";
type DiscoveryEntry = {
  agentIdentifier: string;
  name: string;
  description: string | null;
  status: string;
  apiBaseUrl: string;
  paymentType: string | null;
  capability: { name: string; version: string | null } | null;
  tags: string[];
  registryPolicyId: string;
};
type Binding = {
  network: Network;
  agentIdentifier: string;
  registryPolicyId: string;
  apiBaseUrl: string;
  capabilityName: string | null;
  capabilityVersion: string | null;
  settlementAddress: string | null;
  paymentType: string | null;
  metadataHash: string;
  verifiedAt: string;
  expiresAt: string;
};

type Props = { resourceId: string; defaultNetwork?: Network };

export function MasumiResourceBindingForm({ resourceId, defaultNetwork = "Preprod" }: Props) {
  const [network, setNetwork] = useState<Network>(defaultNetwork);
  const [capability, setCapability] = useState("");
  const [agentIdentifier, setAgentIdentifier] = useState("");
  const [results, setResults] = useState<DiscoveryEntry[]>([]);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`/api/v1/resources/${resourceId}/masumi-binding`, { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { data?: { binding?: Binding | null } }) => {
        const current = payload.data?.binding ?? null;
        setBinding(current);
        if (current?.network) setNetwork(current.network);
        if (current?.agentIdentifier) setAgentIdentifier(current.agentIdentifier);
      })
      .catch(() => setError("The current Masumi binding could not be loaded."));
  }, [resourceId]);

  async function discover() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const params = new URLSearchParams({ network, limit: "20" });
      if (capability.trim()) params.set("capability", capability.trim());
      const response = await fetch(`/api/v1/masumi/agents?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as { data?: DiscoveryEntry[]; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "Masumi discovery failed.");
      setResults(payload.data ?? []);
      if (!(payload.data ?? []).length) setMessage("No online Masumi agents matched this discovery query.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Masumi discovery failed.");
    } finally {
      setBusy(false);
    }
  }

  async function bind(identifier = agentIdentifier) {
    const target = identifier.trim();
    if (!target) {
      setError("Enter or select a Masumi agent identifier.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/resources/${resourceId}/masumi-binding`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentIdentifier: target,
          network,
          maxRegistryAgeSeconds: 120,
          allowedCapabilities: capability.trim() ? [capability.trim()] : [],
        }),
      });
      const payload = await response.json().catch(() => ({})) as { data?: { binding?: Binding }; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "The Masumi seller identity could not be verified.");
      const verified = payload.data?.binding;
      if (!verified) throw new Error("The binding response did not contain verified identity evidence.");
      setBinding(verified);
      setAgentIdentifier(verified.agentIdentifier);
      setMessage("Masumi identity, API endpoint and seller wallet verified and bound to this resource.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Masumi seller identity could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  async function removeBinding() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/v1/resources/${resourceId}/masumi-binding`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "The Masumi binding could not be removed.");
      setBinding(null);
      setAgentIdentifier("");
      setMessage("Masumi settlement binding removed.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Masumi binding could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="workspace-section">
    <div className="section-heading">
      <div>
        <h3>Masumi seller identity</h3>
        <p>Discover a registered agent, then verify its registry metadata and seller wallet before AgentPay may use it as an x402 payee.</p>
      </div>
    </div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}

    {binding && <div className="detail-grid">
      <div><span>Identity</span><strong>{binding.agentIdentifier}</strong></div>
      <div><span>Network</span><strong>{binding.network}</strong></div>
      <div><span>Seller wallet</span><strong>{binding.settlementAddress ?? "Unavailable"}</strong></div>
      <div><span>Capability</span><strong>{binding.capabilityName ?? "Unspecified"}</strong></div>
      <div><span>Payment type</span><strong>{binding.paymentType ?? "Unspecified"}</strong></div>
      <div><span>Verified until</span><strong>{new Date(binding.expiresAt).toLocaleString()}</strong></div>
      <div><span>Registry policy</span><strong>{binding.registryPolicyId}</strong></div>
      <div><span>Evidence hash</span><strong>{binding.metadataHash}</strong></div>
    </div>}

    <div className="app-form">
      <div className="form-grid">
        <label>Masumi network<select value={network} onChange={(event) => setNetwork(event.target.value as Network)} disabled={busy}><option value="Preprod">Preprod</option><option value="Mainnet">Mainnet</option></select></label>
        <label>Capability filter<input value={capability} onChange={(event) => setCapability(event.target.value)} placeholder="web-research" disabled={busy} /></label>
        <label>Agent identifier<input value={agentIdentifier} onChange={(event) => setAgentIdentifier(event.target.value)} placeholder="Masumi asset identifier" disabled={busy} /></label>
      </div>
      <div className="button-row">
        <button className="secondary-button" type="button" onClick={discover} disabled={busy}>{busy ? "Checking…" : "Discover online agents"}</button>
        <button className="primary-button" type="button" onClick={() => bind()} disabled={busy || !agentIdentifier.trim()}>Verify & bind identity</button>
        {binding && <button className="secondary-button" type="button" onClick={removeBinding} disabled={busy}>Remove binding</button>}
      </div>
    </div>

    {results.length > 0 && <div className="data-table-wrap">
      <table className="data-table">
        <thead><tr><th>Agent</th><th>Capability</th><th>Payment</th><th>Registry status</th><th /></tr></thead>
        <tbody>{results.map((entry) => <tr key={entry.agentIdentifier}>
          <td><strong>{entry.name}</strong><small>{entry.description ?? entry.apiBaseUrl}</small></td>
          <td>{entry.capability?.name ?? "—"}</td>
          <td>{entry.paymentType ?? "—"}</td>
          <td>{entry.status}</td>
          <td><button className="table-action" type="button" onClick={() => { setAgentIdentifier(entry.agentIdentifier); void bind(entry.agentIdentifier); }} disabled={busy}>Bind</button></td>
        </tr>)}</tbody>
      </table>
    </div>}
    <p className="form-help">Binding requires recent authentication. AgentPay re-resolves Masumi payment information before policy-controlled settlement; cached discovery results are never trusted as the seller wallet.</p>
  </section>;
}