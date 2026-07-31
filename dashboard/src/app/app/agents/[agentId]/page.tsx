import Link from "next/link";
import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { AgentStatusToggle } from "@/components/agent-status-toggle";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const [{ agentId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const agent = await db.agent.findFirst({
    where: { id: agentId, organizationId: workspace.organization.id },
    include: { accounts: true, effectivePolicy: true },
  });
  if (!agent) notFound();
  const account = agent.accounts[0];
  const networkLabel = account?.network === "hedera:mainnet" ? "Hedera Mainnet" : account?.network === "hedera:testnet" ? "Hedera Testnet" : account?.network ?? "Unknown network";
  return <FormPage title={agent.name} description={agent.description ?? `Policy-controlled ${networkLabel} agent.`}>
    <div className="detail-grid">
      <div><span>Status</span><strong>{agent.status}</strong></div>
      <div><span>Account</span><strong>{account?.accountId ?? "Not connected"}</strong></div>
      <div><span>Network</span><strong>{networkLabel}</strong></div>
      <div><span>Custody</span><strong>{account?.custodyType.replaceAll("_", " ") ?? "Unavailable"}</strong></div>
      <div><span>Signing</span><strong>{account?.signingMode.replaceAll("_", " ") ?? "Unavailable"}</strong></div>
      <div><span>Policy</span><strong>{agent.effectivePolicy ? `Published v${agent.effectivePolicy.version}` : "Not published"}</strong></div>
    </div>
    <div className="button-row">
      <Link className="secondary-button" href={`/app/agents/${agentId}/policy`}>Edit policy</Link>
      <Link className="secondary-button" href={`/app/agents/${agentId}/credentials`}>Credentials</Link>
      <AgentStatusToggle agentId={agent.id} currentStatus={agent.status} />
    </div>
  </FormPage>;
}
