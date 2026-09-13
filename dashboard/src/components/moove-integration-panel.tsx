"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Summary = {
  configured: boolean;
  keyHint: string | null;
  settlement: { network: string; symbol: string; decimals: number } | null;
  lastValidatedAt: string | null;
  lastReconciledAt: string | null;
};

async function api<T = undefined>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({})) as { data?: T; detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? "Moove could not complete that request.");
  return payload.data as T;
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not yet";
}

export function MooveIntegrationPanel({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null | undefined>(canManage ? undefined : null);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const configured = Boolean(summary?.configured);

  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void api<Summary>("/api/v1/moove/integration", "GET")
      .then((next) => { if (active) setSummary(next); })
      .catch(() => {
        if (!active) return;
        setSummary(null);
        setStatusUnavailable(true);
      });
    return () => { active = false; };
  }, [canManage]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("connect"); setError(""); setMessage("");
    try {
      await api("/api/v1/moove/integration", "POST", { apiKey: String(form.get("apiKey")).trim(), settlement: { network: String(form.get("network")).trim(), symbol: String(form.get("symbol")).trim(), decimals: Number(form.get("decimals")) } });
      event.currentTarget.reset();
      setMessage("Moove is connected. Your API key is encrypted and will not be shown again.");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect Moove."); }
    finally { setBusy(null); }
  }

  async function disconnect() {
    if (!confirm("Disconnect Moove? Active payment links must be completed or inactive first.")) return;
    setBusy("disconnect"); setError(""); setMessage("");
    try { await api("/api/v1/moove/integration", "DELETE"); setMessage("Moove has been disconnected."); router.refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not disconnect Moove."); }
    finally { setBusy(null); }
  }

  return <section className="panel settings-stack" aria-labelledby="moove-heading">
    <div className="panel-header"><div><h2 className="panel-title" id="moove-heading">Moove Receive</h2><p className="panel-description">Create hosted payment links that settle into this organization&apos;s Moove account.</p></div><span className={`status-badge ${configured ? "status-settled" : "status-paused"}`}>{summary === undefined ? "CHECKING" : configured ? "CONNECTED" : "NOT CONNECTED"}</span></div>
    {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="form-success" role="status">{message}</div>}
    {summary === undefined ? <div className="inline-notice" role="status">Checking Moove integration status...</div> : configured && summary ? <div className="detail-grid"><div><span>Credential</span><strong>•••• {summary.keyHint ?? "stored"}</strong></div><div><span>Settlement</span><strong>{summary.settlement ? `${summary.settlement.symbol} / ${summary.settlement.network}` : "Provider default"}</strong></div><div><span>Last validated</span><strong>{formatDate(summary.lastValidatedAt)}</strong></div><div><span>Last reconciliation</span><strong>{formatDate(summary.lastReconciledAt)}</strong></div></div> : <div className="inline-notice">{statusUnavailable ? "Moove setup is unavailable. Apply the latest database migration, then refresh this page." : "Connect the Moove credential for this workspace. It is validated before storage and is never exposed to agents or other organizations."}</div>}
    {canManage && !statusUnavailable && summary !== undefined ? <form className="app-form" onSubmit={connect}><h3 className="panel-title">{configured ? "Replace credential" : "Connect Moove"}</h3><label>Moove API key<input name="apiKey" type="password" autoComplete="off" minLength={16} maxLength={4096} required /></label><div className="form-grid"><label>Settlement network<input name="network" placeholder="eip155:8453" maxLength={120} required /></label><label>Token symbol<input name="symbol" placeholder="USDC" maxLength={32} required /></label></div><label>Token decimals<input name="decimals" type="number" min={0} max={255} defaultValue={6} required /></label><p className="form-help">Changing credentials does not expose the previous key. The settlement identity is checked against payment-link responses.</p><div className="button-row"><button className="primary-button" disabled={Boolean(busy)}>{busy === "connect" ? "Validating..." : configured ? "Replace credential" : "Connect Moove"}</button>{configured && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => void disconnect()}>{busy === "disconnect" ? "Disconnecting..." : "Disconnect"}</button>}</div></form> : !canManage ? <div className="inline-notice">Only an Owner or Provider admin can manage this payment provider. Ask an administrator to connect Moove.</div> : null}
  </section>;
}
