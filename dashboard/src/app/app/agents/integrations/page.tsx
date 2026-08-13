import Link from "next/link";
import { redirect } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function IntegrationsDirectoryPage() {
  const workspace = await currentWorkspace();
  if (!workspace) redirect("/sign-in");
  const agents = await db.agent.findMany({
    where: { organizationId: workspace.organization.id, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
  });

  return <FormPage title="AI integrations" description="Choose an AgentPay agent to configure Claude Code, Codex, Cursor, MCP, LangChain, or a custom client.">
    {agents.length ? <div className="record-list">
      {agents.map((agent) => <div className="record-row" key={agent.id} style={{ justifyContent: "space-between", gap: 16, alignItems: "center" }}>
        <div><div className="record-title">{agent.name}</div><div className="record-subtitle">{agent.network} · {agent.status}</div></div>
        <Link className="primary-button" href={`/app/agents/${agent.id}/integrations`}>Configure</Link>
      </div>)}
    </div> : <div className="empty-state"><strong>No agents yet</strong><p>Create an AgentPay agent first.</p></div>}
    <div className="button-row" style={{ marginTop: 16 }}><Link className="secondary-button" href="/app/agents/new">Create agent</Link></div>
  </FormPage>;
}
