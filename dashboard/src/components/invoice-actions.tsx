"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Action = "send" | "pay" | "void";

export function InvoiceActions({ invoiceId, canSend, canPay, canVoid }: { invoiceId: string; canSend: boolean; canPay: boolean; canVoid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");

  async function perform(action: Action) {
    if (action === "void" && !window.confirm("Void this invoice? This cannot be undone.")) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch(`/api/v1/invoices/${invoiceId}/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(action === "pay" ? { "idempotency-key": crypto.randomUUID() } : {}),
        },
        body: action === "void" ? JSON.stringify({ reason: "Voided by an authorized operator" }) : undefined,
      });
      const payload = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? `Unable to ${action} the invoice.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Unable to ${action} the invoice.`);
    } finally {
      setBusy(null);
    }
  }

  if (!canSend && !canPay && !canVoid) return null;
  return <div>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="panel-actions">
      {canSend && <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void perform("send")}>{busy === "send" ? "Sending…" : "Send invoice"}</button>}
      {canPay && <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void perform("pay")}>{busy === "pay" ? "Submitting…" : "Pay through policy"}</button>}
      {canVoid && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void perform("void")}>{busy === "void" ? "Voiding…" : "Void invoice"}</button>}
    </div>
  </div>;
}
