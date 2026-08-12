"use client";

import { useEffect, useState } from "react";

type Binding = {
  masumiAgentIdentifier: string;
  aid: string;
  credentialSaid: string;
  issuerAid: string;
  schemaSaid: string;
  claimsHash: string;
  verifiedAt: string;
  expiresAt?: string | null;
};
type Envelope<T> = { data?: T; detail?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const body = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok) throw new Error(body.detail ?? `Request failed (${response.status}).`);
  return body.data as T;
}

export function VeridianResourceBindingForm({ resourceId, canManage, canRemove }: { resourceId: string; canManage: boolean; canRemove: boolean }) {
  const [binding, setBinding] = useState<Binding | null>(null);
  const [credential, setCredential] = useState("");
  const [expectedAid, setExpectedAid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    try {
      const result = await api<{ binding: Binding | null }>(`/api/v1/resources/${resourceId}/veridian-binding`);
      setBinding(result.binding ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Veridian identity binding.");
    }
  }

  useEffect(() => {
    let active = true;
    void api<{ binding: Binding | null }>(`/api/v1/resources/${resourceId}/veridian-binding`)
      .then((result) => {
        if (active) setBinding(result.binding ?? null);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Could not load Veridian identity binding.");
      });
    return () => { active = false; };
  }, [resourceId]);

  async function verifyAndBind() {
    setBusy(true); setError(""); setMessage("");
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(credential); }
      catch { throw new Error("Paste a valid JSON ACDC credential before verification."); }
      await api(`/api/v1/resources/${resourceId}/veridian-binding`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credential: parsed, ...(expectedAid.trim() ? { expectedAid: expectedAid.trim() } : {}) }),
      });
      setCredential("");
      setMessage("Credential verified by the configured KERIA authority and bound to this Masumi resource identity.");
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Credential verification failed.");
    } finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/v1/resources/${resourceId}/veridian-binding`, { method: "DELETE" });
      setBinding(null);
      setMessage("Veridian/KERI identity binding removed. Policies requiring it will fail closed until a new verified credential is bound.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove Veridian identity binding.");
    } finally { setBusy(false); }
  }

  return <section className="workspace-section">
    <div className="section-heading"><div><h3>Veridian / KERI identity</h3><p>Bind a KERIA-verified ACDC credential to the resource&apos;s already verified Masumi agent identity.</p></div></div>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    {binding ? <>
      <div className="detail-grid">
        <div><span>Agent AID</span><strong>{binding.aid}</strong></div>
        <div><span>Masumi identifier</span><strong>{binding.masumiAgentIdentifier}</strong></div>
        <div><span>Credential SAID</span><strong>{binding.credentialSaid}</strong></div>
        <div><span>Issuer AID</span><strong>{binding.issuerAid}</strong></div>
        <div><span>Schema SAID</span><strong>{binding.schemaSaid}</strong></div>
        <div><span>Verified</span><strong>{new Date(binding.verifiedAt).toLocaleString()}</strong></div>
        <div><span>Expires</span><strong>{binding.expiresAt ? new Date(binding.expiresAt).toLocaleString() : "No verifier expiry reported"}</strong></div>
        <div><span>Claims hash</span><strong>{binding.claimsHash}</strong></div>
      </div>
      {canRemove && <div className="button-row"><button className="danger-button" type="button" disabled={busy} onClick={() => void remove()}>{busy ? "Removing…" : "Remove identity binding"}</button></div>}
    </> : <div className="empty-state"><strong>No KERI credential bound</strong><p>Policies requiring Veridian/KERI identity will deny Masumi escrow spending on this resource until a valid binding exists.</p></div>}

    {canManage && <div className="app-form-section">
      <div className="form-grid">
        <label>Expected subject AID (optional)<input value={expectedAid} onChange={(event) => setExpectedAid(event.target.value)} placeholder="Leave empty to use the credential subject AID" /></label>
      </div>
      <label>ACDC credential JSON<textarea rows={10} value={credential} onChange={(event) => setCredential(event.target.value)} placeholder='{"d":"...","i":"...","s":"...","a":{"i":"...","masumiAgentIdentifier":"..."}}' /></label>
      <p className="form-help">Recent authentication is required. The server verifies the credential through the configured KERIA endpoint, checks deployment issuer/schema allowlists, revocation/expiry, and requires its Masumi identifier claim to match this resource.</p>
      <button className="secondary-button" type="button" disabled={busy || !credential.trim()} onClick={() => void verifyAndBind()}>{busy ? "Verifying…" : binding ? "Replace verified credential" : "Verify and bind credential"}</button>
    </div>}
  </section>;
}
