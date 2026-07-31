"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApprovalActions({ approvalId, status }: { approvalId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState("");
  const isPending = status === "PENDING";

  async function vote(decision: "APPROVE" | "REJECT") {
    setLoading(decision);
    setError("");
    try {
      const response = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
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
      setLoading(null);
    }
  }

  if (!isPending) return null;

  return (
    <div className="button-row" style={{ marginTop: 18 }}>
      {error && <div className="form-error" style={{ width: "100%", marginBottom: 8 }}>{error}</div>}
      <button className="primary-button" disabled={loading !== null} onClick={() => void vote("APPROVE")}>
        {loading === "APPROVE" ? "Approving…" : "Approve"}
      </button>
      <button className="secondary-button" disabled={loading !== null} onClick={() => void vote("REJECT")} style={{ marginLeft: 8 }}>
        {loading === "REJECT" ? "Rejecting…" : "Reject"}
      </button>
    </div>
  );
}
