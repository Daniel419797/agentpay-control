import Link from "next/link";
import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { AgentStatusToggle } from "@/components/agent-status-toggle";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

function networkLabel(network?: string) {
  if (network === "hedera:mainnet") return "Hedera Mainnet";
  if (network === "hedera:testnet") return "Hedera Testnet";
  if (network === "eip155:5042002") return "Arc Testnet";
  if (network === "cardano:preprod") return "Cardano Preprod";
  if (network === "cardano:mainnet") return "Cardano Mainnet";
  return network ?? "Unknown network";
}

export default async function AgentPage({ params }: { params: Promise<{ agentId: string }> }) {
  const [{ agentId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const agent = await db.agent.findFirst({
    where: { id: agentId, organizationId: workspace.organization.id },
    include: { accounts: true, effectivePolicy: true },
  });
  if (!agent) notFound();
  const account = agent.accounts[0];
  const label = networkLabel(account?.network);
  return <FormPage title={agent.name} description={agent.description ?? `Policy-controlled ${label} agent.`}>
    <div className="detail-grid">
      <div><span>Status</span><strong>{agent.status}</strong></div>
      <div><span>Account</span><strong>{account?.accountId ?? "Not connected"}</strong></div>
      <div><span>Network</span><strong>{label}</strong></div>
      <div><span>Custody</span><strong>{account?.custodyType.replaceAll("_", " ") ?? "Unavailable"}</strong></div>
      <div><span>Signing</span><strong>{account?.signingMode.replaceAll("_", " ") ?? "Unavailable"}</strong></div>
      <div><span>Policy</span><strong>{agent.effectivePolicy ? `Published v${agent.effectivePolicy.version}` : "Not published"}</strong></div>
    </div>
    <div className="button-row">
      <Link className="primary-button" href={`/app/agents/${agentId}/integrations`}>AI connections</Link>
      <Link className="secondary-button" href={`/app/agents/${agentId}/pay` as never}>Send payment</Link>
      <Link className="secondary-button" href={`/app/agents/${agentId}/policy`}>Edit policy</Link>
      <Link className="secondary-button" href={`/app/agents/${agentId}/credentials`}>Credentials</Link>
      <AgentStatusToggle agentId={agent.id} currentStatus={agent.status} />
    </div>
  </FormPage>;
}
