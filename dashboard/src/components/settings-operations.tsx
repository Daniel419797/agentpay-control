"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = { id: string; email: string | null; displayName: string; roles: string[]; status: string };
type Endpoint = { id: string; name: string; type: string; destination: string; status: string };
type Retention = { auditDays: number; financialRecordDays: number; fulfillmentBodyDays: number; notificationDays: number };

async function request(path: string, method: string, body?: unknown) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json() as { detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? "The request could not be completed.");
}

export function SettingsOperations({
  organization,
  members,
  endpoints,
  retention,
}: {
  organization: { name: string; timezone: string; slug: string; killSwitchEnabled: boolean };
  members: Member[];
  endpoints: Endpoint[];
  retention: Retention;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function run(key: string, operation: () => Promise<void>, success: string) {
    setBusy(key); setError(""); setMessage("");
    try {
      await operation();
      setMessage(success);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The operation could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="settings-stack">
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    <div className="page-grid">
      <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run("organization", () => request("/api/v1/organization", "PATCH", { name: String(form.get("name")).trim(), timezone: String(form.get("timezone")).trim() }), "Organization updated.");
      }}>
        <h2 className="panel-title">Organization</h2>
        <label>Name<input name="name" defaultValue={organization.name} minLength={2} maxLength={100} required /></label>
        <label>Timezone<input name="timezone" defaultValue={organization.timezone} maxLength={80} required /></label>
        <label>Slug<input value={organization.slug} readOnly /></label>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "organization" ? "Saving…" : "Save organization"}</button>
      </form>
      <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run("member", () => request("/api/v1/members", "POST", { email: String(form.get("email")).trim(), roles: [String(form.get("role"))] }), "Member invitation queued.");
      }}>
        <h2 className="panel-title">Invite member</h2>
        <label>Email<input name="email" type="email" required /></label>
        <label>Role<select name="role"><option value="OPERATOR">Operator</option><option value="APPROVER">Approver</option><option value="VIEWER">Viewer</option><option value="PROVIDER_ADMIN">Provider admin</option><option value="OWNER">Owner</option></select></label>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "member" ? "Inviting…" : "Invite member"}</button>
      </form>
    </div>
    <section className="panel">
      <div className="panel-header"><h2 className="panel-title">Members</h2></div>
      <div className="record-list">{members.map((member) => <div className="record-row" key={member.id}><div><div className="record-title">{member.displayName}</div><div className="record-subtitle">{member.email ?? "Wallet operator"} · {member.roles.join(", ")}</div></div><div className="rule-actions"><span className="status-badge status-settled">{member.status}</span>{member.status === "ACTIVE" && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => void run(`member:${member.id}`, () => request(`/api/v1/members/${member.id}`, "PATCH", { status: "SUSPENDED" }), "Member suspended.")}>Suspend</button>}</div></div>)}</div>
    </section>
    <div className="page-grid">
      <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run("endpoint", () => request("/api/v1/notification-endpoints", "POST", { name: String(form.get("name")).trim(), type: String(form.get("type")), destination: String(form.get("destination")).trim(), eventTypes: String(form.get("eventTypes")).split(",").map((value) => value.trim()).filter(Boolean) }), "Notification endpoint created.");
      }}>
        <h2 className="panel-title">Notification endpoint</h2>
        <label>Name<input name="name" minLength={2} required /></label>
        <label>Channel<select name="type"><option value="EMAIL">Email</option><option value="WEBHOOK">Webhook</option><option value="SLACK">Slack</option></select></label>
        <label>Destination<input name="destination" required /></label>
        <label>Events<input name="eventTypes" defaultValue="*" required /></label>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "endpoint" ? "Creating…" : "Create endpoint"}</button>
      </form>
      <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const number = (name: string) => Number(form.get(name));
        void run("retention", () => request("/api/v1/organization/retention", "PUT", { auditDays: number("auditDays"), financialRecordDays: number("financialRecordDays"), fulfillmentBodyDays: number("fulfillmentBodyDays"), notificationDays: number("notificationDays") }), "Retention policy updated.");
      }}>
        <h2 className="panel-title">Data retention</h2>
        <div className="form-grid">
          <label>Audit days<input name="auditDays" type="number" min={365} max={3650} defaultValue={retention.auditDays} required /></label>
          <label>Financial record days<input name="financialRecordDays" type="number" min={365} max={3650} defaultValue={retention.financialRecordDays} required /></label>
          <label>Fulfillment body days<input name="fulfillmentBodyDays" type="number" min={0} max={365} defaultValue={retention.fulfillmentBodyDays} required /></label>
          <label>Notification days<input name="notificationDays" type="number" min={7} max={365} defaultValue={retention.notificationDays} required /></label>
        </div>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "retention" ? "Saving…" : "Save retention"}</button>
      </form>
    </div>
    <section className="panel danger-zone">
      <div><h2 className="panel-title">Emergency controls</h2><p className="panel-description">The kill switch pauses agents, credentials, pending payments, automations, and virtual cards.</p></div>
      <button className={organization.killSwitchEnabled ? "secondary-button" : "danger-button"} type="button" disabled={Boolean(busy)} onClick={() => void run("kill-switch", () => request("/api/v1/organization/kill-switch", "POST", { enabled: !organization.killSwitchEnabled, reason: organization.killSwitchEnabled ? "Owner restored operations" : "Owner initiated emergency stop" }), organization.killSwitchEnabled ? "Operations restored." : "Emergency stop activated.")}>{organization.killSwitchEnabled ? "Restore operations" : "Activate kill switch"}</button>
    </section>
    <section className="panel">
      <div className="panel-header"><h2 className="panel-title">Notification endpoints</h2></div>
      {endpoints.length ? <div className="record-list">{endpoints.map((endpoint) => <div className="record-row" key={endpoint.id}><div><div className="record-title">{endpoint.name}</div><div className="record-subtitle">{endpoint.type} · {endpoint.destination}</div></div><span className="status-badge status-settled">{endpoint.status}</span></div>)}</div> : <div className="empty-state"><strong>No endpoints configured</strong><p>Operational events currently remain in the outbox.</p></div>}
    </section>
  </div>;
}
