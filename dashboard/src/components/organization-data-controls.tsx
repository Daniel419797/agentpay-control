"use client";

import { useEffect, useState } from "react";

type DeletionRequest = {
  id: string;
  status: "REQUESTED" | "PROCESSING" | "COMPLETED" | "CANCELED" | string;
  requestedAt: string;
  scheduledFor: string;
  canceledAt?: string | null;
  completedAt?: string | null;
};

type Envelope<T> = { data?: T; detail?: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({})) as Envelope<T>;
  if (!response.ok) throw new Error(payload.detail ?? `Request failed (${response.status}).`);
  return payload.data as T;
}

function deletionIsActive(value: DeletionRequest | null) {
  return value?.status === "REQUESTED" || value?.status === "PROCESSING";
}

export function OrganizationDataControls({ organizationSlug, isOwner }: { organizationSlug: string; isOwner: boolean }) {
  const [deletion, setDeletion] = useState<DeletionRequest | null>(null);
  const [slugConfirmation, setSlugConfirmation] = useState("");
  const [phraseConfirmation, setPhraseConfirmation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refreshDeletion() {
    if (!isOwner) return;
    try {
      const row = await api<DeletionRequest | null>("/api/v1/organization/deletion");
      setDeletion(row ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load workspace deletion status.");
    }
  }

  useEffect(() => { void refreshDeletion(); }, [isOwner]);

  async function downloadExport() {
    setBusy("export"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/organization/export", { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as Envelope<unknown>;
        throw new Error(payload.detail ?? `Export failed (${response.status}).`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `agentpay-${organizationSlug}-export.json`;
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      setMessage("Organization export generated. Credential-bearing destinations and encrypted secrets are excluded or redacted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Organization export failed.");
    } finally {
      setBusy(null);
    }
  }

  async function requestDeletion() {
    setBusy("delete"); setError(""); setMessage("");
    try {
      const row = await api<DeletionRequest>("/api/v1/organization/deletion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmSlug: slugConfirmation, confirmation: phraseConfirmation }),
      });
      setDeletion(row);
      setSlugConfirmation("");
      setPhraseConfirmation("");
      setMessage("Workspace deletion requested. The emergency stop is active and deletion remains cancelable until processing begins.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Workspace deletion request failed.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelDeletion() {
    setBusy("cancel-delete"); setError(""); setMessage("");
    try {
      await api("/api/v1/organization/deletion", { method: "DELETE" });
      await refreshDeletion();
      setMessage("Deletion request canceled. Previously revoked agent credentials must be reissued and notification endpoints remain paused until explicitly reactivated.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Deletion cancellation failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!isOwner) return <section className="panel">
    <h2 className="panel-title">Organization data</h2>
    <p className="panel-description">Organization export and deletion controls require Owner access and recent authentication.</p>
  </section>;

  const activeDeletion = deletionIsActive(deletion);
  const canConfirm = slugConfirmation === organizationSlug && phraseConfirmation === "DELETE MY AGENTPAY WORKSPACE";

  return <section className="panel danger-zone" aria-labelledby="organization-data-title">
    <div style={{ width: "100%" }}>
      <h2 className="panel-title" id="organization-data-title">Organization data and deletion</h2>
      <p className="panel-description">Export a redacted workspace archive or schedule deletion. Both operations require recent authentication.</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      {message && <div className="form-success" role="status">{message}</div>}

      <div className="button-row" style={{ marginTop: 12 }}>
        <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void downloadExport()}>{busy === "export" ? "Preparing export…" : "Download organization export"}</button>
      </div>

      {deletion && <div className="detail-grid" style={{ marginTop: 18 }}>
        <div><span>Deletion status</span><strong>{deletion.status.replaceAll("_", " ")}</strong></div>
        <div><span>Requested</span><strong>{new Date(deletion.requestedAt).toLocaleString()}</strong></div>
        <div><span>Scheduled</span><strong>{new Date(deletion.scheduledFor).toLocaleString()}</strong></div>
      </div>}

      {activeDeletion ? <div style={{ marginTop: 16 }}>
        <p className="form-help">The workspace is contained while deletion is pending. Canceling does not restore revoked credentials or automatically reactivate notification endpoints.</p>
        {deletion?.status === "REQUESTED" && <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void cancelDeletion()}>{busy === "cancel-delete" ? "Canceling…" : "Cancel deletion request"}</button>}
        {deletion?.status === "PROCESSING" && <div className="form-error" role="status">Deletion processing has started and can no longer be canceled from the application.</div>}
      </div> : <div className="app-form-section" style={{ marginTop: 18 }}>
        <h3>Schedule workspace deletion</h3>
        <p className="form-help">This immediately enables the emergency stop, pauses active agents, revokes agent credentials, pauses notification endpoints, and cancels eligible unsubmitted work. Final deletion is scheduled after the server-defined safety window.</p>
        <div className="form-grid">
          <label>Type workspace slug <strong>{organizationSlug}</strong><input value={slugConfirmation} onChange={(event) => setSlugConfirmation(event.target.value)} autoComplete="off" /></label>
          <label>Type DELETE MY AGENTPAY WORKSPACE<input value={phraseConfirmation} onChange={(event) => setPhraseConfirmation(event.target.value)} autoComplete="off" /></label>
        </div>
        <button className="danger-button" type="button" disabled={Boolean(busy) || !canConfirm} onClick={() => void requestDeletion()}>{busy === "delete" ? "Scheduling deletion…" : "Schedule workspace deletion"}</button>
      </div>}
    </div>
  </section>;
}
