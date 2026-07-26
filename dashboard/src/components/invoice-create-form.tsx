"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; label: string };

export function InvoiceCreateForm({ issuerAgents, assets }: { issuerAgents: Option[]; assets: Option[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/v1/invoices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          issuerAgentId: String(form.get("issuerAgentId")),
          recipientAgentId: String(form.get("recipientAgentId")).trim(),
          assetId: String(form.get("assetId")),
          title: String(form.get("title")).trim(),
          memo: String(form.get("memo")).trim() || undefined,
          dueAt: new Date(String(form.get("dueAt"))).toISOString(),
          items: [{
            description: String(form.get("description")).trim(),
            quantity: Number(form.get("quantity")),
            unitAmountAtomic: String(form.get("unitAmountAtomic")).trim(),
          }],
        }),
      });
      const payload = await response.json() as { data?: { id: string }; detail?: string };
      if (!response.ok || !payload.data) throw new Error(payload.detail ?? "The invoice could not be created.");
      router.push(`/app/invoices/${payload.data.id}` as Route);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The invoice could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="app-form" onSubmit={submit}>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-grid">
      <label>Issuer agent<select name="issuerAgentId" required>{issuerAgents.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label>Recipient agent ID<input name="recipientAgentId" type="text" placeholder="Partner agent UUID" required /></label>
      <label>Settlement asset<select name="assetId" required>{assets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
      <label>Due date<input name="dueAt" type="datetime-local" required /></label>
    </div>
    <label>Invoice title<input name="title" type="text" minLength={3} maxLength={140} required /></label>
    <label>Memo<textarea name="memo" rows={3} maxLength={2000} /></label>
    <div className="form-grid">
      <label>Line item<input name="description" type="text" minLength={2} maxLength={500} required /></label>
      <label>Quantity<input name="quantity" type="number" min={1} max={1_000_000} defaultValue={1} required /></label>
      <label>Unit amount (atomic)<input name="unitAmountAtomic" inputMode="numeric" pattern="[0-9]+" required /></label>
    </div>
    <p className="form-help">Use the recipient agent UUID shared by the partner organization. The invoice remains a draft until you review and send it.</p>
    <button className="primary-button" type="submit" disabled={busy || !issuerAgents.length || !assets.length}>{busy ? "Creating…" : "Create draft invoice"}</button>
  </form>;
}
