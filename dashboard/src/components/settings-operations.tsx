"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Member = { id: string; email: string | null; displayName: string; roles: string[]; status: string };
type Endpoint = { id: string; name: string; type: string; destination: string; status: string };
type Retention = { auditDays: number; financialRecordDays: number; fulfillmentBodyDays: number; notificationDays: number };
type Permissions = { isOwner: boolean; canViewMembers: boolean; canViewEndpoints: boolean };
type ApiEnvelope<T = unknown> = { data?: T; detail?: string };

async function request<T = unknown>(path: string, method: string, body?: unknown): Promise<T | undefined> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok) throw new Error(payload.detail ?? "The request could not be completed.");
  return payload.data;
}

export function SettingsOperations({
  organization,
  permissions,
  members,
  endpoints,
  retention,
}: {
  organization: { name: string; timezone: string; slug: string; killSwitchEnabled: boolean };
  permissions: Permissions;
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

  async function toggleKillSwitch() {
    setBusy("kill-switch"); setError(""); setMessage("");
    const enabling = !organization.killSwitchEnabled;
    try {
      const result = await request<{ providerSyncFailures?: number; cardsFrozen?: number; providerSyncStatus?: string }>("/api/v1/organization/kill-switch", "POST", { enabled: enabling, reason: enabling ? "Owner initiated emergency stop" : "Owner restored operations" });
      if (enabling && (result?.providerSyncFailures ?? 0) > 0) {
        setError(`Emergency stop is active locally, but ${result!.providerSyncFailures} provider card freeze operation(s) require immediate manual containment. An urgent incident has been opened.`);
      } else if (enabling) {
        setMessage(`Emergency stop activated${result?.cardsFrozen ? `; ${result.cardsFrozen} card(s) frozen locally and provider synchronization completed` : ""}.`);
      } else {
        setMessage("Emergency stop disabled. Previously frozen cards and revoked credentials remain disabled until explicitly reactivated or reissued.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The emergency-stop operation could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="settings-stack">
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}

    <div className="page-grid">
      {permissions.isOwner ? <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run("organization", async () => { await request("/api/v1/organization", "PATCH", { name: String(form.get("name")).trim(), timezone: String(form.get("timezone")).trim() }); }, "Organization updated.");
      }}>
        <h2 className="panel-title">Organization</h2>
        <label>Name<input name="name" defaultValue={organization.name} minLength={2} maxLength={100} required /></label>
        <label>Timezone<input name="timezone" defaultValue={organization.timezone} maxLength={80} required /></label>
        <label>Slug<input value={organization.slug} readOnly /></label>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "organization" ? "Saving…" : "Save organization"}</button>
      </form> : <section className="panel">
        <h2 className="panel-title">Organization</h2>
        <div className="detail-grid">
          <div><span>Name</span><strong>{organization.name}</strong></div>
          <div><span>Timezone</span><strong>{organization.timezone}</strong></div>
          <div><span>Slug</span><strong>{organization.slug}</strong></div>
        </div>
        <p className="panel-description">Only an Owner can change organization security settings.</p>
      </section>}

      {permissions.isOwner ? <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run("member", async () => { await request("/api/v1/members", "POST", { email: String(form.get("email")).trim(), roles: [String(form.get("role"))] }); }, "Member invitation queued.");
      }}>
        <h2 className="panel-title">Invite member</h2>
        <label>Email<input name="email" type="email" required /></label>
        <label>Role<select name="role"><option value="OPERATOR">Operator</option><option value="APPROVER">Approver</option><option value="VIEWER">Viewer</option><option value="PROVIDER_ADMIN">Provider admin</option><option value="OWNER">Owner</option></select></label>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "member" ? "Inviting…" : "Invite member"}</button>
      </form> : <section className="panel">
        <h2 className="panel-title">Access management</h2>
        <p className="panel-description">Member invitations and role changes require Owner access and recent authentication.</p>
      </section>}
    </div>

    {permissions.canViewMembers && <section className="panel">
      <div className="panel-header"><h2 className="panel-title">Members</h2></div>
      <div className="record-list">{members.map((member) => <div className="record-row" key={member.id}><div><div className="record-title">{member.displayName}</div><div className="record-subtitle">{member.email ?? "Wallet operator"} · {member.roles.join(", ")}</div></div><div className="rule-actions"><span className="status-badge status-settled">{member.status}</span>{permissions.isOwner && member.status === "ACTIVE" && <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => void run(`member:${member.id}`, async () => { await request(`/api/v1/members/${member.id}`, "PATCH", { status: "SUSPENDED" }); }, "Member suspended.")}>Suspend</button>}</div></div>)}</div>
    </section>}

    <div className="page-grid">
      {permissions.isOwner ? <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void run("endpoint", async () => { await request("/api/v1/notification-endpoints", "POST", { name: String(form.get("name")).trim(), type: String(form.get("type")), destination: String(form.get("destination")).trim(), eventTypes: String(form.get("eventTypes")).split(",").map((value) => value.trim()).filter(Boolean) }); }, "Notification endpoint created.");
      }}>
        <h2 className="panel-title">Notification endpoint</h2>
        <label>Name<input name="name" minLength={2} required /></label>
        <label>Channel<select name="type"><option value="EMAIL">Email</option><option value="WEBHOOK">Webhook</option><option value="SLACK">Slack</option></select></label>
        <label>Destination<input name="destination" required autoComplete="off" /></label>
        <label>Events<input name="eventTypes" defaultValue="*" required /></label>
        <p className="form-help">Webhook and Slack URLs are stored for delivery but never displayed again after creation.</p>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "endpoint" ? "Creating…" : "Create endpoint"}</button>
      </form> : <section className="panel">
        <h2 className="panel-title">Notifications</h2>
        <p className="panel-description">Only an Owner can add delivery destinations. Credential-bearing webhook URLs are redacted after creation.</p>
      </section>}

      {permissions.isOwner ? <form className="panel app-form" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const number = (name: string) => Number(form.get(name));
        void run("retention", async () => { await request("/api/v1/organization/retention", "PUT", { auditDays: number("auditDays"), financialRecordDays: number("financialRecordDays"), fulfillmentBodyDays: number("fulfillmentBodyDays"), notificationDays: number("notificationDays") }); }, "Retention policy updated.");
      }}>
        <h2 className="panel-title">Data retention</h2>
        <div className="form-grid">
          <label>Audit days<input name="auditDays" type="number" min={365} max={3650} defaultValue={retention.auditDays} required /></label>
          <label>Financial record days<input name="financialRecordDays" type="number" min={365} max={3650} defaultValue={retention.financialRecordDays} required /></label>
          <label>Fulfillment body days<input name="fulfillmentBodyDays" type="number" min={0} max={365} defaultValue={retention.fulfillmentBodyDays} required /></label>
          <label>Notification days<input name="notificationDays" type="number" min={7} max={365} defaultValue={retention.notificationDays} required /></label>
        </div>
        <p className="form-help">Changing retention rules requires recent authentication. Immutable audit-chain records are retained even when payload retention windows expire.</p>
        <button className="secondary-button" disabled={Boolean(busy)}>{busy === "retention" ? "Saving…" : "Save retention"}</button>
      </form> : <section className="panel">
        <h2 className="panel-title">Data retention</h2>
        <div className="detail-grid">
          <div><span>Audit</span><strong>{retention.auditDays} days</strong></div>
          <div><span>Financial</span><strong>{retention.financialRecordDays} days</strong></div>
          <div><span>Fulfillment body</span><strong>{retention.fulfillmentBodyDays} days</strong></div>
          <div><span>Notifications</span><strong>{retention.notificationDays} days</strong></div>
        </div>
      </section>}
    </div>

    <section className="panel danger-zone">
      <div><h2 className="panel-title">Emergency controls</h2><p className="panel-description">The emergency stop blocks new autonomous payments, cross-chain transaction exports, fiat transfers, card issuance/reactivation, and automation side effects while reconciliation remains active. Provider containment failures are escalated and must be handled immediately.</p></div>
      {permissions.isOwner ? <button className={organization.killSwitchEnabled ? "secondary-button" : "danger-button"} type="button" disabled={Boolean(busy)} onClick={() => void toggleKillSwitch()}>{busy === "kill-switch" ? "Applying…" : organization.killSwitchEnabled ? "Disable emergency stop" : "Activate emergency stop"}</button> : <span className={`status-badge ${organization.killSwitchEnabled ? "status-error" : "status-settled"}`}>{organization.killSwitchEnabled ? "STOP ACTIVE" : "OPERATING"}</span>}
    </section>

    {permissions.canViewEndpoints && <section className="panel">
      <div className="panel-header"><h2 className="panel-title">Notification endpoints</h2></div>
      {endpoints.length ? <div className="record-list">{endpoints.map((endpoint) => <div className="record-row" key={endpoint.id}><div><div className="record-title">{endpoint.name}</div><div className="record-subtitle">{endpoint.type} · {endpoint.destination}</div></div><span className="status-badge status-settled">{endpoint.status}</span></div>)}</div> : <div className="empty-state"><strong>No endpoints configured</strong><p>Operational events remain in the outbox until a delivery endpoint is configured.</p></div>}
    </section>}
  </div>;
}
