"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type AgentOption = { id: string; label: string; networkId: string; sourceAddress: string };
type NetworkOption = { id: string; label: string };
type Quote = { id: string; estimatedOutputAtomic: string; minimumOutputAtomic: string; expiresAt: string; provider: string };
type Prepared = {
  transfer: { id: string };
  transactionRequest: { to: string; data: string; value: string; chainId: number; gasLimit?: string };
  expiresAt: string;
  externalWalletControl: true;
  emergencyStopBoundary: string;
};

async function request<T>(path: string, body: unknown, idempotent = false) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { data?: T; detail?: string };
  if (!response.ok || !payload.data) throw new Error(payload.detail ?? "The request could not be completed.");
  return payload.data;
}

export function CrossChainOperations({ agents, networks }: { agents: AgentOption[]; networks: NetworkOption[] }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [acknowledgedExternalControl, setAcknowledgedExternalControl] = useState(false);
  const [busy, setBusy] = useState<"quote" | "prepare" | "submit" | null>(null);
  const [error, setError] = useState("");
  const agent = useMemo(() => agents.find((candidate) => candidate.id === agentId), [agentId, agents]);

  async function createQuote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!agent) return;
    setBusy("quote");
    setError("");
    setQuote(null);
    setPrepared(null);
    setAcknowledgedExternalControl(false);
    const form = new FormData(event.currentTarget);
    try {
      setQuote(await request<Quote>("/api/v1/cross-chain/quotes", {
        agentId: agent.id,
        sourceNetworkId: agent.networkId,
        destinationNetworkId: String(form.get("destinationNetworkId")),
        sourceToken: String(form.get("sourceToken")).trim(),
        destinationToken: String(form.get("destinationToken")).trim(),
        sourceAddress: agent.sourceAddress,
        destinationAddress: String(form.get("destinationAddress")).trim(),
        inputAmountAtomic: String(form.get("inputAmountAtomic")).trim(),
        slippage: Number(form.get("slippage")),
        order: String(form.get("order")),
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No bridge quote was available.");
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    if (!quote || !acknowledgedExternalControl) return;
    setBusy("prepare");
    setError("");
    try {
      setPrepared(await request<Prepared>(`/api/v1/cross-chain/quotes/${quote.id}/prepare`, { acknowledgeExternalWalletControl: true }, true));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The transfer could not be prepared.");
    } finally {
      setBusy(null);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prepared) return;
    setBusy("submit");
    setError("");
    const hash = String(new FormData(event.currentTarget).get("sourceTransactionHash")).trim();
    try {
      await request(`/api/v1/cross-chain/transfers/${prepared.transfer.id}/submit`, { sourceTransactionHash: hash });
      router.refresh();
      setQuote(null);
      setPrepared(null);
      setAcknowledgedExternalControl(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The transaction hash could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  return <section className="panel section-gap">
    <div className="panel-header"><div><h2 className="panel-title">New bridge transfer</h2><p className="panel-description">Get a short-lived route, inspect the exact transaction, export it to your self-custody wallet, then submit its hash for independent source and destination verification.</p></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {!agents.length && <div className="inline-notice">No active EVM agent account is available. Add an EVM account before requesting a bridge route.</div>}
    <form className="app-form" onSubmit={createQuote}>
      <div className="form-grid">
        <label>Source agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)} required>{agents.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <label>Source address<input value={agent?.sourceAddress ?? ""} readOnly /></label>
        <label>Destination network<select name="destinationNetworkId" required>{networks.filter((network) => network.id !== agent?.networkId).map((network) => <option key={network.id} value={network.id}>{network.label}</option>)}</select></label>
        <label>Amount (atomic)<input name="inputAmountAtomic" inputMode="numeric" pattern="[0-9]+" required /></label>
        <label>Source token<input name="sourceToken" placeholder="0x… token address" required /></label>
        <label>Destination token<input name="destinationToken" placeholder="0x… token address" required /></label>
        <label>Destination address<input name="destinationAddress" pattern="0x[0-9a-fA-F]{40}" required /></label>
        <label>Route priority<select name="order" defaultValue="CHEAPEST"><option value="CHEAPEST">Lowest cost</option><option value="FASTEST">Fastest</option></select></label>
        <label>Slippage tolerance<select name="slippage" defaultValue="0.005"><option value="0.001">0.1%</option><option value="0.005">0.5%</option><option value="0.01">1%</option><option value="0.03">3%</option></select></label>
      </div>
      <button className="primary-button" type="submit" disabled={!agents.length || Boolean(busy)}>{busy === "quote" ? "Requesting…" : "Get verified route"}</button>
    </form>
    {quote && <div className="operation-review">
      <div className="detail-grid">
        <div><span>Provider</span><strong>{quote.provider}</strong></div>
        <div><span>Estimated output</span><strong>{quote.estimatedOutputAtomic}</strong></div>
        <div><span>Minimum output</span><strong>{quote.minimumOutputAtomic}</strong></div>
        <div><span>Expires</span><strong>{new Date(quote.expiresAt).toLocaleTimeString()}</strong></div>
      </div>
      {!prepared && <>
        <div className="inline-notice" role="note"><strong>Self-custody boundary.</strong> AgentPay can stop new transaction exports. After the raw transaction is exported to your external wallet, an AgentPay emergency stop cannot revoke that already-disclosed payload. Verify the target, calldata, value, and wallet network before signing.</div>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <input type="checkbox" checked={acknowledgedExternalControl} onChange={(event) => setAcknowledgedExternalControl(event.target.checked)} />
          <span>I understand that my external wallet controls the transaction after AgentPay exports it.</span>
        </label>
        <button className="secondary-button" type="button" disabled={Boolean(busy) || !acknowledgedExternalControl} onClick={() => void prepare()}>{busy === "prepare" ? "Preparing…" : "Export wallet transaction"}</button>
      </>}
    </div>}
    {prepared && <form className="app-form operation-review" onSubmit={submit}>
      <div className="inline-notice" role="status"><strong>Transaction exported.</strong> {prepared.emergencyStopBoundary} This route expires at {new Date(prepared.expiresAt).toLocaleTimeString()}.</div>
      <div className="detail-grid">
        <div><span>Chain ID</span><strong>{prepared.transactionRequest.chainId}</strong></div>
        <div><span>Target</span><strong className="mono-value">{prepared.transactionRequest.to}</strong></div>
        <div><span>Value</span><strong>{prepared.transactionRequest.value}</strong></div>
        <div><span>Gas limit</span><strong>{prepared.transactionRequest.gasLimit ?? "Wallet estimate"}</strong></div>
      </div>
      <label>Calldata<textarea className="mono-value" value={prepared.transactionRequest.data} readOnly rows={4} /></label>
      <label>Signed source transaction hash<input name="sourceTransactionHash" pattern="0x[0-9a-fA-F]{64}" placeholder="0x…" required /></label>
      <button className="primary-button" type="submit" disabled={Boolean(busy)}>{busy === "submit" ? "Recording…" : "Submit for verification"}</button>
    </form>}
  </section>;
}
