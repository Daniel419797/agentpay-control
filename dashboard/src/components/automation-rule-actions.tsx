"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AutomationRuleActions({ ruleId, status, version, triggerType }: { ruleId: string; status: string; version: number; triggerType: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function post(path: string, body: unknown, idempotent = false, method = "POST") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, { method, headers: { "content-type": "application/json", ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: JSON.stringify(body) });
      const payload = await response.json() as { detail?: string };
      if (!response.ok) throw new Error(payload.detail ?? "The rule could not be updated.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The rule could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="rule-actions">
    {error && <span className="inline-error">{error}</span>}
    {status !== "ARCHIVED" && <button className="secondary-button compact-button" type="button" disabled={busy} onClick={() => void post(`/api/v1/automations/${ruleId}/status`, { status: status === "ACTIVE" ? "PAUSED" : "ACTIVE", expectedVersion: version }, false, "PATCH")}>{status === "ACTIVE" ? "Pause" : "Activate"}</button>}
    {status === "ACTIVE" && triggerType === "MANUAL" && <button className="primary-button compact-button" type="button" disabled={busy} onClick={() => void post(`/api/v1/automations/${ruleId}/execute`, {}, true)}>Run now</button>}
  </div>;
}
