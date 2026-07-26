"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; label: string };

export function ContractAllowlistForm({ networks }: { networks: Option[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/contract-allowlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          networkId: String(form.get("networkId")),
          contractAddress: String(form.get("contractAddress")).trim(),
          name: String(form.get("name")).trim(),
          allowedFunctionSelectors: String(form.get("selectors")).split(",").map((value) => value.trim()).filter(Boolean),
          maxGas: Number(form.get("maxGas")),
          maxPayableAtomic: String(form.get("maxPayableAtomic")).trim(),
          expectedCodeHash: String(form.get("expectedCodeHash")).trim() || undefined,
        }),
      });
      const payload = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "The contract could not be allowlisted.");
      event.currentTarget.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The contract could not be allowlisted.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel section-gap">
    <div className="panel-header"><div><h2 className="panel-title">Contract allowlist</h2><p className="panel-description">Only exact contracts and four-byte selectors approved here can be used by automation.</p></div></div>
    <form className="app-form operation-form" onSubmit={submit}>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-grid">
        <label>Network<select name="networkId" required>{networks.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Control name<input name="name" minLength={2} maxLength={120} required /></label>
        <label>Contract ID<input name="contractAddress" placeholder="0.0.1234" required /></label>
        <label>Allowed selectors<input name="selectors" placeholder="0xa9059cbb, 0x095ea7b3" required /></label>
        <label>Maximum gas<input name="maxGas" type="number" min={21000} max={15000000} defaultValue={100000} required /></label>
        <label>Maximum payable amount<input name="maxPayableAtomic" pattern="[0-9]+" defaultValue="0" required /></label>
        <label>Expected runtime code hash<input name="expectedCodeHash" pattern="0x[0-9a-fA-F]{64}" placeholder="Optional Keccak-256 0x…" /></label>
      </div>
      <button className="secondary-button" type="submit" disabled={busy || !networks.length}>{busy ? "Saving…" : "Allowlist contract"}</button>
    </form>
  </section>;
}
