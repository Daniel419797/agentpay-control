"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ApprovalActions({ approvalId, status, canDecide, canApprove }: { approvalId: string; status: string; canDecide: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"APPROVE" | "REJECT" | null>(null);
  const [error, setError] = useState("");
  const isPending = status === "PENDING";

  async function vote(decision: "APPROVE" | "REJECT") {
    if (!canDecide || (decision === "APPROVE" && !canApprove)) return;
    setLoading(decision);
    setError("");
    try {
      const response = await fetch(`/api/v1/approvals/${approvalId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const body = await response.json().catch(() => null) as { detail?: string; error?: { message?: string } } | null;
      if (!response.ok) {
        setError(body?.detail ?? body?.error?.message ?? `Request failed (${response.status})`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Refresh the approval before retrying so you do not act on stale state.");
    } finally {
      setLoading(null);
    }
  }

  if (!isPending || !canDecide) return null;

  return (
    <div className="button-row" style={{ marginTop: 18 }}>
      {error && <div className="form-error" role="alert" style={{ width: "100%", marginBottom: 8 }}>{error}</div>}
      {canApprove && <button className="primary-button" type="button" disabled={loading !== null} onClick={() => void vote("APPROVE")}>
        {loading === "APPROVE" ? "Approving…" : "Approve"}
      </button>}
      <button className="secondary-button" type="button" disabled={loading !== null} onClick={() => void vote("REJECT")}>
        {loading === "REJECT" ? "Rejecting…" : "Reject"}
      </button>
    </div>
  );
}
