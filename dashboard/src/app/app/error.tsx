"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { useEffect } from "react";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("AgentPay dashboard route error", error);
  }, [error]);

  return (
    <div className="dashboard-state">
      <section className="dashboard-state-card" role="alert">
        <div className="route-state-symbol"><AlertTriangle size={30} aria-hidden="true" /></div>
        <p className="route-state-code">Operation unavailable</p>
        <h1>This dashboard view could not be loaded.</h1>
        <p>Your workspace is still intact. Retry the request, or return to Overview and continue from a known state.</p>
        <div className="route-state-actions">
          <button className="route-state-primary" type="button" onClick={reset}><RefreshCcw size={15} aria-hidden="true" />Retry</button>
          <Link className="route-state-secondary" href="/app/overview">Back to Overview</Link>
        </div>
        {error.digest && <div className="route-state-digest">Reference: {error.digest}</div>}
      </section>
    </div>
  );
}
