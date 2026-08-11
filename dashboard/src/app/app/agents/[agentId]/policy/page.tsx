import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { PolicyPublishForm } from "@/components/policy-publish-form";
import { loadCatalystPolicyContext } from "@/domain/catalyst-policy";
import { db } from "@/lib/db";
import { formatAtomic } from "@/lib/format";
import { currentWorkspace } from "@/lib/workspace";

function formatUsdMicros(value: bigint | null) {
  if (value == null) return "Not set";
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `$${whole}${fraction ? `.${fraction}` : ""}`;
}

export default async function PolicyPage({ params }: { params: Promise<{ agentId: string }> }) {
  const [{ agentId }, workspace] = await Promise.all([params, currentWorkspace()]);
  if (!workspace) notFound();
  const agent = await db.agent.findFirst({
    where: { id: agentId, organizationId: workspace.organization.id },
    include: { effectivePolicy: { include: { asset: true } } },
  });
  if (!agent) notFound();
  const policy = agent.effectivePolicy;
  const catalyst = policy ? await loadCatalystPolicyContext(policy.id) : null;

  return <FormPage title={`${agent.name} spend policy`} description="Published limits are applied to every paid request before signing.">
    {policy ? <>
      <div className="detail-grid">
        <div><span>Version</span><strong>{policy.version}</strong></div>
        <div><span>Per transaction</span><strong>{formatAtomic(policy.perTransactionLimitAtomic.toString(), policy.asset.decimals)} {policy.asset.symbol}</strong></div>
        <div><span>Daily limit</span><strong>{formatAtomic(policy.dailyLimitAtomic.toString(), policy.asset.decimals)} {policy.asset.symbol}</strong></div>
        <div><span>Over-limit action</span><strong>{policy.overLimitAction.replaceAll("_", " ")}</strong></div>
        <div><span>Merchant rule</span><strong>{policy.merchantMode.replaceAll("_", " ")}</strong></div>
        <div><span>Denied hosts</span><strong>{policy.deniedHosts.join(", ") || "None"}</strong></div>
        <div><span>Approval threshold</span><strong>{policy.approvalThreshold} approver{policy.approvalThreshold === 1 ? "" : "s"}</strong></div>
        <div><span>Rejection threshold</span><strong>{policy.rejectionThreshold} rejection{policy.rejectionThreshold === 1 ? "" : "s"}</strong></div>
      </div>
      <section className="workspace-section">
        <div className="section-heading"><div><h3>Catalyst payment controls</h3><p>External trust can only make this published policy more restrictive.</p></div></div>
        <div className="detail-grid">
          <div><span>Pyth USD policy</span><strong>{catalyst?.oracle ? "Enabled" : "Disabled"}</strong></div>
          <div><span>USD per transaction</span><strong>{catalyst?.oracle ? formatUsdMicros(catalyst.oracle.perTransactionUsdMicros) : "—"}</strong></div>
          <div><span>USD daily limit</span><strong>{catalyst?.oracle ? formatUsdMicros(catalyst.oracle.dailyUsdMicros) : "—"}</strong></div>
          <div><span>Pyth max price age</span><strong>{catalyst?.oracle ? `${catalyst.oracle.maxPriceAgeSeconds}s` : "—"}</strong></div>
          <div><span>Masumi trust</span><strong>{catalyst?.masumi?.required ? "Required" : "Disabled"}</strong></div>
          <div><span>Masumi network</span><strong>{catalyst?.masumi?.required ? catalyst.masumi.network : "—"}</strong></div>
          <div><span>Allowed Masumi identities</span><strong>{catalyst?.masumi?.allowedAgentIdentifiers.length ? catalyst.masumi.allowedAgentIdentifiers.length : catalyst?.masumi?.required ? "Any verified identity" : "—"}</strong></div>
          <div><span>Allowed capabilities</span><strong>{catalyst?.masumi?.allowedCapabilities.join(", ") || (catalyst?.masumi?.required ? "Any" : "—")}</strong></div>
        </div>
        <p className="form-help">Published policy versions and their Pyth/Masumi extensions are immutable. Publish a new version to change them.</p>
      </section>
    </> : <PolicyPublishForm
      agentId={agentId}
      agentNetwork={agent.network}
      pythEnabled={process.env.PYTH_POLICY_ENABLED === "true"}
      masumiEnabled={process.env.MASUMI_POLICY_ENABLED === "true"}
    />}
  </FormPage>;
}