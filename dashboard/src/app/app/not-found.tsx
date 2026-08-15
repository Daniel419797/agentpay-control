import Link from "next/link";
import { SearchX } from "lucide-react";

export default function DashboardNotFound() {
  return (
    <div className="dashboard-state">
      <section className="dashboard-state-card">
        <div className="route-state-symbol"><SearchX size={30} aria-hidden="true" /></div>
        <p className="route-state-code">404 · Record not found</p>
        <h1>We could not find this dashboard page.</h1>
        <p>The record may have been removed, the address may be outdated, or it may belong to a different workspace.</p>
        <div className="route-state-actions">
          <Link className="route-state-primary" href="/app/overview">Back to Overview</Link>
          <Link className="route-state-secondary" href="/app/agents">View agents</Link>
        </div>
      </section>
    </div>
  );
}
