"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ProviderOption = { id: string; label: string; verificationStatus: string };
type AssetOption = { id: string; label: string };

async function mutate(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json() as { detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? "The request could not be completed.");
}

export function MarketplaceOperations({ providers, assets }: { providers: ProviderOption[]; assets: AssetOption[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function run(key: string, operation: () => Promise<void>, success: string) {
    setBusy(key); setError(""); setMessage("");
    try {
      await operation();
      setMessage(success);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  async function registerProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await run("provider", () => mutate("/api/v1/providers", {
      name: String(form.get("name")).trim(),
      publicSlug: String(form.get("publicSlug")).trim().toLowerCase(),
      description: String(form.get("description")).trim(),
      websiteUrl: String(form.get("websiteUrl")).trim(),
      supportEmail: String(form.get("supportEmail")).trim(),
      termsUrl: String(form.get("termsUrl")).trim(),
      privacyUrl: String(form.get("privacyUrl")).trim(),
      settlementAccountId: String(form.get("settlementAccountId")).trim(),
    }), "Provider registered. Verify its settlement account before publishing.");
  }

  async function registerResource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const providerId = String(form.get("providerId"));
    const tags = String(form.get("tags")).split(",").map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    await run("resource", () => mutate(`/api/v1/providers/${providerId}/resources`, {
      category: String(form.get("category")),
      name: String(form.get("name")).trim(),
      slug: String(form.get("slug")).trim().toLowerCase(),
      description: String(form.get("description")).trim(),
      endpoint: String(form.get("endpoint")).trim(),
      assetId: String(form.get("assetId")),
      atomicAmount: String(form.get("atomicAmount")).trim(),
      inputSchema: { type: "object" },
      outputContentTypes: [String(form.get("contentType")).trim()],
      tags,
      termsUrl: String(form.get("resourceTermsUrl")).trim() || undefined,
      public: form.get("public") === "on",
    }), "Resource registered.");
  }

  return <section className="panel section-gap">
    <div className="panel-header"><div><h2 className="panel-title">Marketplace operations</h2><p className="panel-description">Register a provider, prove the settlement account, then publish a priced x402 resource.</p></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    <div className="page-grid">
      <form className="app-form" onSubmit={registerProvider}>
        <h3>Register provider</h3>
        <div className="form-grid">
          <label>Name<input name="name" minLength={2} maxLength={100} required /></label>
          <label>Public slug<input name="publicSlug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
          <label>Website<input name="websiteUrl" type="url" required /></label>
          <label>Support email<input name="supportEmail" type="email" required /></label>
          <label>Settlement account<input name="settlementAccountId" pattern="0\.0\.[0-9]+" placeholder="0.0.1234" required /></label>
          <label>Terms URL<input name="termsUrl" type="url" required /></label>
          <label>Privacy URL<input name="privacyUrl" type="url" required /></label>
        </div>
        <label>Description<textarea name="description" minLength={20} maxLength={1000} required /></label>
        <button className="secondary-button" type="submit" disabled={Boolean(busy)}>{busy === "provider" ? "Registering…" : "Register provider"}</button>
      </form>
      <div className="app-form">
        <h3>Settlement verification</h3>
        {providers.length ? <div className="operation-list">{providers.map((provider) => <div className="operation-row" key={provider.id}>
          <div><strong>{provider.label}</strong><span>{provider.verificationStatus}</span></div>
          {provider.verificationStatus !== "VERIFIED" && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void run(`verify:${provider.id}`, () => mutate(`/api/v1/providers/${provider.id}/verify`), "Provider settlement account verified.")}>Verify</button>}
        </div>)}</div> : <p className="panel-description">No organization providers are registered.</p>}
      </div>
    </div>
    <form className="app-form section-gap" onSubmit={registerResource}>
      <h3>Register x402 resource</h3>
      <div className="form-grid">
        <label>Provider<select name="providerId" required>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
        <label>Category<select name="category" defaultValue="MARKET_DATA"><option value="MARKET_DATA">Market data</option><option value="FILE">File</option><option value="AI_INFERENCE">AI inference</option><option value="WEB_RESEARCH">Web research</option></select></label>
        <label>Name<input name="name" minLength={2} maxLength={120} required /></label>
        <label>Slug<input name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></label>
        <label>Endpoint<input name="endpoint" type="url" required /></label>
        <label>Price asset<select name="assetId" required>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.label}</option>)}</select></label>
        <label>Atomic price<input name="atomicAmount" inputMode="numeric" pattern="[0-9]+" required /></label>
        <label>Response content type<input name="contentType" defaultValue="application/json" required /></label>
        <label>Tags<input name="tags" placeholder="market-data, realtime" /></label>
        <label>Resource terms URL<input name="resourceTermsUrl" type="url" /></label>
      </div>
      <label>Description<textarea name="description" minLength={20} maxLength={2000} required /></label>
      <label className="checkbox-label"><input name="public" type="checkbox" /> Publish after verification</label>
      <button className="primary-button" type="submit" disabled={!providers.length || !assets.length || Boolean(busy)}>{busy === "resource" ? "Registering…" : "Register resource"}</button>
    </form>
  </section>;
}
