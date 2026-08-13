"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { INTEGRATION_META, INTEGRATION_TYPES, integrationCredentialLabel, type IntegrationType } from "@/lib/agent-integration";

type Credential = { id: string; label: string; prefix: string; scopes: string[]; status: string; expiresAt: Date | string | null; lastUsedAt: Date | string | null; createdAt: Date | string };
type CreatedCredential = Credential & { secret: string };

type Props = {
  agentId: string;
  existing: Credential[];
  defaultLabel?: string;
  defaultScopes?: string[];
  createLabel?: string;
};

const standardScopes = ["payments:create", "payments:read"];
const integrationScopes = ["payments:create", "payments:read", "resources:read"];

export function CredentialManager({ agentId, existing, defaultLabel, defaultScopes, createLabel }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const integrationScreen = pathname.endsWith("/integrations");
  const requestedType = searchParams.get("type") as IntegrationType | null;
  const integrationType: IntegrationType = requestedType && INTEGRATION_TYPES.includes(requestedType) ? requestedType : "CLAUDE_CODE";
  const initialLabel = defaultLabel ?? (integrationScreen ? integrationCredentialLabel(integrationType, INTEGRATION_META[integrationType].name) : "");
  const initialScopes = defaultScopes ?? (integrationScreen ? integrationScopes : standardScopes);
  const buttonLabel = createLabel ?? (integrationScreen ? `Create ${INTEGRATION_META[integrationType].name} connection` : "Create credential");

  const [showForm, setShowForm] = useState(Boolean(initialLabel));
  const [label, setLabel] = useState(initialLabel);
  const [scopes, setScopes] = useState<string[]>(initialScopes);
  const [created, setCreated] = useState<CreatedCredential | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!integrationScreen || defaultLabel || defaultScopes) return;
    setLabel(integrationCredentialLabel(integrationType, INTEGRATION_META[integrationType].name));
    setScopes(integrationScopes);
    setShowForm(true);
    setError("");
  }, [defaultLabel, defaultScopes, integrationScreen, integrationType]);

  function resetForm() {
    setLabel(initialLabel);
    setScopes(initialScopes);
    setError("");
  }

  async function create() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/agents/${agentId}/credentials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label, scopes }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? body?.detail ?? `Request failed (${response.status})`);
        return;
      }
      const body = await response.json() as { data: CreatedCredential };
      setCreated(body.data);
      setShowForm(false);
      resetForm();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this credential? The agent will lose access.")) return;
    const response = await fetch(`/api/v1/agents/${agentId}/credentials/${id}`, { method: "DELETE" });
    if (response.ok) router.refresh();
  }

  function toggleScope(scope: string) {
    setScopes((prev) => prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]);
  }

  return (
    <>
      {created && (
        <div className="panel" style={{ marginBottom: 18, border: "1px solid var(--color-success, #22c55e)", borderRadius: 8, padding: 16 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Credential created — copy the secret now, it won&apos;t be shown again.</div>
          <div style={{ fontFamily: "monospace", background: "var(--color-surface, #f5f5f5)", padding: 12, borderRadius: 6, wordBreak: "break-all", fontSize: 13 }}>
            {created.secret}
          </div>
          <button className="secondary-button" style={{ marginTop: 10 }} onClick={() => { void navigator.clipboard.writeText(created.secret); }}>Copy to clipboard</button>
          <button className="ghost-link" style={{ marginLeft: 10 }} onClick={() => setCreated(null)}>Dismiss</button>
        </div>
      )}

      {existing.length > 0 && (
        <div className="record-list" style={{ marginBottom: 18 }}>
          {existing.map((cred) => (
            <div className="record-row" key={cred.id} style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div className="record-title">{cred.label}</div>
                <div className="record-subtitle">{cred.prefix}… &middot; {cred.scopes.join(", ")} &middot; {cred.status}</div>
              </div>
              {cred.status !== "REVOKED" && (
                <button className="secondary-button" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => void revoke(cred.id)}>Revoke</button>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Label</label>
            <input className="form-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. production-agent-key" />
          </div>
          <div>
            <label style={{ display: "block", fontSize: 13, marginBottom: 4 }}>Scopes</label>
            <div style={{ display: "flex", gap: 12 }}>
              {["payments:create", "payments:read", "resources:read"].map((scope) => (
                <label key={scope} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
                  <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />{scope}
                </label>
              ))}
            </div>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          {!label && <div className="form-error">Enter a label to continue.</div>}
          <div className="button-row">
            <button className="primary-button" disabled={loading || scopes.length === 0} onClick={() => { if (!label) { setError("Enter a label for this credential."); return; } void create(); }}>
              {loading ? "Creating…" : buttonLabel}
            </button>
            <button className="secondary-button" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="primary-button" onClick={() => setShowForm(true)}>{buttonLabel}</button>
      )}
    </>
  );
}
