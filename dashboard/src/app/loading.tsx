import Image from "next/image";

export default function Loading() {
  return (
    <div className="route-state-page" role="status" aria-live="polite" aria-label="Loading AgentPay">
      <div className="public-loading-card">
        <div className="public-loading-top">
          <Image src="/brand/agentpay-lockup.png" alt="AgentPay" width={166} height={34} priority />
          <div className="public-loading-nav" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
        </div>
        <div className="public-loading-hero" aria-hidden="true">
          <div className="public-loading-copy">
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
          </div>
          <div className="public-loading-art" />
        </div>
        <span className="sr-only">Loading AgentPay…</span>
      </div>
    </div>
  );
}
