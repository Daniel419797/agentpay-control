"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { kind: "anomaly" | "recommendation"; id: string };

export function IntelligenceActions({ kind, id }: Props) {
  const router = useRouter(); const [busy, setBusy] = useState<string>(); const [error, setError] = useState<string>();
  async function update(action: string) {
    setBusy(action); setError(undefined);
    const endpoint = kind === "anomaly" ? `/api/v1/intelligence/anomalies/${id}` : `/api/v1/intelligence/recommendations/${id}`;
    const body = kind === "anomaly" ? { status: action } : { action };
    const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!response.ok) { const payload = await response.json().catch(() => null) as { detail?: string } | null; setError(payload?.detail ?? "The update could not be completed."); setBusy(undefined); return; }
    router.refresh();
  }
  return <div className="inline-actions">{kind === "anomaly" ? <><button disabled={Boolean(busy)} onClick={() => void update("ACKNOWLEDGED")}>Acknowledge</button><button disabled={Boolean(busy)} onClick={() => void update("RESOLVED")}>Resolve</button></> : <><button disabled={Boolean(busy)} onClick={() => void update("ACCEPT")}>Create draft</button><button disabled={Boolean(busy)} onClick={() => void update("DISMISS")}>Dismiss</button></>}{error && <span role="alert">{error}</span>}</div>;
}
