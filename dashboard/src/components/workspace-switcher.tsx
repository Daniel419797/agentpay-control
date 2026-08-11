"use client";

import { useEffect, useState } from "react";

type Workspace = {
  id: string;
  name: string;
  slug: string;
  roles: string[];
  killSwitchEnabled: boolean;
};

export function WorkspaceSwitcher({ compact = false }: { compact?: boolean }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeId, setActiveId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    void Promise.all([
      fetch("/api/v1/workspaces", { cache: "no-store" }),
      fetch("/api/v1/session", { cache: "no-store" }),
    ]).then(async ([workspacesResponse, sessionResponse]) => {
      if (!workspacesResponse.ok || !sessionResponse.ok) throw new Error("Workspace context could not be loaded.");
      const workspaceBody = await workspacesResponse.json() as { data?: Workspace[] };
      const sessionBody = await sessionResponse.json() as { data?: { activeOrganization?: { id?: string } } };
      if (!mounted) return;
      const rows = workspaceBody.data ?? [];
      setWorkspaces(rows);
      const sessionId = sessionBody.data?.activeOrganization?.id;
      setActiveId(rows.some((workspace) => workspace.id === sessionId) ? sessionId! : rows[0]?.id ?? "");
    }).catch(() => {
      if (mounted) setError("Workspace unavailable");
    });
    return () => { mounted = false; };
  }, []);

  async function switchWorkspace(organizationId: string) {
    if (!organizationId || organizationId === activeId || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/v1/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { detail?: string } | null;
        throw new Error(body?.detail ?? "Workspace switch failed.");
      }
      setActiveId(organizationId);
      window.location.assign("/app/overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Workspace switch failed.");
      setBusy(false);
    }
  }

  if (error) return <span className="context-value" title={error}>{error}</span>;
  if (!workspaces.length) return <span className="context-value">Loading…</span>;
  if (workspaces.length === 1) {
    const workspace = workspaces[0]!;
    return <span className="context-value" title={workspace.slug}>{workspace.name}</span>;
  }

  return (
    <select
      aria-label="Active workspace"
      className={compact ? "network-switcher-trigger" : "form-input"}
      value={activeId}
      disabled={busy}
      onChange={(event) => void switchWorkspace(event.target.value)}
      title="Switch active organization"
    >
      {workspaces.map((workspace) => (
        <option key={workspace.id} value={workspace.id}>
          {workspace.name}{workspace.killSwitchEnabled ? " · stopped" : ""}
        </option>
      ))}
    </select>
  );
}
