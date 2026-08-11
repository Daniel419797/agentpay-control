"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AgentNetwork = "hedera:testnet" | "hedera:mainnet" | "eip155:5042002";
type Custody = "PLATFORM_MANAGED_TESTNET" | "SELF_CUSTODY";

export function CreateAgentForm({ mainnetEnabled, arcEnabled }: { mainnetEnabled: boolean; arcEnabled: boolean }) {
  const router = useRouter();
  const [network, setNetwork] = useState<AgentNetwork>("hedera:testnet");
  const [custody, setCustody] = useState<Custody>("PLATFORM_MANAGED_TESTNET");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selfCustody = custody === "SELF_CUSTODY";

  function changeNetwork(value: AgentNetwork) {
    setNetwork(value);
    setCustody(value === "hedera:mainnet" ? "SELF_CUSTODY" : value === "eip155:5042002" ? "PLATFORM_MANAGED_TESTNET" : "PLATFORM_MANAGED_TESTNET");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: String(form.get("name")).trim(),
          description: String(form.get("description")).trim() || undefined,
          network,
          custodyType: custody,
          ...(selfCustody && String(form.get("accountId")).trim() ? { accountId: String(form.get("accountId")).trim() } : {}),
          ...(String(form.get("publicKey")).trim() ? { publicKey: String(form.get("publicKey")).trim() } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { data?: { id?: string }; detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "The agent could not be created.");
      router.push(payload.data?.id ? `/app/agents/${payload.data.id}` : "/app/agents");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The agent could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="app-form" onSubmit={submit}>
    {error && <div className="form-error" role="alert">{error}</div>}
    <label>Agent name<input name="name" required minLength={2} maxLength={80} placeholder="Treasury research agent" /></label>
    <label>Description<textarea name="description" maxLength={500} rows={4} placeholder="What this agent is permitted to do" /></label>
    <label>Payment rail<select name="network" value={network} onChange={(event) => changeNetwork(event.target.value as AgentNetwork)}><option value="hedera:testnet">Hedera Testnet</option>{mainnetEnabled && <option value="hedera:mainnet">Hedera Mainnet</option>}{arcEnabled && <option value="eip155:5042002">Arc Testnet</option>}</select></label>
    <label>Custody<select name="custodyType" value={custody} onChange={(event) => setCustody(event.target.value as Custody)} disabled={network !== "hedera:testnet"}>{network === "hedera:mainnet" ? <option value="SELF_CUSTODY">Self-custody wallet confirmation</option> : network === "eip155:5042002" ? <option value="PLATFORM_MANAGED_TESTNET">Managed testnet signer</option> : <><option value="PLATFORM_MANAGED_TESTNET">Managed testnet signer</option><option value="SELF_CUSTODY">Self-custody wallet confirmation</option></>}</select></label>
    {selfCustody && <><label>Verified account ID <span className="optional">optional</span><input name="accountId" placeholder="0.0.12345" pattern="0\.0\.\d+" /></label><p className="form-help">If supplied, the account must match a wallet identity you already verified for this network. Leave it blank to use your most recently verified identity.</p></>}
    {!selfCustody && network === "hedera:testnet" && <p className="form-help">The account is assigned from the isolated managed payer configured for the testnet facilitator. The dashboard never receives its private key.</p>}
    {network === "hedera:mainnet" && <p className="form-help">Mainnet agents require explicit wallet confirmation for payments. Managed testnet custody is never reused on mainnet.</p>}
    {network === "eip155:5042002" && <p className="form-help">Arc Testnet agents use the isolated managed EVM signer configured for this deployment and the verified configured USDC asset.</p>}
    <label>Public key <span className="optional">optional</span><input name="publicKey" placeholder="Public key metadata" minLength={20} maxLength={200} /></label>
    <p className="form-help">Provisioning a payment agent requires recent authentication and is blocked while the organization emergency stop is active.</p>
    <button className="primary-button" type="submit" disabled={busy}>{busy ? "Creating…" : "Create agent"}</button>
  </form>;
}
