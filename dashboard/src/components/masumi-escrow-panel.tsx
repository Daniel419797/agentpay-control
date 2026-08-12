"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Agent = { id: string; name: string; status: string; network: string };
type Resource = {
  id: string;
  name: string;
  endpoint: string;
  status: string;
  provider?: { name?: string };
  prices?: Array<{ atomicAmount: string; asset?: { network?: string; symbol?: string; decimals?: number } }>;
};
type Purchase = {
  id: string;
  agentId: string;
  resourceListingId?: string | null;
  paymentIntentId?: string | null;
  network: "Preprod" | "Mainnet" | string;
  agentIdentifier: string;
  blockchainIdentifier: string;
  state: string;
  providerState?: string | null;
  amounts?: unknown;
  resultHash?: string | null;
  resultVerifiedAt?: string | null;
  refundRequestedAt?: string | null;
  refundAuthorizedAt?: string | null;
  disputedAt?: string | null;
  completedAt?: string | null;
  lastReconciledAt?: string | null;
  failureCode?: string | null;
  createdAt: string;
  workspaceRole?: "BUYER" | "SELLER" | "BOTH" | string;
  resourceName?: string | null;
};
type Envelope<T> = { data?: T; detail?: string };

type Props = {
  agents: Agent[];
  defaultAgentId?: string;
  canOperate: boolean;
  canAuthorizeRefund: boolean;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok) throw new Error(body.detail ?? `Request failed (${response.status}).`);
  return body.data as T;
}

function statusClass(state: string) {
  if (state === "Completed") return "status-settled";
  if (["FAILED", "Disputed"].includes(state)) return "status-error";
  if (["RefundRequested", "RefundAuthorized", "FundsLockingRequested", "FundsLocked", "ResultSubmitted", "SUBMISSION_UNKNOWN", "PREPARED"].includes(state)) return "status-approval";
  return "";
}

export function MasumiEscrowPanel({ agents, defaultAgentId, canOperate, canAuthorizeRefund }: Props) {
  const cardanoAgents = useMemo(() => agents.filter((agent) => agent.network === "cardano:preprod" || agent.network === "cardano:mainnet"), [agents]);
  const [agentId, setAgentId] = useState(defaultAgentId && cardanoAgents.some((agent) => agent.id === defaultAgentId) ? defaultAgentId : cardanoAgents[0]?.id ?? "");
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [inputJson, setInputJson] = useState("{}");
  const [purpose, setPurpose] = useState("");
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const retryKey = useRef<string | null>(null);

  const agent = cardanoAgents.find((candidate) => candidate.id === agentId);
  const compatibleResources = useMemo(() => resources.filter((resource) => resource.status === "ACTIVE" && resource.prices?.some((price) => price.asset?.network === agent?.network)), [resources, agent?.network]);

  async function refreshPurchases() {
    try { setPurchases(await api<Purchase[]>("/api/v1/masumi/purchases")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load Masumi escrow purchases."); }
  }

  useEffect(() => {
    void Promise.all([
      api<Resource[]>("/api/v1/resources").then(setResources),
      api<Purchase[]>("/api/v1/masumi/purchases").then(setPurchases),
    ]).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load Masumi escrow data."));
  }, []);

  useEffect(() => {
    if (!compatibleResources.some((resource) => resource.id === resourceId)) setResourceId(compatibleResources[0]?.id ?? "");
  }, [compatibleResources, resourceId]);

  async function createPurchase() {
    if (!agentId || !resourceId) return;
    let inputData: unknown;
    try { inputData = JSON.parse(inputJson); }
    catch { setError("Job input must be valid JSON."); return; }
    const key = retryKey.current ?? crypto.randomUUID();
    retryKey.current = key;
    setBusy("create"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/masumi/purchases", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key },
        body: JSON.stringify({ agentId, resourceListingId: resourceId, inputData, purpose: purpose.trim() || undefined }),
      });
      const body = await response.json().catch(() => ({})) as Envelope<unknown>;
      if (!response.ok) {
        if (![408, 425, 429].includes(response.status) && response.status < 500) retryKey.current = null;
        throw new Error(body.detail ?? `Escrow request failed (${response.status}).`);
      }
      retryKey.current = null;
      setMessage(response.status === 202 ? "Escrow purchase is waiting for policy approval." : "Masumi escrow purchase started. Settlement and result verification continue through reconciliation.");
      await refreshPurchases();
    } catch (cause) {
      setError(cause instanceof Error ? `${cause.message}${retryKey.current ? " Retry will reuse the same idempotency key." : ""}` : "Masumi escrow request failed.");
    } finally { setBusy(null); }
  }

  async function action(purchaseId: string, operation: "reconcile" | "refund" | "authorize-refund") {
    setBusy(`${operation}:${purchaseId}`); setError(""); setMessage("");
    try {
      await api(`/api/v1/masumi/purchases/${purchaseId}/${operation}`, { method: "POST" });
      setMessage(operation === "refund" ? "Refund requested from the Masumi escrow contract." : operation === "authorize-refund" ? "Seller refund authorization submitted." : "Purchase reconciled against current Masumi and job evidence.");
      await refreshPurchases();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Masumi escrow operation failed.");
    } finally { setBusy(null); }
  }

  if (!cardanoAgents.length) return <section className="workspace-section">
    <div className="section-heading"><div><h3>Masumi escrow</h3><p>Create a Cardano agent before using Masumi escrow.</p></div></div>
  </section>;

  return <section className="workspace-section">
    <div className="section-heading"><div><h3>Masumi escrow</h3><p>Hire a verified Masumi agent with policy-controlled escrow, result-hash verification, reputation evidence, and refund lifecycle controls.</p></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}

    {canOperate && <div className="app-form-section">
      <div className="form-grid">
        <label>Buyer agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}>{cardanoAgents.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.network} · {candidate.status}</option>)}</select></label>
        <label>Verified resource<select value={resourceId} onChange={(event) => setResourceId(event.target.value)} disabled={!compatibleResources.length}>{compatibleResources.length ? compatibleResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}{resource.provider?.name ? ` · ${resource.provider.name}` : ""}</option>) : <option value="">No active Cardano resource for this agent</option>}</select></label>
        <label>Purpose (optional)<input value={purpose} onChange={(event) => setPurpose(event.target.value)} maxLength={500} placeholder="e.g. Produce a market-risk brief" /></label>
      </div>
      <label>Job input JSON<textarea rows={8} value={inputJson} onChange={(event) => setInputJson(event.target.value)} spellCheck={false} /></label>
      <p className="form-help">The resource must already have a fresh Masumi registry binding. If the active policy requires Veridian/KERI, it must also have a fresh verified credential. AgentPay encrypts job input at rest and purges it after terminal completion/refund.</p>
      <button className="primary-button" type="button" disabled={Boolean(busy) || !agentId || !resourceId || agent?.status !== "ACTIVE"} onClick={() => void createPurchase()}>{busy === "create" ? "Starting escrow…" : "Start Masumi escrow purchase"}</button>
    </div>}

    <div className="record-list" style={{ marginTop: 16 }}>
      {purchases.length ? purchases.map((purchase) => {
        const buyer = purchase.workspaceRole === "BUYER" || purchase.workspaceRole === "BOTH";
        const seller = purchase.workspaceRole === "SELLER" || purchase.workspaceRole === "BOTH";
        const refundable = buyer && ["FundsLocked", "ResultSubmitted"].includes(purchase.state);
        const sellerCanAuthorize = seller && purchase.state === "RefundRequested";
        return <div className="record-row" key={purchase.id}>
          <div style={{ minWidth: 0 }}>
            <div className="record-title">{purchase.resourceName || purchase.agentIdentifier}</div>
            <div className="record-subtitle">{purchase.workspaceRole || "BUYER"} · {purchase.network} · {new Date(purchase.createdAt).toLocaleString()}</div>
            <div className="record-subtitle" style={{ overflowWrap: "anywhere" }}>Escrow: {purchase.blockchainIdentifier}</div>
            {purchase.resultHash && <div className="record-subtitle" style={{ overflowWrap: "anywhere" }}>Result hash: {purchase.resultHash} {purchase.resultVerifiedAt ? "· verified" : "· awaiting verification"}</div>}
            {purchase.failureCode && <div className="form-error">{purchase.failureCode}</div>}
          </div>
          <div className="rule-actions">
            <span className={`status-badge ${statusClass(purchase.state)}`}>{purchase.state.replaceAll("_", " ")}</span>
            {buyer && canOperate && !["Completed", "RefundAuthorized", "FAILED"].includes(purchase.state) && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void action(purchase.id, "reconcile")}>{busy === `reconcile:${purchase.id}` ? "Reconciling…" : "Reconcile"}</button>}
            {refundable && canOperate && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void action(purchase.id, "refund")}>{busy === `refund:${purchase.id}` ? "Requesting…" : "Request refund"}</button>}
            {sellerCanAuthorize && canAuthorizeRefund && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => void action(purchase.id, "authorize-refund")}>{busy === `authorize-refund:${purchase.id}` ? "Authorizing…" : "Authorize refund"}</button>}
          </div>
        </div>;
      }) : <div className="empty-state"><strong>No Masumi escrow purchases</strong><p>New purchases and seller-side refund requests will appear here.</p></div>}
    </div>
  </section>;
}
