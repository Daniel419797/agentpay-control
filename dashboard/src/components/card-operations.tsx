"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; label: string };
type CardOption = { id: string; label: string; status: string; version: number };
type FiatAccountOption = { id: string; label: string; currency: string; status: string };

async function apiRequest(path: string, body: unknown, method = "POST") {
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? "The request could not be completed.");
}

export function CardOperations({
  enabled,
  provider,
  canOpenFiatAccount,
  agents,
  cardholders,
  cards,
  fiatAccounts,
}: {
  enabled: boolean;
  provider: "SANDBOX" | "STRIPE";
  canOpenFiatAccount: boolean;
  agents: Option[];
  cardholders: Option[];
  cards: CardOption[];
  fiatAccounts: FiatAccountOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function createCardholder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("cardholder"); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/api/v1/cardholders", {
        name: String(form.get("name")).trim(),
        firstName: String(form.get("firstName")).trim(),
        lastName: String(form.get("lastName")).trim(),
        email: String(form.get("email")).trim(),
        phone: String(form.get("phone")).trim() || undefined,
        address: { line1: String(form.get("line1")).trim(), city: String(form.get("city")).trim(), state: String(form.get("state")).trim() || undefined, postalCode: String(form.get("postalCode")).trim(), country: String(form.get("country")).trim().toUpperCase() },
      });
      setMessage("Cardholder created. Reloading available cardholders.");
      event.currentTarget.reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The cardholder could not be created."); }
    finally { setBusy(null); }
  }

  async function issueCard(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("card"); setError(""); setMessage("");
    const form = new FormData(event.currentTarget); const limit = String(form.get("spendingLimitMinor")).trim();
    try {
      await apiRequest("/api/v1/cards", { agentId: String(form.get("agentId")), cardholderProfileId: String(form.get("cardholderProfileId")), currency: String(form.get("currency")).trim().toUpperCase(), nickname: String(form.get("nickname")).trim() || undefined, spendingLimitMinor: limit || undefined, spendingInterval: limit ? String(form.get("spendingInterval")) : undefined, allowedCategories: [], blockedCategories: [], allowedCountries: [] });
      setMessage("Virtual card issued."); event.currentTarget.reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The virtual card could not be issued."); }
    finally { setBusy(null); }
  }

  async function changeCardStatus(card: CardOption, status: "ACTIVE" | "FROZEN" | "CANCELED") {
    if (status === "CANCELED" && !window.confirm(`Cancel ${card.label} permanently? A canceled card cannot be reactivated.`)) return;
    setBusy(`card:${card.id}`); setError(""); setMessage("");
    try {
      await apiRequest(`/api/v1/cards/${card.id}/status`, { status, expectedVersion: card.version }, "PATCH");
      setMessage(status === "CANCELED" ? `Card ${card.label} canceled permanently.` : `Card ${card.label} is now ${status.toLowerCase()}.`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The card status could not be changed."); }
    finally { setBusy(null); }
  }

  async function openFiatAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canOpenFiatAccount) return;
    setBusy("fiat-account"); setError(""); setMessage("");
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest("/api/v1/fiat-accounts", { currency: String(form.get("currency")).trim().toUpperCase(), displayName: String(form.get("displayName")).trim() });
      setMessage("Fiat operating account opened."); event.currentTarget.reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The fiat account could not be opened."); }
    finally { setBusy(null); }
  }

  async function createFiatTransfer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("fiat-transfer"); setError(""); setMessage("");
    const form = new FormData(event.currentTarget); const account = fiatAccounts.find((item) => item.id === String(form.get("fiatAccountId")));
    try {
      await apiRequest("/api/v1/fiat-transfers", { fiatAccountId: String(form.get("fiatAccountId")), direction: String(form.get("direction")), amountMinor: String(form.get("amountMinor")).trim(), currency: account?.currency ?? String(form.get("currency")).trim().toUpperCase(), instrumentId: String(form.get("instrumentId")).trim(), description: String(form.get("description")).trim() || undefined });
      setMessage("Fiat transfer submitted. Its provider state will be reconciled before AgentPay treats it as final."); event.currentTarget.reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The fiat transfer could not be submitted."); }
    finally { setBusy(null); }
  }

  return <section className="panel section-gap">
    <div className="panel-header"><div><h2 className="panel-title">Card & fiat operations</h2><p className="panel-description">Provider: {provider}. High-risk provisioning and reactivation require recent authentication.</p></div></div>
    {!enabled && <div className="inline-notice">Virtual card and fiat creation are disabled in this environment. Production enablement requires an approved live provider configuration.</div>}
    {provider === "SANDBOX" && <div className="inline-notice">Sandbox operations create test provider records only. Do not present these cards or balances as live funds.</div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    <div className="page-grid">
      <form className="app-form" onSubmit={createCardholder}>
        <h3>New cardholder</h3>
        <div className="form-grid">
          <label>Display name<input name="name" minLength={2} required /></label><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" required /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Phone<input name="phone" type="tel" autoComplete="tel" /></label><label>Address<input name="line1" minLength={3} autoComplete="street-address" required /></label><label>City<input name="city" minLength={2} autoComplete="address-level2" required /></label><label>State / region<input name="state" autoComplete="address-level1" /></label><label>Postal code<input name="postalCode" minLength={2} autoComplete="postal-code" required /></label><label>Country code<input name="country" minLength={2} maxLength={2} placeholder="US" autoComplete="country" required /></label>
        </div>
        <button className="secondary-button" type="submit" disabled={!enabled || Boolean(busy)}>{busy === "cardholder" ? "Creating…" : "Create cardholder"}</button>
      </form>
      <form className="app-form" onSubmit={issueCard}>
        <h3>Issue virtual card</h3>
        <label>Agent<select name="agentId" required>{agents.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><label>Cardholder<select name="cardholderProfileId" required>{cardholders.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
        <div className="form-grid"><label>Currency<input name="currency" defaultValue="USD" minLength={3} maxLength={3} required /></label><label>Nickname<input name="nickname" maxLength={60} /></label><label>Limit in minor units<input name="spendingLimitMinor" inputMode="numeric" pattern="[0-9]*" placeholder="50000" /></label><label>Limit interval<select name="spendingInterval" defaultValue="monthly"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="all_time">All time</option></select></label></div>
        <button className="primary-button" type="submit" disabled={!enabled || !agents.length || !cardholders.length || Boolean(busy)}>{busy === "card" ? "Issuing…" : "Issue virtual card"}</button>
      </form>
    </div>
    <div className="page-grid section-gap">
      <div className="app-form"><h3>Card lifecycle</h3>{cards.length ? <div className="operation-list">{cards.map((card) => <div className="operation-row" key={card.id}><div><strong>{card.label}</strong><span>{card.status}</span></div><div className="rule-actions">{card.status === "ACTIVE" && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void changeCardStatus(card, "FROZEN")}>Freeze</button>}{card.status === "FROZEN" && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void changeCardStatus(card, "ACTIVE")}>Activate</button>}{card.status !== "CANCELED" && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => void changeCardStatus(card, "CANCELED")}>Cancel</button>}</div></div>)}</div> : <p className="panel-description">Issue a card to enable lifecycle controls.</p>}</div>
      {canOpenFiatAccount ? <form className="app-form" onSubmit={openFiatAccount}><h3>Open fiat account</h3><label>Account name<input name="displayName" minLength={2} maxLength={50} placeholder="Agent operating account" required /></label><label>Currency<input name="currency" defaultValue="USD" minLength={3} maxLength={3} required /></label><button className="secondary-button" type="submit" disabled={!enabled || Boolean(busy)}>{busy === "fiat-account" ? "Opening…" : "Open account"}</button></form> : <div className="app-form"><h3>Open fiat account</h3><p className="panel-description">Opening a new fiat account requires Owner access and recent authentication.</p></div>}
    </div>
    <form className="app-form section-gap" onSubmit={createFiatTransfer}><h3>Move fiat</h3><div className="form-grid"><label>Fiat account<select name="fiatAccountId" required>{fiatAccounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label><label>Direction<select name="direction" defaultValue="DEPOSIT"><option value="DEPOSIT">Deposit</option><option value="WITHDRAWAL">Withdrawal</option></select></label><label>Amount in minor units<input name="amountMinor" inputMode="numeric" pattern="[0-9]+" placeholder="50000" required /></label><label>Payment instrument ID<input name="instrumentId" minLength={4} maxLength={200} autoComplete="off" required /></label><label>Description<input name="description" maxLength={200} /></label><input name="currency" type="hidden" value={fiatAccounts[0]?.currency ?? "USD"} readOnly /></div><p className="panel-description">Instrument identifiers are encrypted at rest and retained only for idempotent recovery. Ambiguous provider outcomes remain pending reconciliation and must not be retried with a new idempotency key.</p><button className="primary-button" type="submit" disabled={!enabled || !fiatAccounts.some((account) => account.status === "ACTIVE") || Boolean(busy)}>{busy === "fiat-transfer" ? "Submitting…" : "Submit transfer"}</button></form>
  </section>;
}
