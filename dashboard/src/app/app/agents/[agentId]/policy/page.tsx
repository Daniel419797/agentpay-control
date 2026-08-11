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
  const [catalyst, keriRows] = policy ? await Promise.all([
    loadCatalystPolicyContext(policy.id),
    db.$queryRaw<Array<{ required: boolean; trustedIssuerAids: string[]; allowedSchemaSaids: string[]; maxVerificationAgeSeconds: number }>>`
      SELECT "required","trustedIssuerAids","allowedSchemaSaids","maxVerificationAgeSeconds"
      FROM "KeriPolicyTrust" WHERE "policyVersionId"=${policy.id}::uuid LIMIT 1
    `,
  ]) : [null, []];
  const keri = keriRows[0] ?? null;

  return <FormPage title={`${agent.name} spend policy`} description="Published limits are applied to every paid request before signing.">
    {policy ? <>
      <div className="detail-grid">
        <div><span>Version</span><strong>{policy.version}</strong></div>
        <div><span>Per transaction</span><strong>{formatAtomic(policy.perTransactionLimitAtomic.toString(), policy.asset.decimals)} {policy.asset.symbol}</strong></div>
        <div><span>Hourly limit</span><strong>{policy.hourlyLimitAtomic ? `${formatAtomic(policy.hourlyLimitAtomic.toString(), policy.asset.decimals)} ${policy.asset.symbol}` : "Not set"}</strong></div>
        <div><span>Daily limit</span><strong>{formatAtomic(policy.dailyLimitAtomic.toString(), policy.asset.decimals)} {policy.asset.symbol}</strong></div>
        <div><span>Monthly limit</span><strong>{policy.monthlyLimitAtomic ? `${formatAtomic(policy.monthlyLimitAtomic.toString(), policy.asset.decimals)} ${policy.asset.symbol}` : "Not set"}</strong></div>
        <div><span>Over-limit action</span><strong>{policy.overLimitAction.replaceAll("_", " ")}</strong></div>
        <div><span>Merchant rule</span><strong>{policy.merchantMode.replaceAll("_", " ")}</strong></div>
        <div><span>Allowed hosts</span><strong>{policy.allowedHosts.join(", ") || "Any unless denied"}</strong></div>
        <div><span>Denied hosts</span><strong>{policy.deniedHosts.join(", ") || "None"}</strong></div>
        <div><span>Allowed categories</span><strong>{policy.allowedMerchantCategories.join(", ").replaceAll("_", " ") || "Any"}</strong></div>
        <div><span>Approval threshold</span><strong>{policy.approvalThreshold} approver{policy.approvalThreshold === 1 ? "" : "s"}</strong></div>
        <div><span>Rejection threshold</span><strong>{policy.rejectionThreshold} rejection{policy.rejectionThreshold === 1 ? "" : "s"}</strong></div>
        <div><span>Hourly velocity</span><strong>{policy.maxTransactionsPerHour ?? "Not set"}</strong></div>
        <div><span>Cooldown</span><strong>{policy.cooldownSeconds != null ? `${policy.cooldownSeconds}s` : "Not set"}</strong></div>
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
          <div><span>Minimum verified completions</span><strong>{catalyst?.masumi?.required ? catalyst.masumi.minimumCompletedPurchases : "—"}</strong></div>
          <div><span>Minimum reputation</span><strong>{catalyst?.masumi?.required && catalyst.masumi.minimumReputationBps != null ? `${(catalyst.masumi.minimumReputationBps / 100).toFixed(2)}%` : "—"}</strong></div>
          <div><span>Veridian/KERI</span><strong>{keri?.required ? "Required" : "Disabled"}</strong></div>
          <div><span>KERI max verification age</span><strong>{keri?.required ? `${keri.maxVerificationAgeSeconds}s` : "—"}</strong></div>
          <div><span>Trusted issuer AIDs</span><strong>{keri?.required ? keri.trustedIssuerAids.length : "—"}</strong></div>
          <div><span>Allowed credential schemas</span><strong>{keri?.required ? keri.allowedSchemaSaids.length : "—"}</strong></div>
        </div>
        <p className="form-help">Published policy versions and their Pyth, Masumi, reputation, and KERI extensions are immutable. Publishing below creates a new version and supersedes this one atomically.</p>
      </section>
    </> : <div className="empty-state"><strong>No policy published</strong><p>Publish the first immutable policy version before autonomous spending is allowed.</p></div>}

    <section className="workspace-section">
      <div className="section-heading"><div><h3>{policy ? "Publish a new policy version" : "Publish the first policy version"}</h3><p>All selected controls are attached before the version becomes active.</p></div></div>
      <PolicyPublishForm
        agentId={agentId}
        agentNetwork={agent.network}
        pythEnabled={process.env.PYTH_POLICY_ENABLED === "true"}
        masumiEnabled={process.env.MASUMI_POLICY_ENABLED === "true"}
        masumiEscrowEnabled={process.env.MASUMI_ESCROW_ENABLED === "true"}
        veridianEnabled={process.env.VERIDIAN_IDENTITY_ENABLED === "true"}
      />
    </section>
  </FormPage>;
}
