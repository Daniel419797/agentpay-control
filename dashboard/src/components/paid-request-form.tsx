"use client";

import Link from "next/link";
import { useState } from "react";

type Agent = { id: string; name: string; status: string };
type Resource = { url: string; label: string };

const PRESET_RESOURCES: Resource[] = [
  { url: "http://localhost:3200/v1/market-data/eth", label: "ETH Market Data" },
  { url: "http://localhost:3200/v1/market-data/btc", label: "BTC Market Data" },
  { url: "http://localhost:3200/v1/market-data/sol", label: "SOL Market Data" },
  { url: "http://localhost:3200/v1/market-data/link", label: "LINK Market Data" },
  { url: "http://localhost:3200/v1/files/q2-report", label: "Q2 Financial Report" },
  { url: "http://localhost:3200/v1/files/whitepaper", label: "Whitepaper" },
  { url: "http://localhost:3200/v1/inference/llama-3.2", label: "LLaMA 3.2 Inference" },
  { url: "http://localhost:3200/v1/research", label: "Web Research" },
];

type Result = {
  id: string;
  status: string;
  resourceUrl: string;
  transactionId?: string | null;
  hashscanUrl?: string | null;
  amount?: string;
  asset?: string;
  error?: string;
};

export function PaidRequestForm({ agents, defaultAgentId }: { agents: Agent[]; defaultAgentId?: string }) {
  const [agentId, setAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? "");
  const [resourceUrl, setResourceUrl] = useState(PRESET_RESOURCES[0].url);
  const [customUrl, setCustomUrl] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  const activeAgent = agents.find((a) => a.id === agentId);
  const isPaused = activeAgent?.status === "PAUSED";

  async function submit() {
    const url = useCustom ? customUrl : resourceUrl;
    if (!agentId || !url) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch(`/api/v1/agents/${agentId}/paid-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ resourceUrl: url, purpose: purpose || undefined }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error?.message ?? `Request failed (${response.status})`);
        return;
      }
      const data = body.data;
      setResult({
        id: data.id,
        status: data.status,
        resourceUrl: url,
        transactionId: data.attempts?.[0]?.settlement?.transactionId ?? null,
        hashscanUrl: data.attempts?.[0]?.settlement?.transactionId
          ? `https://hashscan.io/testnet/transaction/${data.attempts[0].settlement.transactionId}`
          : null,
        amount: data.quote?.amountAtomic ? `${(Number(data.quote.amountAtomic) / Math.pow(10, data.quote.asset?.decimals ?? 8)).toFixed(4)} ${data.quote.asset?.symbol ?? ""}` : undefined,
      });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function statusColor(status: string) {
    if (status === "SETTLED") return "status-settled";
    if (status === "APPROVAL_PENDING" || status === "PENDING") return "status-approval";
    if (status === "DENIED" || status === "FAILED_BEFORE_SUBMISSION") return "status-error";
    return "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Agent</label>
        <select className="form-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.status})</option>
          ))}
        </select>
        {isPaused && <div className="form-error" style={{ marginTop: 4 }}>Agent is paused. Resume it before sending requests.</div>}
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Resource</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <input type="radio" checked={!useCustom} onChange={() => setUseCustom(false)} /> Preset
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
            <input type="radio" checked={useCustom} onChange={() => setUseCustom(true)} /> Custom URL
          </label>
        </div>
        {useCustom ? (
          <input className="form-input" value={customUrl} onChange={(e) => setCustomUrl(e.target.value)} placeholder="http://localhost:3200/v1/market-data/eth" />
        ) : (
          <select className="form-input" value={resourceUrl} onChange={(e) => setResourceUrl(e.target.value)}>
            {PRESET_RESOURCES.map((r) => (
              <option key={r.url} value={r.url}>{r.label}</option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Purpose (optional)</label>
        <input className="form-input" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Daily market analysis" />
      </div>

      {error && <div className="form-error">{error}</div>}

      <div className="button-row">
        <button className="primary-button" disabled={loading || !agentId || isPaused || (!useCustom && !resourceUrl) || (useCustom && !customUrl)} onClick={() => void submit()}>
          {loading ? "Sending…" : "Send paid request"}
        </button>
      </div>

      {result && (
        <div className="panel" style={{ borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Result</div>
          <div className="detail-grid">
            <div><span>Status</span><strong><span className={`status-badge ${statusColor(result.status)}`}>{result.status.replaceAll("_", " ")}</span></strong></div>
            <div><span>Resource</span><strong style={{ fontSize: 13 }}>{result.resourceUrl}</strong></div>
            {result.amount && <div><span>Amount</span><strong>{result.amount}</strong></div>}
            {result.transactionId && <div><span>Transaction</span><strong style={{ fontFamily: "monospace", fontSize: 12 }}>{result.transactionId}</strong></div>}
          </div>
          <div className="button-row" style={{ marginTop: 12 }}>
            <Link className="secondary-button" href="/app/transactions">View all transactions</Link>
            {result.hashscanUrl && <a className="secondary-button" href={result.hashscanUrl} target="_blank" rel="noreferrer">Open HashScan</a>}
          </div>
        </div>
      )}
    </div>
  );
}
