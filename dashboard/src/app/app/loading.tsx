export default function DashboardLoading() {
  return (
    <div className="dashboard-loading" role="status" aria-live="polite" aria-label="Loading payment operations">
      <div className="dashboard-loading-heading" aria-hidden="true">
        <span className="skeleton-line" />
        <span className="skeleton-line" />
      </div>
      <div className="dashboard-skeleton-metrics" aria-hidden="true">
        <div className="dashboard-skeleton-card" />
        <div className="dashboard-skeleton-card" />
        <div className="dashboard-skeleton-card" />
        <div className="dashboard-skeleton-card" />
      </div>
      <div className="dashboard-skeleton-grid" aria-hidden="true">
        <div className="dashboard-skeleton-panel" />
        <div className="dashboard-skeleton-panel" />
      </div>
      <span className="sr-only">Loading payment operations…</span>
    </div>
  );
}
