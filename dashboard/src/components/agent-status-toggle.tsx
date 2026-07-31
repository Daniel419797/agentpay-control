"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function AgentStatusToggle({ agentId, currentStatus }: { agentId: string; currentStatus: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isPaused = currentStatus === "PAUSED";
  const nextStatus = isPaused ? "ACTIVE" : "PAUSED";
  const label = isPaused ? "Resume" : "Pause";

  async function toggle() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/agents/${agentId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? `Request failed (${response.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="secondary-button" disabled={loading} onClick={() => void toggle()}>
        {loading ? "Updating…" : label}
      </button>
      {error && <div className="form-error" style={{ width: "100%", marginTop: 8 }}>{error}</div>}
    </>
  );
}
