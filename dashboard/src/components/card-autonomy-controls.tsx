"use client";

import { useEffect, useState } from "react";

type CardOption = { id: string; label: string; status: string; agentName: string };
type Policy = {
  virtualCardId: string;
  agentId: string;
  mode: "DISABLED" | "APPROVAL_REQUIRED" | "LIMITED" | "MERCHANT_ALLOWLIST" | "BROAD";
  perPurchaseAutoLimitMinor: string | null;
  overLimitAction: "DENY" | "REQUIRE_APPROVAL";
  allowedHosts: string[];
  deniedHosts: string[];
  requirePurpose: boolean;
  maxCheckoutSeconds: number;
  version: number;
};

const defaultPolicy: Policy = {
  virtualCardId: "",
  agentId: "",
  mode: "DISABLED",
  perPurchaseAutoLimitMinor: null,
  overLimitAction: "REQUIRE_APPROVAL",
  allowedHosts: [],
  deniedHosts: [],
  requirePurpose: true,
  maxCheckoutSeconds: 90,
  version: 0,
};

function lines(values: string[]) { return values.join("\n"); }
function parseLines(value: string) { return [...new Set(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))]; }

export function CardAutonomyControls({ cards, canEdit }: { cards: CardOption[]; canEdit: boolean }) {
  const [cardId, setCardId] = useState(cards[0]?.id ?? "");
  const [policy, setPolicy] = useState<Policy>(defaultPolicy);
  const [allowedHosts, setAllowedHosts] = useState("");
  const [deniedHosts, setDeniedHosts] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!cardId) return;
    let active = true;
    setLoading(true); setError(""); setMessage("");
    void fetch(`/api/v1/cards/${cardId}/autonomy`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail ?? "Could not load autonomous spending policy.");
        if (!active) return;
        const next = body.data as Policy;
        setPolicy(next);
        setAllowedHosts(lines(next.allowedHosts));
        setDeniedHosts(lines(next.deniedHosts));
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load autonomous spending policy."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cardId]);

  async function save() {
    if (!cardId || !canEdit) return;
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/cards/${cardId}/autonomy`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: policy.mode,
          perPurchaseAutoLimitMinor: policy.perPurchaseAutoLimitMinor?.trim() || null,
          overLimitAction: policy.overLimitAction,
          allowedHosts: parseLines(allowedHosts),
          deniedHosts: parseLines(deniedHosts),
          requirePurpose: policy.requirePurpose,
          maxCheckoutSeconds: policy.maxCheckoutSeconds,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail ?? "Autonomous spending policy could not be saved.");
      const next = body.data as Policy;
      setPolicy(next);
      setAllowedHosts(lines(next.allowedHosts));
      setDeniedHosts(lines(next.deniedHosts));
      setMessage(next.mode === "DISABLED" ? "Autonomous checkout disabled. Unsubmitted work was canceled safely; uncertain submitted work remains visible for review." : `Autonomous checkout policy v${next.version} is active.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Autonomous spending policy could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!cards.length) return null;
  const selected = cards.find((card) => card.id === cardId) ?? cards[0]!;

  return <section className="panel section-gap">
    <div className="panel-header"><div><h2 className="panel-title">Autonomous card spending</h2><p className="panel-description">Control what the assigned AI agent may purchase with this virtual card. PAN and CVC remain inside the isolated executor.</p></div><span className={`status-badge ${policy.mode === "DISABLED" ? "status-error" : "status-settled"}`}>{loading ? "LOADING" : policy.mode.replaceAll("_", " ")}</span></div>
    <div className="app-form">
      <label>Virtual card<select value={cardId} onChange={(event) => setCardId(event.target.value)}>{cards.map((card) => <option key={card.id} value={card.id}>{card.label} · {card.agentName} · {card.status}</option>)}</select></label>
      <div className="form-grid">
        <label>Autonomy mode<select disabled={!canEdit || loading} value={policy.mode} onChange={(event) => setPolicy((current) => ({ ...current, mode: event.target.value as Policy["mode"] }))}><option value="DISABLED">Disabled</option><option value="APPROVAL_REQUIRED">Every purchase needs approval</option><option value="LIMITED">Autonomous under a per-purchase limit</option><option value="MERCHANT_ALLOWLIST">Approved merchants only</option><option value="BROAD">Broad, still bounded by card policy</option></select></label>
        <label>Autonomous limit (minor units)<input disabled={!canEdit || loading || policy.mode === "DISABLED"} value={policy.perPurchaseAutoLimitMinor ?? ""} onChange={(event) => setPolicy((current) => ({ ...current, perPurchaseAutoLimitMinor: event.target.value || null }))} inputMode="numeric" pattern="[0-9]*" placeholder="5000" /></label>
        <label>When limit is exceeded<select disabled={!canEdit || loading} value={policy.overLimitAction} onChange={(event) => setPolicy((current) => ({ ...current, overLimitAction: event.target.value as Policy["overLimitAction"] }))}><option value="REQUIRE_APPROVAL">Require human approval</option><option value="DENY">Deny</option></select></label>
        <label>Checkout deadline (seconds)<input disabled={!canEdit || loading} type="number" min={10} max={120} value={policy.maxCheckoutSeconds} onChange={(event) => setPolicy((current) => ({ ...current, maxCheckoutSeconds: Number(event.target.value) }))} /></label>
      </div>
      <div className="form-grid">
        <label>Allowed merchant hosts<textarea disabled={!canEdit || loading} rows={5} value={allowedHosts} onChange={(event) => setAllowedHosts(event.target.value)} placeholder={"merchant.example\n*.trusted.example"} /><span className="form-help">One exact host or wildcard subdomain per line. Merchant allowlist mode requires at least one.</span></label>
        <label>Denied merchant hosts<textarea disabled={!canEdit || loading} rows={5} value={deniedHosts} onChange={(event) => setDeniedHosts(event.target.value)} placeholder={"blocked.example\n*.untrusted.example"} /><span className="form-help">Denied hosts always win over allowed hosts.</span></label>
      </div>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input disabled={!canEdit || loading} type="checkbox" checked={policy.requirePurpose} onChange={(event) => setPolicy((current) => ({ ...current, requirePurpose: event.target.checked }))} />Require the agent to provide a purchase purpose</label>
      <div className="inline-notice"><strong>Execution boundary.</strong> AgentPay records a durable no-retry checkpoint before card credentials enter the merchant context. Any ambiguous outcome after that boundary is escalated instead of retried, which prevents duplicate charges.</div>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="form-success" role="status">{message}</div>}
      <div className="button-row"><button className="primary-button" type="button" disabled={!canEdit || loading || saving || selected.status !== "ACTIVE" && policy.mode !== "DISABLED"} onClick={() => void save()}>{saving ? "Saving…" : "Save autonomy policy"}</button>{!canEdit && <span className="form-help">Owner access with recent authentication is required to change autonomous spending.</span>}</div>
    </div>
  </section>;
}
