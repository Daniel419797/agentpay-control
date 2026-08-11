"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Asset = { id: string; symbol: string; name: string; decimals: number; network: string };
type Props = {
  agentId: string;
  agentNetwork: string;
  pythEnabled: boolean;
  masumiEnabled: boolean;
};

function decimalToAtomic(amount: string, decimals: number): string | null {
  const normalized = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")).toString();
}

function usdToMicros(amount: string): string | null {
  const normalized = amount.trim();
  if (!normalized) return null;
  return decimalToAtomic(normalized, 6);
}

function csv(value: FormDataEntryValue | null) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function PolicyPublishForm({ agentId, agentNetwork, pythEnabled, masumiEnabled }: Props) {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [usePyth, setUsePyth] = useState(false);
  const [useMasumi, setUseMasumi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/v1/assets", { cache: "no-store" })
      .then((response) => response.json())
      .then((result: { data?: Asset[] }) => {
        const matching = (result.data ?? []).filter((asset) => asset.network === agentNetwork);
        setAssets(matching);
        setAssetId((current) => current || matching[0]?.id || "");
      })
      .catch(() => setError("Payment assets could not be loaded."));
  }, [agentNetwork]);

  const asset = useMemo(() => assets.find((candidate) => candidate.id === assetId), [assets, assetId]);
  const supportsPyth = Boolean(asset && ["ADA", "USDC", "USDCX"].includes(asset.symbol));
  const cardano = agentNetwork === "cardano:preprod" || agentNetwork === "cardano:mainnet";
  const masumiNetwork = agentNetwork === "cardano:mainnet" ? "Mainnet" : "Preprod";

  useEffect(() => {
    if (!supportsPyth) setUsePyth(false);
    if (!cardano) setUseMasumi(false);
  }, [supportsPyth, cardano]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    if (!asset) {
      setError("Select a valid asset for this agent's network.");
      setBusy(false);
      return;
    }

    const perTx = decimalToAtomic(String(form.get("perTransactionLimit") || ""), asset.decimals);
    const daily = decimalToAtomic(String(form.get("dailyLimit") || ""), asset.decimals);
    if (!perTx || !daily || BigInt(perTx) <= 0n || BigInt(daily) <= 0n) {
      setError(`Enter positive ${asset.symbol} limits with no more than ${asset.decimals} decimal places.`);
      setBusy(false);
      return;
    }

    const oracle = usePyth ? {
      enabled: true,
      perTransactionUsdMicros: usdToMicros(String(form.get("usdPerTransaction") || "")),
      hourlyUsdMicros: usdToMicros(String(form.get("usdHourly") || "")),
      dailyUsdMicros: usdToMicros(String(form.get("usdDaily") || "")),
      monthlyUsdMicros: usdToMicros(String(form.get("usdMonthly") || "")),
      maxPriceAgeSeconds: Number(form.get("maxPriceAgeSeconds") || 30),
      maxConfidenceBps: Number(form.get("maxConfidenceBps") || 250),
    } : undefined;
    if (oracle && !oracle.perTransactionUsdMicros && !oracle.hourlyUsdMicros && !oracle.dailyUsdMicros && !oracle.monthlyUsdMicros) {
      setError("Set at least one USD-denominated Pyth limit or turn Pyth policy off.");
      setBusy(false);
      return;
    }

    const masumi = useMasumi ? {
      enabled: true,
      required: true,
      network: masumiNetwork,
      allowedAgentIdentifiers: csv(form.get("masumiAgentIdentifiers")),
      allowedCapabilities: csv(form.get("masumiCapabilities")),
      maxRegistryAgeSeconds: Number(form.get("masumiMaxAgeSeconds") || 120),
      requireOnline: true,
    } : undefined;

    const body = {
      assetId: asset.id,
      perTransactionLimitAtomic: perTx,
      dailyLimitAtomic: daily,
      overLimitAction: String(form.get("overLimitAction")),
      merchantMode: String(form.get("merchantMode")),
      deniedHosts: csv(form.get("deniedHosts")),
      approvalThreshold: Number(form.get("approvalThreshold") || 1),
      rejectionThreshold: Number(form.get("rejectionThreshold") || 1),
      catalyst: { ...(oracle ? { oracle } : {}), ...(masumi ? { masumi } : {}) },
    };

    try {
      const response = await fetch(`/api/v1/agents/${agentId}/policies/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "Failed to publish policy.");
      setMessage("Policy published with immutable payment controls.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The policy could not be published.");
    } finally {
      setBusy(false);
    }
  }

  return <form className="app-form" onSubmit={handleSubmit}>
    <h3>Publish spend policy</h3>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    <div className="form-grid">
      <label>Asset<select name="assetId" required value={assetId} onChange={(event) => setAssetId(event.target.value)}>{assets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.symbol} — {candidate.name}</option>)}</select></label>
      <label>Over-limit action<select name="overLimitAction" defaultValue="REQUIRE_APPROVAL"><option value="DENY">Deny</option><option value="REQUIRE_APPROVAL">Require approval</option></select></label>
      <label>Per transaction limit ({asset?.symbol ?? "asset"})<input name="perTransactionLimit" inputMode="decimal" placeholder="1.0" required /></label>
      <label>Daily limit ({asset?.symbol ?? "asset"})<input name="dailyLimit" inputMode="decimal" placeholder="10.0" required /></label>
      <label>Merchant mode<select name="merchantMode" defaultValue="ANY"><option value="ANY">Any merchant</option><option value="ALLOWLIST_ONLY">Allowlist only</option></select></label>
      <label>Approval threshold<input name="approvalThreshold" type="number" min="1" max="20" defaultValue="1" /></label>
      <label>Rejection threshold<input name="rejectionThreshold" type="number" min="1" max="20" defaultValue="1" /></label>
      <label>Denied hosts (comma-separated)<input name="deniedHosts" placeholder="blocked.example.com" /></label>
    </div>

    {pythEnabled && supportsPyth && <fieldset className="app-form-section">
      <legend>Oracle-valued USD limits</legend>
      <label className="checkbox-label"><input type="checkbox" checked={usePyth} onChange={(event) => setUsePyth(event.target.checked)} /> Enforce Pyth-valued USD limits</label>
      {usePyth && <>
        <p className="form-help">These limits can only make the base {asset?.symbol} policy stricter. AgentPay uses the upper edge of Pyth's confidence interval and fails closed on stale or uncertain prices.</p>
        <div className="form-grid">
          <label>Maximum per transaction (USD)<input name="usdPerTransaction" inputMode="decimal" placeholder="1.00" /></label>
          <label>Maximum per hour (USD)<input name="usdHourly" inputMode="decimal" placeholder="10.00" /></label>
          <label>Maximum per day (USD)<input name="usdDaily" inputMode="decimal" placeholder="50.00" /></label>
          <label>Maximum per month (USD)<input name="usdMonthly" inputMode="decimal" placeholder="500.00" /></label>
          <label>Maximum price age (seconds)<input name="maxPriceAgeSeconds" type="number" min="1" max="300" defaultValue="30" /></label>
          <label>Maximum confidence width (bps)<input name="maxConfidenceBps" type="number" min="1" max="5000" defaultValue="250" /></label>
        </div>
      </>}
    </fieldset>}

    {cardano && masumiEnabled && <fieldset className="app-form-section">
      <legend>Masumi agent trust</legend>
      <label className="checkbox-label"><input type="checkbox" checked={useMasumi} onChange={(event) => setUseMasumi(event.target.checked)} /> Require a verified Masumi seller identity</label>
      {useMasumi && <>
        <p className="form-help">AgentPay will require a fresh online registry identity and will bind the x402 payee to the seller wallet returned by Masumi payment information.</p>
        <div className="form-grid">
          <label>Masumi network<input value={masumiNetwork} readOnly /></label>
          <label>Maximum registry age (seconds)<input name="masumiMaxAgeSeconds" type="number" min="15" max="3600" defaultValue="120" /></label>
          <label>Allowed Masumi agent identifiers (optional)<input name="masumiAgentIdentifiers" placeholder="asset identifier, another identifier" /></label>
          <label>Allowed capabilities (optional)<input name="masumiCapabilities" placeholder="web-research, data-analysis" /></label>
        </div>
      </>}
    </fieldset>}

    {!pythEnabled && <p className="form-help">Pyth USD policies are disabled for this deployment. Atomic asset limits remain enforced.</p>}
    {cardano && !masumiEnabled && <p className="form-help">Masumi identity policy is disabled for this deployment.</p>}
    <p className="form-help">Publishing requires recent authentication. The policy and any Pyth/Masumi extensions become immutable once published.</p>
    <button className="primary-button" type="submit" disabled={busy || !asset}>{busy ? "Publishing…" : "Publish policy"}</button>
  </form>;
}