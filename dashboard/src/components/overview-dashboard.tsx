"use client";

import Link from "next/link";
import { Bot } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type OverviewData = {
  metrics: {
    settledSpend: Array<{ assetId: string; symbol: string; network: string; amount: string }>;
    activeAgents: number;
    pausedAgents: number;
    pendingApprovals: number;
    activeResources: number;
    trackedPolicies: number;
    highestDailyBudgetUsePercent: number;
    mostConstrainedBudget: { agentId: string; agent: string; symbol: string; network: string; remaining: string; usedPercent: number } | null;
  };
  recent: Array<{
    id: string;
    createdAt: string;
    agent: string;
    payer: string;
    resource: string;
    payee: string;
    amount: string;
    asset: string;
    network: string;
    status: string;
    transactionId: string | null;
    explorerUrl: string | null;
    explorerLabel: string | null;
  }>;
  approvals: Array<{ id: string; agent: string; resource: string; amount: string; asset: string; reason: string }>;
  agents: Array<{ id: string; name: string; status: string; network: string; accountId: string | null }>;
};

function statusClass(status: string) {
  if (status === "SETTLED" || status === "ACTIVE") return "status-settled";
  if (["APPROVAL_PENDING", "PENDING", "PAUSED", "SUBMISSION_UNKNOWN"].includes(status)) return "status-approval";
  return "status-error";
}

function networkLabel(network: string) {
  if (network === "hedera:mainnet") return "Hedera Mainnet";
  if (network === "hedera:testnet") return "Hedera Testnet";
  if (network === "eip155:5042002") return "Arc Testnet";
  return network || "Unknown rail";
}

function AgentAvatar() {
  return <span className="agent-avatar"><Bot size={15} aria-hidden="true" /></span>;
}

export function OverviewDashboard() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/v1/overview", { cache: "no-store" });
    if (!response.ok) { setError("Payment operations could not be loaded."); return; }
    const body = await response.json() as { data: OverviewData };
    setData(body.data);
    setError("");
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    window.addEventListener("agentpay:payment-settled", load);
    return () => window.removeEventListener("agentpay:payment-settled", load);
  }, [load]);

  if (error) return <div className="page"><div className="empty-state"><strong>Unable to load operations</strong><p>{error}</p><button className="secondary-button" onClick={() => void load()}>Retry</button></div></div>;
  if (!data) return <div className="page"><div className="empty-state"><strong>Loading payment operations…</strong><p>Reading current records from the workspace.</p></div></div>;

  const settledSummary = data.metrics.settledSpend.length
    ? data.metrics.settledSpend.slice(0, 2).map((item) => `${item.amount} ${item.symbol}`).join(" · ")
    : "—";
  const constrained = data.metrics.mostConstrainedBudget;

  return (
    <div className="page">
      <div className="page-heading"><div><h1>Overview</h1><p>Live policy-controlled activity across configured x402 payment rails.</p></div></div>
      <section className="metrics" aria-label="Payment metrics">
        <div className="metric"><div className="metric-label">Agent settled spend</div><div className="metric-value">{settledSummary}</div><div className="metric-detail">Confirmed on-chain settlements, grouped by asset</div></div>
        <div className="metric"><div className="metric-label">Highest daily budget use</div><div className="metric-value">{data.metrics.trackedPolicies ? `${data.metrics.highestDailyBudgetUsePercent}%` : "—"}</div><div className="metric-detail">{constrained ? `${constrained.agent}: ${constrained.remaining} ${constrained.symbol} remaining` : "No active published policy"}</div></div>
        <div className="metric"><div className="metric-label">Active agents</div><div className="metric-value">{data.metrics.activeAgents}</div><div className="metric-detail">{data.metrics.pausedAgents} paused</div></div>
        <div className="metric"><div className="metric-label">Pending approvals</div><div className="metric-value metric-alert">{data.metrics.pendingApprovals}</div><div className="metric-detail">{data.metrics.pendingApprovals ? "Awaiting operator review" : "Queue is clear"}</div></div>
        <div className="metric"><div className="metric-label">Active resources</div><div className="metric-value">{data.metrics.activeResources}</div><div className="metric-detail">Organization marketplace listings</div></div>
      </section>
      <div className="operations-grid">
        <section className="panel">
          <header className="panel-header"><h2 className="panel-title">Recent transactions</h2><Link className="ghost-link" href="/app/transactions">View all</Link></header>
          {data.recent.length === 0 ? <div className="empty-state"><strong>No transactions yet</strong><p>Verified wallet payments and x402 agent settlements will appear here.</p></div> : <div className="table-wrap">
            <table className="data-table"><thead><tr><th>Time</th><th>Agent</th><th>Resource / payee</th><th>Amount</th><th>Rail</th><th>Status</th><th>Receipt</th></tr></thead><tbody>{data.recent.map((transaction) => <tr key={transaction.id}>
              <td>{new Date(transaction.createdAt).toLocaleString()}</td>
              <td><div className="agent-cell"><AgentAvatar /><div><div className="cell-primary">{transaction.agent}</div><div className="cell-secondary">{transaction.payer || "Policy workflow"}</div></div></div></td>
              <td><div className="cell-primary">{transaction.resource}</div><div className="cell-secondary">{transaction.payee}</div></td>
              <td>{transaction.amount} {transaction.asset}</td>
              <td><span className="cell-secondary">{networkLabel(transaction.network)}</span></td>
              <td><span className={`status-badge ${statusClass(transaction.status)}`}>{transaction.status.replaceAll("_", " ")}</span></td>
              <td>{transaction.explorerUrl ? <a className="ghost-link" href={transaction.explorerUrl} target="_blank" rel="noreferrer">{transaction.explorerLabel ?? "Explorer"}</a> : <span className="cell-secondary">Pending</span>}</td>
            </tr>)}</tbody></table>
          </div>}
        </section>
        <div className="right-rail">
          <section className="panel">
            <header className="panel-header"><h2 className="panel-title">Pending approvals</h2><Link className="ghost-link" href="/app/approvals">View all</Link></header>
            {data.approvals.length === 0 ? <div className="empty-state"><strong>Queue is clear</strong><p>No payments are awaiting approval.</p></div> : <div className="record-list">{data.approvals.map((approval) => <Link className="record-row" href={`/app/approvals/${approval.id}`} key={approval.id}><div><div className="record-title">{approval.resource}</div><div className="record-subtitle">{approval.agent} · {approval.reason}</div></div><div className="record-aside"><span className="record-meta">{approval.amount} {approval.asset}</span></div></Link>)}</div>}
          </section>
          <section className="panel" style={{ marginTop: 18 }}>
            <header className="panel-header"><h2 className="panel-title">Agents</h2><Link className="ghost-link" href="/app/agents">View all</Link></header>
            {data.agents.length === 0 ? <div className="empty-state"><strong>No agents yet</strong><p>Create an agent on one of the configured payment rails.</p></div> : <div className="agent-list">{data.agents.map((agent) => <div className="agent-row" key={agent.id}><div className="agent-identity"><AgentAvatar /><div><div className="agent-name">{agent.name}</div><div className="agent-state"><span className="status-dot" />{agent.status} · {networkLabel(agent.network)}</div></div></div><div className="agent-balance"><small>{agent.accountId ?? "No account"}</small></div></div>)}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
