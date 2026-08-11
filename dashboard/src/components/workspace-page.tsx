import Link from "next/link";
import type { Route } from "next";

export type WorkspaceRow = { id: string; title: string; subtitle: string; meta: string; status: string; href?: Route };

const successStatuses = new Set([
  "ACTIVE", "APPROVED", "COMPLETED", "CONFIRMED", "DELIVERED", "DESTINATION_CONFIRMED",
  "FULFILLED", "HEALTHY", "PAID", "PROCESSED", "PUBLISHED", "SETTLED", "SUCCEEDED", "VERIFIED",
]);
const attentionStatuses = new Set([
  "APPROVAL_PENDING", "AWAITING_APPROVAL", "AWAITING_SIGNATURE", "BRIDGING", "INVITED", "OPEN",
  "PAYMENT_PENDING", "PENDING", "PROCESSING", "PROVISIONING", "QUOTED", "RECEIVED", "RETRY_SCHEDULED",
  "RUNNING", "SENT", "SUBMITTED", "VIEWED", "WAITING_ON_CUSTOMER",
]);
const errorStatuses = new Set([
  "CANCELED", "DECLINED", "DENIED", "DOWN", "ERROR", "FAILED", "FAILED_BEFORE_SUBMISSION",
  "REJECTED", "SETTLEMENT_FAILED", "SUBMISSION_UNKNOWN", "UNAVAILABLE", "UNKNOWN",
]);

function statusClass(status: string) {
  const normalized = status.toUpperCase();
  if (successStatuses.has(normalized)) return "status-settled";
  if (attentionStatuses.has(normalized)) return "status-approval";
  if (errorStatuses.has(normalized)) return "status-error";
  return "status-paused";
}

function readableStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase().replace(/^./, (value) => value.toUpperCase());
}

export function WorkspacePage({ title, description, action, rows, empty, children }: { title: string; description: string; action?: { label: string; href: Route }; rows: WorkspaceRow[]; empty: string; children?: React.ReactNode }) {
  return <div className="page">
    <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action && <Link className="primary-button" href={action.href}>{action.label}</Link>}</div>
    <section className="panel" aria-label={`${title} records`}>
      {rows.length === 0 ? <div className="empty-state"><strong>No records yet</strong><p>{empty}</p></div> : <div className="record-list">{rows.map((row) => {
        const status = readableStatus(row.status);
        const content = <><div><div className="record-title">{row.title}</div><div className="record-subtitle">{row.subtitle}</div></div><div className="record-aside"><span className="record-meta">{row.meta}</span><span className={`status-badge ${statusClass(row.status)}`} aria-label={`Status: ${status}`}>{status}</span></div></>;
        return row.href ? <Link className="record-row" href={row.href} key={row.id}>{content}</Link> : <div className="record-row" key={row.id}>{content}</div>;
      })}</div>}
    </section>
    {children}
  </div>;
}

export function FormPage({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="page"><div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div></div><section className="panel form-panel">{children}</section></div>;
}
