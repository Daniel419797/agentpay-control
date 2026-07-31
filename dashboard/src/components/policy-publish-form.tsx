"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type Asset = { id: string; symbol: string; name: string; decimals: number; network: string };

function toAtomic(amount: string, decimals: number): string | null {
  const num = parseFloat(amount);
  if (!Number.isFinite(num) || num < 0) return null;
  const [whole = "0", frac = ""] = amount.split(".");
  const paddedFrac = frac.padEnd(decimals, "0").slice(0, decimals);
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(paddedFrac || "0")).toString();
}

export function PolicyPublishForm({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/v1/assets")
      .then((r) => r.json())
      .then((res: { data?: Asset[] }) => { if (res.data) setAssets(res.data); })
      .catch(() => {});
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const assetId = String(form.get("assetId"));
    const asset = assets.find((a) => a.id === assetId);
    if (!asset) { setError("Select a valid asset."); setBusy(false); return; }
    const perTx = toAtomic(String(form.get("perTransactionLimit") || "0"), asset.decimals);
    const daily = toAtomic(String(form.get("dailyLimit") || "0"), asset.decimals);
    if (!perTx || !daily) { setError("Enter valid limit amounts."); setBusy(false); return; }
    const body = {
      assetId,
      perTransactionLimitAtomic: perTx,
      dailyLimitAtomic: daily,
      overLimitAction: String(form.get("overLimitAction")),
      merchantMode: String(form.get("merchantMode")),
      deniedHosts: String(form.get("deniedHosts") || "").split(",").map((s) => s.trim()).filter(Boolean),
      approvalThreshold: Number(form.get("approvalThreshold") || 1),
      rejectionThreshold: Number(form.get("rejectionThreshold") || 1),
    };
    try {
      const res = await fetch(`/api/v1/agents/${agentId}/policies/publish`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const payload = await res.json() as { detail?: string };
      if (!res.ok) throw new Error(payload.detail ?? "Failed to publish policy.");
      setMessage("Policy published.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The policy could not be published.");
    } finally {
      setBusy(false);
    }
  }

  const hbarAsset = assets.find((a) => a.symbol === "HBAR");

  return <form className="app-form" onSubmit={handleSubmit}>
    <h3>Publish spend policy</h3>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    <div className="form-grid">
      <label>Asset<select name="assetId" required defaultValue={hbarAsset?.id ?? ""}>{assets.map((a) => <option key={a.id} value={a.id}>{a.symbol} — {a.name} ({a.network})</option>)}</select></label>
      <label>Over-limit action<select name="overLimitAction" defaultValue="REQUIRE_APPROVAL"><option value="DENY">Deny</option><option value="REQUIRE_APPROVAL">Require approval</option></select></label>
      <label>Per transaction limit ({hbarAsset?.symbol ?? "units"})<input name="perTransactionLimit" type="number" step="any" min="0" placeholder="1.0" required /></label>
      <label>Daily limit ({hbarAsset?.symbol ?? "units"})<input name="dailyLimit" type="number" step="any" min="0" placeholder="10.0" required /></label>
      <label>Merchant mode<select name="merchantMode" defaultValue="ANY"><option value="ANY">Any merchant</option><option value="ALLOWLIST_ONLY">Allowlist only</option></select></label>
      <label>Approval threshold<input name="approvalThreshold" type="number" min="1" max="20" defaultValue="1" /></label>
      <label>Rejection threshold<input name="rejectionThreshold" type="number" min="1" max="20" defaultValue="1" /></label>
      <label>Denied hosts (comma-separated)<input name="deniedHosts" placeholder="blocked.example.com" /></label>
    </div>
    <button className="primary-button" type="submit" disabled={busy || !assets.length}>{busy ? "Publishing…" : "Publish policy"}</button>
  </form>;
}
