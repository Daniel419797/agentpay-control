"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type Asset = { id: string; symbol: string; name: string; decimals: number; network: string };
type Props = {
  agentId: string;
  agentNetwork: string;
  pythEnabled: boolean;
  masumiEnabled: boolean;
  masumiEscrowEnabled: boolean;
  veridianEnabled: boolean;
};

function decimalToAtomic(amount: string, decimals: number): string | null {
  const normalized = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) return null;
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0")).toString();
}

function optionalAtomic(form: FormData, name: string, decimals: number): string | undefined | null {
  const raw = String(form.get(name) ?? "").trim();
  if (!raw) return undefined;
  return decimalToAtomic(raw, decimals);
}

function usdToMicros(amount: string): string | null {
  const normalized = amount.trim();
  if (!normalized) return null;
  return decimalToAtomic(normalized, 6);
}

function csv(value: FormDataEntryValue | null) {
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function timeToMinute(value: FormDataEntryValue | null): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const match = /^(\d{2}):(\d{2})$/.exec(raw);
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localDateToIso(value: FormDataEntryValue | null): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function PolicyPublishForm({ agentId, agentNetwork, pythEnabled, masumiEnabled, masumiEscrowEnabled, veridianEnabled }: Props) {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetId, setAssetId] = useState("");
  const [usePyth, setUsePyth] = useState(false);
  const [useMasumi, setUseMasumi] = useState(false);
  const [useKeri, setUseKeri] = useState(false);
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
    if (!cardano) { setUseMasumi(false); setUseKeri(false); }
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
    const hourly = optionalAtomic(form, "hourlyLimit", asset.decimals);
    const monthly = optionalAtomic(form, "monthlyLimit", asset.decimals);
    if (!perTx || !daily || BigInt(perTx) <= 0n || BigInt(daily) <= 0n || hourly === null || monthly === null) {
      setError(`Enter valid ${asset.symbol} limits with no more than ${asset.decimals} decimal places.`);
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

    const reputationPercentRaw = String(form.get("masumiMinimumReputationPercent") ?? "").trim();
    const reputationPercent = reputationPercentRaw ? Number(reputationPercentRaw) : null;
    if (reputationPercent != null && (!Number.isFinite(reputationPercent) || reputationPercent < 0 || reputationPercent > 100)) {
      setError("Masumi minimum reputation must be between 0% and 100%.");
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
      minimumReputationBps: reputationPercent == null ? null : Math.round(reputationPercent * 100),
      minimumCompletedPurchases: Number(form.get("masumiMinimumCompletedPurchases") || 0),
    } : undefined;

    const trustedIssuerAids = csv(form.get("keriTrustedIssuerAids"));
    const allowedSchemaSaids = csv(form.get("keriAllowedSchemaSaids"));
    if (useKeri && (!trustedIssuerAids.length || !allowedSchemaSaids.length)) {
      setError("Veridian/KERI enforcement requires at least one trusted issuer AID and one allowed schema SAID.");
      setBusy(false);
      return;
    }
    const keri = useKeri ? {
      enabled: true,
      required: true,
      trustedIssuerAids,
      allowedSchemaSaids,
      maxVerificationAgeSeconds: Number(form.get("keriMaxVerificationAgeSeconds") || 300),
    } : undefined;

    const merchantMode = String(form.get("merchantMode"));
    const allowedHosts = csv(form.get("allowedHosts"));
    if (merchantMode === "ALLOWLIST_ONLY" && !allowedHosts.length) {
      setError("Add at least one allowed host when merchant mode is allowlist-only.");
      setBusy(false);
      return;
    }

    const allowedStartMinute = timeToMinute(form.get("allowedStartTime"));
    const allowedEndMinute = timeToMinute(form.get("allowedEndTime"));
    if ((allowedStartMinute == null) !== (allowedEndMinute == null)) {
      setError("Set both start and end time, or leave both empty.");
      setBusy(false);
      return;
    }

    const activeFrom = localDateToIso(form.get("activeFrom"));
    const activeUntil = localDateToIso(form.get("activeUntil"));
    const maxTransactionsPerHour = optionalNumber(form.get("maxTransactionsPerHour"));
    const cooldownSeconds = optionalNumber(form.get("cooldownSeconds"));
    const body = {
      assetId: asset.id,
      perTransactionLimitAtomic: perTx,
      dailyLimitAtomic: daily,
      ...(hourly !== undefined ? { hourlyLimitAtomic: hourly } : {}),
      ...(monthly !== undefined ? { monthlyLimitAtomic: monthly } : {}),
      overLimitAction: String(form.get("overLimitAction")),
      merchantMode,
      allowedHosts,
      deniedHosts: csv(form.get("deniedHosts")),
      approvalThreshold: Number(form.get("approvalThreshold") || 1),
      rejectionThreshold: Number(form.get("rejectionThreshold") || 1),
      allowedMerchantCategories: form.getAll("allowedMerchantCategories").map(String),
      allowedWeekdays: form.getAll("allowedWeekdays").map(Number),
      ...(allowedStartMinute !== undefined ? { allowedStartMinute } : {}),
      ...(allowedEndMinute !== undefined ? { allowedEndMinute } : {}),
      ...(activeFrom ? { activeFrom } : {}),
      ...(activeUntil ? { activeUntil } : {}),
      ...(maxTransactionsPerHour !== undefined ? { maxTransactionsPerHour } : {}),
      ...(cooldownSeconds !== undefined ? { cooldownSeconds } : {}),
      catalyst: { ...(oracle ? { oracle } : {}), ...(masumi ? { masumi } : {}), ...(keri ? { keri } : {}) },
    };

    try {
      const response = await fetch(`/api/v1/agents/${agentId}/policies/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "Failed to publish policy.");
      setMessage("Policy published with immutable payment, oracle, identity, and reputation controls.");
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
      <label>Hourly limit ({asset?.symbol ?? "asset"}, optional)<input name="hourlyLimit" inputMode="decimal" placeholder="5.0" /></label>
      <label>Daily limit ({asset?.symbol ?? "asset"})<input name="dailyLimit" inputMode="decimal" placeholder="10.0" required /></label>
      <label>Monthly limit ({asset?.symbol ?? "asset"}, optional)<input name="monthlyLimit" inputMode="decimal" placeholder="100.0" /></label>
      <label>Merchant mode<select name="merchantMode" defaultValue="ANY"><option value="ANY">Any merchant except denylist</option><option value="ALLOWLIST_ONLY">Allowlist only</option></select></label>
      <label>Allowed hosts (comma-separated)<input name="allowedHosts" placeholder="api.vendor.example" /></label>
      <label>Denied hosts (comma-separated)<input name="deniedHosts" placeholder="blocked.example.com" /></label>
      <label>Approval threshold<input name="approvalThreshold" type="number" min="1" max="20" defaultValue="1" /></label>
      <label>Rejection threshold<input name="rejectionThreshold" type="number" min="1" max="20" defaultValue="1" /></label>
      <label>Maximum transactions per hour<input name="maxTransactionsPerHour" type="number" min="1" max="10000" placeholder="Optional" /></label>
      <label>Cooldown seconds<input name="cooldownSeconds" type="number" min="0" max="86400" placeholder="Optional" /></label>
      <label>Active from (local date/time)<input name="activeFrom" type="datetime-local" /></label>
      <label>Active until (local date/time)<input name="activeUntil" type="datetime-local" /></label>
      <label>Allowed start time (UTC)<input name="allowedStartTime" type="time" /></label>
      <label>Allowed end time (UTC)<input name="allowedEndTime" type="time" /></label>
    </div>

    <fieldset className="app-form-section">
      <legend>Allowed weekdays (UTC)</legend>
      <div className="button-row">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label, index) => <label className="checkbox-label" key={label}><input type="checkbox" name="allowedWeekdays" value={index} /> {label}</label>)}
      </div>
      <p className="form-help">Leave every day unchecked to allow all weekdays. Weekday and recurring clock-window evaluation is UTC; active-from/active-until are converted from the browser's local date/time into absolute timestamps before publication.</p>
    </fieldset>

    <fieldset className="app-form-section">
      <legend>Allowed merchant categories</legend>
      <div className="button-row">
        {["MARKET_DATA", "FILE", "AI_INFERENCE", "WEB_RESEARCH"].map((category) => <label className="checkbox-label" key={category}><input type="checkbox" name="allowedMerchantCategories" value={category} /> {category.replaceAll("_", " ")}</label>)}
      </div>
      <p className="form-help">Leave every category unchecked to avoid adding a category restriction.</p>
    </fieldset>

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
      <legend>Masumi agent trust and reputation</legend>
      <label className="checkbox-label"><input type="checkbox" checked={useMasumi} onChange={(event) => setUseMasumi(event.target.checked)} /> Require a verified Masumi seller identity</label>
      {useMasumi && <>
        <p className="form-help">The seller identity is refreshed from the trusted registry/payment-information surface. Reputation thresholds are derived only from AgentPay-observed Masumi escrow outcomes with verified result hashes.</p>
        <div className="form-grid">
          <label>Masumi network<input value={masumiNetwork} readOnly /></label>
          <label>Maximum registry age (seconds)<input name="masumiMaxAgeSeconds" type="number" min="15" max="3600" defaultValue="120" /></label>
          <label>Allowed Masumi agent identifiers (optional)<input name="masumiAgentIdentifiers" placeholder="agent identifier, another identifier" /></label>
          <label>Allowed capabilities (optional)<input name="masumiCapabilities" placeholder="web-research, data-analysis" /></label>
          <label>Minimum verified completed purchases<input name="masumiMinimumCompletedPurchases" type="number" min="0" max="1000000" defaultValue="0" disabled={!masumiEscrowEnabled} /></label>
          <label>Minimum reputation (%)<input name="masumiMinimumReputationPercent" type="number" min="0" max="100" step="0.01" placeholder="Optional" disabled={!masumiEscrowEnabled} /></label>
        </div>
        {!masumiEscrowEnabled && <p className="form-help">Settlement-derived reputation is unavailable because Masumi escrow is disabled for this deployment. Identity allowlists remain available.</p>}
      </>}
    </fieldset>}

    {cardano && veridianEnabled && <fieldset className="app-form-section">
      <legend>Veridian / KERI identity</legend>
      <label className="checkbox-label"><input type="checkbox" checked={useKeri} onChange={(event) => setUseKeri(event.target.checked)} /> Require a fresh cryptographically verified KERI/ACDC resource credential</label>
      {useKeri && <>
        <p className="form-help">The deployment-level KERIA verifier remains the cryptographic authority. Policy allowlists can only narrow the deployment's trusted issuer and schema sets.</p>
        <div className="form-grid">
          <label>Trusted issuer AIDs<input name="keriTrustedIssuerAids" placeholder="AID, another AID" /></label>
          <label>Allowed schema SAIDs<input name="keriAllowedSchemaSaids" placeholder="SAID, another SAID" /></label>
          <label>Maximum verification age (seconds)<input name="keriMaxVerificationAgeSeconds" type="number" min="15" max="86400" defaultValue="300" /></label>
        </div>
      </>}
    </fieldset>}

    {!pythEnabled && <p className="form-help">Pyth USD policies are disabled for this deployment. Atomic asset limits remain enforced.</p>}
    {cardano && !masumiEnabled && <p className="form-help">Masumi identity policy is disabled for this deployment.</p>}
    {cardano && !veridianEnabled && <p className="form-help">Veridian/KERI identity policy is disabled for this deployment.</p>}
    <p className="form-help">Publishing requires recent authentication. Every extension is attached while the version is still DRAFT, then the complete version becomes immutable in one transaction.</p>
    <button className="primary-button" type="submit" disabled={busy || !asset}>{busy ? "Publishing…" : "Publish policy"}</button>
  </form>;
}
