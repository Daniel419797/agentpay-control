import Link from "next/link";
import type { Route } from "next";

export type WorkspaceRow = { id: string; title: string; subtitle: string; meta: string; status: string; href?: Route };

export function WorkspacePage({ title, description, action, rows, empty, children }: { title: string; description: string; action?: { label: string; href: Route }; rows: WorkspaceRow[]; empty: string; children?: React.ReactNode }) {
  return <div className="page">
    <div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action && <Link className="primary-button" href={action.href}>{action.label}</Link>}</div>
    <section className="panel">
      {rows.length === 0 ? <div className="empty-state"><strong>No records yet</strong><p>{empty}</p></div> : <div className="record-list">{rows.map((row) => {
        const content = <><div><div className="record-title">{row.title}</div><div className="record-subtitle">{row.subtitle}</div></div><div className="record-aside"><span className="record-meta">{row.meta}</span><span className="status-badge status-settled">{row.status}</span></div></>;
        return row.href ? <Link className="record-row" href={row.href} key={row.id}>{content}</Link> : <div className="record-row" key={row.id}>{content}</div>;
      })}</div>}
    </section>
    {children}
  </div>;
}

export function FormPage({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <div className="page"><div className="page-heading"><div><h1>{title}</h1><p>{description}</p></div></div><section className="panel form-panel">{children}</section></div>;
}
