import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

export default async function PolicyPage({ params }: { params: Promise<{ agentId: string }> }) {
  const [{ agentId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const agent = await db.agent.findFirst({
    where: { id: agentId, organizationId: workspace.organization.id },
    include: { effectivePolicy: { include: { asset: true } } },
  });
  if (!agent) notFound();
  const policy = agent.effectivePolicy;
  return <FormPage title={`${agent.name} spend policy`} description="Published limits are applied to every paid request before signing.">
    {policy ? <div className="detail-grid">
      <div><span>Version</span><strong>{policy.version}</strong></div>
      <div><span>Per transaction</span><strong>{formatAtomic(policy.perTransactionLimitAtomic.toString(), policy.asset.decimals)} {policy.asset.symbol}</strong></div>
      <div><span>Daily limit</span><strong>{formatAtomic(policy.dailyLimitAtomic.toString(), policy.asset.decimals)} {policy.asset.symbol}</strong></div>
      <div><span>Over-limit action</span><strong>{policy.overLimitAction.replaceAll("_", " ")}</strong></div>
      <div><span>Merchant rule</span><strong>{policy.merchantMode.replaceAll("_", " ")}</strong></div>
      <div><span>Denied hosts</span><strong>{policy.deniedHosts.join(", ") || "None"}</strong></div>
    </div> : <div className="empty-state"><strong>No policy published</strong><p>Publish a policy before this agent can create x402 payment intents.</p></div>}
  </FormPage>;
}
