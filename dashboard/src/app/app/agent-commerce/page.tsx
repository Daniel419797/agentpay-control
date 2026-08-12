"use client";

import { useCallback, useEffect, useState } from "react";

type Purchase = {
  id: string;
  agentId: string;
  resourceListingId?: string | null;
  resourceName?: string | null;
  paymentIntentId?: string | null;
  network: string;
  agentIdentifier: string;
  blockchainIdentifier: string;
  sellerAddress: string;
  paymentType: string;
  state: string;
  workspaceRole: "BUYER" | "SELLER" | "BOTH";
  resultHash?: string | null;
  resultVerifiedAt?: string | null;
  completedAt?: string | null;
  failureCode?: string | null;
  createdAt: string;
  updatedAt: string;
};

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? body?.message ?? `Request failed (${response.status})`);
  return body?.data ?? body;
}

function short(value: string | null | undefined, left = 8, right = 6) {
  if (!value) return "—";
  if (value.length <= left + right + 2) return value;
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function terminal(state: string) {
  return ["Completed", "RefundAuthorized", "Disputed", "FAILED"].includes(state);
}

export default function AgentCommercePage() {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const rows = await jsonRequest("/api/v1/masumi/purchases", { cache: "no-store" });
      setPurchases(Array.isArray(rows) ? rows : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load agent commerce activity.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function action(purchase: Purchase, endpoint: "reconcile" | "refund" | "authorize-refund") {
    setBusy(`${purchase.id}:${endpoint}`);
    setError(null);
    try {
      await jsonRequest(`/api/v1/masumi/purchases/${purchase.id}/${endpoint}`, { method: "POST" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The commerce action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="content-stack">
      <header style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", opacity: .65 }}>Agent-to-agent commerce</span>
        <h1 style={{ margin: 0 }}>Masumi escrow operations</h1>
        <p style={{ margin: 0, maxWidth: 760, opacity: .75 }}>Track policy-controlled agent purchases, independently reconcile provider state, and perform buyer or provider refund actions. Direct x402 and Masumi escrow remain separate settlement paths.</p>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="surface-card" style={{ overflowX: "auto" }}>
        {loading ? <p style={{ padding: 18 }}>Loading commerce activity…</p> : purchases.length === 0 ? (
          <div style={{ padding: 18 }}>
            <strong>No Masumi escrow purchases yet.</strong>
            <p style={{ marginBottom: 0 }}>A scoped agent credential can create one through the Masumi purchase API after its resource identity and policy controls are configured.</p>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Resource</th>
                <th>Role</th>
                <th>Network</th>
                <th>State</th>
                <th>Agent</th>
                <th>Evidence</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((purchase) => {
                const canRefund = ["BUYER", "BOTH"].includes(purchase.workspaceRole) && purchase.state === "ResultSubmitted";
                const canAuthorize = ["SELLER", "BOTH"].includes(purchase.workspaceRole) && purchase.state === "RefundRequested";
                const canReconcile = !terminal(purchase.state);
                return (
                  <tr key={purchase.id}>
                    <td><strong>{purchase.resourceName ?? "Masumi resource"}</strong><br /><span style={{ opacity: .65 }}>{short(purchase.blockchainIdentifier, 10, 8)}</span></td>
                    <td>{purchase.workspaceRole}</td>
                    <td>{purchase.network}</td>
                    <td>{purchase.state}</td>
                    <td title={purchase.agentIdentifier}>{short(purchase.agentIdentifier)}</td>
                    <td>{purchase.resultVerifiedAt ? <span title={purchase.resultHash ?? undefined}>Result verified</span> : purchase.failureCode ? <span title={purchase.failureCode}>Needs review</span> : "Pending"}</td>
                    <td>{new Date(purchase.updatedAt).toLocaleString()}</td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {canReconcile && <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void action(purchase, "reconcile")}>{busy === `${purchase.id}:reconcile` ? "Reconciling…" : "Reconcile"}</button>}
                        {canRefund && <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void action(purchase, "refund")}>{busy === `${purchase.id}:refund` ? "Requesting…" : "Request refund"}</button>}
                        {canAuthorize && <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void action(purchase, "authorize-refund")}>{busy === `${purchase.id}:authorize-refund` ? "Authorizing…" : "Authorize refund"}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
