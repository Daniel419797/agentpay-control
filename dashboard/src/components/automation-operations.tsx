"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; label: string };
type TriggerType = "MANUAL" | "SCHEDULE" | "BALANCE_THRESHOLD" | "INVOICE_EVENT" | "WEBHOOK";
type ActionType = "X402_PAYMENT" | "CONTRACT_CALL" | "CREATE_INVOICE";

export function AutomationOperations({ agents, assets, contracts }: { agents: Option[]; assets: Option[]; contracts: Option[] }) {
  const router = useRouter();
  const [triggerType, setTriggerType] = useState<TriggerType>("MANUAL");
  const [actionType, setActionType] = useState<ActionType>("X402_PAYMENT");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setWebhookSecret("");
    const form = new FormData(event.currentTarget);
    const trigger = triggerType === "SCHEDULE"
      ? { type: triggerType, intervalMinutes: Number(form.get("intervalMinutes")) }
      : triggerType === "BALANCE_THRESHOLD"
        ? { type: triggerType, assetId: String(form.get("thresholdAssetId")), comparison: String(form.get("comparison")), amountAtomic: String(form.get("thresholdAmount")) }
        : triggerType === "INVOICE_EVENT"
          ? { type: triggerType, status: String(form.get("invoiceStatus")) }
          : { type: triggerType };
    const action = actionType === "X402_PAYMENT"
      ? { resourceUrl: String(form.get("resourceUrl")).trim(), maxAmountAtomic: String(form.get("maxAmountAtomic")).trim() || undefined, purpose: String(form.get("purpose")).trim() || undefined }
      : actionType === "CONTRACT_CALL"
        ? { allowlistEntryId: String(form.get("allowlistEntryId")), functionSelector: String(form.get("functionSelector")).trim(), calldata: String(form.get("calldata")).trim(), gas: Number(form.get("gas")), payableAtomic: String(form.get("payableAtomic")).trim() }
        : { recipientAgentId: String(form.get("recipientAgentId")).trim(), assetId: String(form.get("invoiceAssetId")), title: String(form.get("invoiceTitle")).trim(), memo: String(form.get("invoiceMemo")).trim() || undefined, dueInHours: Number(form.get("dueInHours")), items: [{ description: String(form.get("itemDescription")).trim(), quantity: Number(form.get("itemQuantity")), unitAmountAtomic: String(form.get("itemAmount")).trim() }] };
    try {
      const response = await fetch("/api/v1/automations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agentId: String(form.get("agentId")),
          name: String(form.get("name")).trim(),
          description: String(form.get("description")).trim() || undefined,
          trigger,
          actionType,
          action,
          approvalThreshold: Number(form.get("approvalThreshold")),
          maxExecutionsPerDay: Number(form.get("maxExecutionsPerDay")),
        }),
      });
      const payload = await response.json() as { data?: { webhookSecret?: string }; detail?: string };
      if (!response.ok || !payload.data) throw new Error(payload.detail ?? "The automation could not be created.");
      if (payload.data.webhookSecret) setWebhookSecret(payload.data.webhookSecret);
      event.currentTarget.reset();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The automation could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel section-gap">
    <div className="panel-header"><div><h2 className="panel-title">Create guarded automation</h2><p className="panel-description">New rules start as drafts. An owner must activate them after reviewing trigger, action, limits, and approvals.</p></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {webhookSecret && <div className="one-time-secret" role="status"><strong>Copy the webhook secret now</strong><code>{webhookSecret}</code><span>It will not be shown again.</span></div>}
    <form className="app-form operation-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Rule name<input name="name" minLength={2} maxLength={120} required /></label>
        <label>Agent<select name="agentId" required>{agents.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Trigger<select value={triggerType} onChange={(event) => setTriggerType(event.target.value as TriggerType)}><option value="MANUAL">Manual</option><option value="SCHEDULE">Schedule</option><option value="BALANCE_THRESHOLD">Balance threshold</option><option value="INVOICE_EVENT">Invoice event</option><option value="WEBHOOK">Signed webhook</option></select></label>
        <label>Action<select value={actionType} onChange={(event) => setActionType(event.target.value as ActionType)}><option value="X402_PAYMENT">x402 payment</option><option value="CREATE_INVOICE">Create invoice</option><option value="CONTRACT_CALL">Allowlisted contract call</option></select></label>
        <label>Approvals required<input name="approvalThreshold" type="number" min={0} max={20} defaultValue={1} required /></label>
        <label>Daily execution cap<input name="maxExecutionsPerDay" type="number" min={1} max={1000} defaultValue={24} required /></label>
      </div>
      <label>Description<textarea name="description" rows={2} maxLength={1000} /></label>
      {triggerType === "SCHEDULE" && <label>Run every (minutes)<input name="intervalMinutes" type="number" min={1} max={10080} defaultValue={60} required /></label>}
      {triggerType === "BALANCE_THRESHOLD" && <div className="form-grid"><label>Asset<select name="thresholdAssetId" required>{assets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>Comparison<select name="comparison"><option value="BELOW">Below</option><option value="ABOVE">Above</option></select></label><label>Threshold (atomic)<input name="thresholdAmount" pattern="[0-9]+" required /></label></div>}
      {triggerType === "INVOICE_EVENT" && <label>Invoice status<select name="invoiceStatus"><option value="SENT">Sent</option><option value="PAID">Paid</option><option value="OVERDUE">Overdue</option></select></label>}
      {actionType === "X402_PAYMENT" && <div className="form-grid"><label>Resource URL<input name="resourceUrl" type="url" required /></label><label>Maximum amount (atomic)<input name="maxAmountAtomic" pattern="[0-9]*" /></label><label>Purpose<input name="purpose" maxLength={300} /></label></div>}
      {actionType === "CONTRACT_CALL" && <div className="form-grid"><label>Allowlisted contract<select name="allowlistEntryId" required>{contracts.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>Function selector<input name="functionSelector" pattern="0x[0-9a-fA-F]{8}" required /></label><label>Calldata<input name="calldata" pattern="0x[0-9a-fA-F]*" required /></label><label>Gas<input name="gas" type="number" min={21000} max={15000000} defaultValue={100000} required /></label><label>Payable amount (tinybar)<input name="payableAtomic" pattern="[0-9]+" defaultValue="0" required /></label></div>}
      {actionType === "CREATE_INVOICE" && <div className="form-grid"><label>Recipient agent ID<input name="recipientAgentId" required /></label><label>Asset<select name="invoiceAssetId" required>{assets.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>Title<input name="invoiceTitle" minLength={3} maxLength={140} required /></label><label>Due in hours<input name="dueInHours" type="number" min={1} max={8760} defaultValue={72} required /></label><label>Line item<input name="itemDescription" minLength={2} maxLength={500} required /></label><label>Quantity<input name="itemQuantity" type="number" min={1} defaultValue={1} required /></label><label>Unit amount (atomic)<input name="itemAmount" pattern="[0-9]+" required /></label><label>Memo<input name="invoiceMemo" maxLength={2000} /></label></div>}
      <button className="primary-button" type="submit" disabled={busy || !agents.length || (actionType === "CONTRACT_CALL" && !contracts.length)}>{busy ? "Creating…" : "Create draft rule"}</button>
    </form>
  </section>;
}
