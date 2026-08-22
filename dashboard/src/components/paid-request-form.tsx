"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SupportedCardanoWallet } from "@/lib/cardano-browser-wallet";

type AgentAccount = { network: string; accountId: string; custodyType: string; signingMode: string };
type Agent = { id: string; name: string; status: string; network: string; accounts: AgentAccount[] };
type Resource = {
  id: string;
  name: string;
  endpoint: string;
  status: string;
  provider?: { name?: string };
  prices?: Array<{ atomicAmount: string; asset?: { network?: string; symbol?: string; decimals?: number } }>;
};

type Result = {
  id: string;
  status: string;
  resourceUrl: string;
  transactionId?: string | null;
  explorerUrl?: string | null;
  amount?: string;
  network?: string;
};

type PaidRequestResponse = {
  id: string;
  status: string;
  attempts?: Array<{ settlement?: { transactionId?: string | null } }>;
  quote?: {
    network?: string;
    amountAtomic?: string | number | bigint;
    asset?: { decimals?: number; symbol?: string };
  };
};

function formatAtomic(value: string, decimals: number, symbol: string) {
  try {
    const atomic = BigInt(value);
    const divisor = 10n ** BigInt(Math.max(0, decimals));
    const whole = atomic / divisor;
    const fraction = (atomic % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${whole.toString()}${fraction ? `.${fraction}` : ""} ${symbol}`.trim();
  } catch {
    return `${value} ${symbol}`.trim();
  }
}

function explorerTransactionUrl(network: string | undefined, transactionId: string | null | undefined) {
  if (!network || !transactionId) return null;
  if (network === "hedera:testnet") return `https://hashscan.io/testnet/transaction/${encodeURIComponent(transactionId)}`;
  if (network === "hedera:mainnet") return `https://hashscan.io/mainnet/transaction/${encodeURIComponent(transactionId)}`;
  if (network === "eip155:5042002") return `https://testnet.arcscan.app/tx/${encodeURIComponent(transactionId)}`;
  if (network === "cardano:preprod") return `https://preprod.cardanoscan.io/transaction/${encodeURIComponent(transactionId)}`;
  if (network === "cardano:mainnet") return `https://cardanoscan.io/transaction/${encodeURIComponent(transactionId)}`;
  return null;
}

function supportsManagedRequest(account: AgentAccount | undefined) {
  if (!account) return false;
  return account.signingMode === "AUTONOMOUS_MANAGED"
    && (account.custodyType === "PLATFORM_MANAGED_TESTNET" || account.custodyType === "EXTERNAL_DELEGATED");
}

function supportsWalletRequest(account: AgentAccount | undefined) {
  return Boolean(account && (account.network === "eip155:5042002" || account.network.startsWith("cardano:")) && account.custodyType === "SELF_CUSTODY" && account.signingMode === "WALLET_CONFIRMATION");
}

function hexToBase64(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error("The wallet returned invalid Cardano transaction CBOR.");
  let binary = "";
  for (let index = 0; index < hex.length; index += 2) binary += String.fromCharCode(Number.parseInt(hex.slice(index, index + 2), 16));
  return btoa(binary);
}

export function PaidRequestForm({ agents, defaultAgentId }: { agents: Agent[]; defaultAgentId?: string }) {
  const [agentId, setAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? "");
  const [resources, setResources] = useState<Resource[]>([]);
  const [resourceUrl, setResourceUrl] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [loadingResources, setLoadingResources] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");

  const activeAgent = agents.find((agent) => agent.id === agentId);
  const activeAccount = activeAgent?.accounts.find((account) => account.network === activeAgent.network) ?? activeAgent?.accounts[0];
  const isPaused = activeAgent?.status === "PAUSED";
  const managedRequest = supportsManagedRequest(activeAccount);
  const walletRequest = supportsWalletRequest(activeAccount);
  const supportedRequest = managedRequest || walletRequest;

  const compatibleResources = useMemo(() => {
    if (!activeAgent) return [];
    return resources.filter((resource) => resource.status === "ACTIVE" && resource.prices?.some((price) => price.asset?.network === activeAgent.network));
  }, [activeAgent, resources]);
  const selectedResourceUrl = compatibleResources.some((resource) => resource.endpoint === resourceUrl) ? resourceUrl : compatibleResources[0]?.endpoint ?? "";

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/resources", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { data?: Resource[]; detail?: string } | null;
        if (!response.ok) throw new Error(body?.detail ?? "Could not load registered resources.");
        return body?.data ?? [];
      })
      .then((rows) => { if (active) setResources(rows); })
      .catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "Could not load registered resources."); })
      .finally(() => { if (active) setLoadingResources(false); });
    return () => { active = false; };
  }, []);

  async function submit() {
    const url = useCustom ? customUrl.trim() : selectedResourceUrl;
    if (!agentId || !url || !supportedRequest) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await fetch(`/api/v1/agents/${agentId}/paid-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ resourceUrl: url, purpose: purpose.trim() || undefined }),
      });
      const body = await response.json().catch(() => null) as { data?: PaidRequestResponse; detail?: string; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) {
        setError(body?.detail ?? body?.error?.message ?? `Request failed (${response.status})`);
        return;
      }
      let data = body.data;
      if (walletRequest && data.status === "AUTHORIZED") {
        const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
        if (!activeAccount) throw new Error("The active payment account is unavailable.");
        const preparedResponse = await fetch(`/api/v1/payment-intents/${encodeURIComponent(data.id)}/self-custody`, { cache: "no-store" });
        const preparedBody = await preparedResponse.json() as { data?: { accountId: string; network: string; requirement: unknown; unsignedTransaction?: string; nonce?: string }; detail?: string };
        if (!preparedResponse.ok || !preparedBody.data) throw new Error(preparedBody.detail ?? "The payment authorization could not be prepared.");
        let paymentPayload: unknown;
        if (activeAccount.network === "eip155:5042002") {
          if (!projectId) throw new Error("WalletConnect is not configured for Arc wallet confirmation.");
          const { createArcEip3009Payload } = await import("@/lib/arc-wallet-appkit");
          paymentPayload = await createArcEip3009Payload(projectId, preparedBody.data.accountId, preparedBody.data.requirement);
        } else {
          if (!preparedBody.data.unsignedTransaction || !preparedBody.data.nonce) throw new Error("The Cardano unsigned transaction is missing.");
          const identitiesResponse = await fetch("/api/v1/wallet", { cache: "no-store" });
          const identitiesBody = await identitiesResponse.json() as { data?: { identities?: Array<{ network: string; walletProvider: string }> }; detail?: string };
          const identity = identitiesBody.data?.identities?.find((item) => item.network === activeAccount.network);
          if (!identitiesResponse.ok || !identity) throw new Error(identitiesBody.detail ?? "Reconnect the verified Cardano wallet.");
          const cardano = await import("@/lib/cardano-browser-wallet");
          if (!cardano.supportedCardanoWallets.includes(identity.walletProvider as SupportedCardanoWallet)) throw new Error("The verified Cardano wallet provider is not supported.");
          const signedTransaction = await cardano.signCardanoTransaction(identity.walletProvider as SupportedCardanoWallet, activeAccount.network as "cardano:preprod" | "cardano:mainnet", preparedBody.data.accountId, preparedBody.data.unsignedTransaction);
          paymentPayload = { x402Version: 2, accepted: preparedBody.data.requirement, payload: { transaction: hexToBase64(signedTransaction), nonce: preparedBody.data.nonce, payerAddress: preparedBody.data.accountId, submissionMode: "server" } };
        }
        const submitResponse = await fetch(`/api/v1/payment-intents/${encodeURIComponent(data.id)}/self-custody`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paymentPayload }),
        });
        const submitBody = await submitResponse.json() as { data?: PaidRequestResponse; detail?: string };
        if (!submitResponse.ok || !submitBody.data) throw new Error(submitBody.detail ?? "The signed payment could not be submitted.");
        data = submitBody.data;
      }
      const settlement = data.attempts?.find((attempt) => attempt.settlement)?.settlement;
      const network = data.quote?.network;
      const transactionId = settlement?.transactionId;
      const amountAtomic = data.quote?.amountAtomic != null ? String(data.quote.amountAtomic) : undefined;
      const decimals = Number(data.quote?.asset?.decimals ?? 0);
      const symbol = String(data.quote?.asset?.symbol ?? "");
      setResult({ id: data.id, status: data.status, resourceUrl: url, transactionId, explorerUrl: explorerTransactionUrl(network, transactionId), amount: amountAtomic ? formatAtomic(amountAtomic, decimals, symbol) : undefined, network });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Network error. The request status is unknown; check Transactions before retrying.");
    } finally {
      setLoading(false);
    }
  }

  function statusColor(status: string) {
    if (status === "SETTLED") return "status-settled";
    if (["APPROVAL_PENDING", "PENDING", "AUTHORIZED", "SUBMISSION_UNKNOWN"].includes(status)) return "status-approval";
    if (["DENIED", "REJECTED", "FAILED_BEFORE_SUBMISSION", "SETTLEMENT_FAILED"].includes(status)) return "status-error";
    return "";
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Agent</label>
        <select className="form-input" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.status})</option>)}
        </select>
        {isPaused && <div className="form-error" style={{ marginTop: 4 }}>Agent is paused. Resume it before sending requests.</div>}
        {activeAgent && walletRequest && <div className="form-help" style={{ marginTop: 6 }}>This account requires wallet confirmation. AgentPay will show the exact payment authorization or transaction after policy approval.</div>}
        {activeAgent && managedRequest && activeAccount?.custodyType === "EXTERNAL_DELEGATED" && <div className="form-help" style={{ marginTop: 6 }}>This Mainnet agent signs through its isolated external signer identity after AgentPay policy authorization.</div>}
        {activeAgent && !supportedRequest && <div className="form-help" style={{ marginTop: 6 }}>This wallet rail is not yet available for direct paid requests.</div>}
      </div>

      <div>
        <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Resource</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}><input type="radio" checked={!useCustom} onChange={() => setUseCustom(false)} /> Registered</label>
          <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}><input type="radio" checked={useCustom} onChange={() => setUseCustom(true)} /> Registered URL</label>
        </div>
        {useCustom ? (
          <input className="form-input" value={customUrl} onChange={(event) => setCustomUrl(event.target.value)} placeholder="https://provider.example/api/resource" inputMode="url" />
        ) : (
          <select className="form-input" value={selectedResourceUrl} onChange={(event) => setResourceUrl(event.target.value)} disabled={loadingResources || compatibleResources.length === 0}>
            {loadingResources && <option value="">Loading resources…</option>}
            {!loadingResources && compatibleResources.length === 0 && <option value="">No active resource priced for this network</option>}
            {compatibleResources.map((resource) => <option key={resource.id} value={resource.endpoint}>{resource.name}{resource.provider?.name ? ` · ${resource.provider.name}` : ""}</option>)}
          </select>
        )}
        <div className="form-help" style={{ marginTop: 6 }}>The endpoint must be an active AgentPay resource with a verified price and payee for the selected agent network.</div>
      </div>

      <div><label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Purpose (optional)</label><input className="form-input" value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="e.g. Daily market analysis" /></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="button-row"><button className="primary-button" type="button" disabled={loading || !agentId || isPaused || !supportedRequest || (useCustom ? !customUrl.trim() : !selectedResourceUrl)} onClick={() => void submit()}>{loading ? "Sending…" : walletRequest ? "Review and sign payment" : "Send paid request"}</button></div>

      {result && (
        <div className="panel" style={{ borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Result</div>
          <div className="detail-grid">
            <div><span>Status</span><strong><span className={`status-badge ${statusColor(result.status)}`}>{result.status.replaceAll("_", " ")}</span></strong></div>
            <div><span>Resource</span><strong style={{ fontSize: 13 }}>{result.resourceUrl}</strong></div>
            {result.network && <div><span>Network</span><strong>{result.network}</strong></div>}
            {result.amount && <div><span>Amount</span><strong>{result.amount}</strong></div>}
            {result.transactionId && <div><span>Transaction</span><strong style={{ fontFamily: "monospace", fontSize: 12 }}>{result.transactionId}</strong></div>}
          </div>
          <div className="button-row" style={{ marginTop: 12 }}>
            <Link className="secondary-button" href="/app/transactions">View all transactions</Link>
            {result.explorerUrl && <a className="secondary-button" href={result.explorerUrl} target="_blank" rel="noreferrer">Open explorer</a>}
          </div>
        </div>
      )}
    </div>
  );
}
