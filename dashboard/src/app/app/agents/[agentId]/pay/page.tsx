import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { MasumiEscrowPanel } from "@/components/masumi-escrow-panel";
import { PaidRequestForm } from "@/components/paid-request-form";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function PaidRequestPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const workspace = await currentWorkspace();
  if (!workspace) notFound();

  const agent = await db.agent.findFirst({
    where: { id: agentId, organizationId: workspace.organization.id },
    select: { id: true, name: true, status: true },
  });
  if (!agent) notFound();

  const agents = await db.agent.findMany({
    where: { organizationId: workspace.organization.id, status: { not: "ARCHIVED" } },
    select: {
      id: true,
      name: true,
      status: true,
      network: true,
      accounts: {
        where: { status: "ACTIVE" },
        select: { network: true, custodyType: true, signingMode: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
  const roles = workspace.membership.roles;

  return (
    <FormPage title="Send paid request" description={`Create a policy-controlled payment from ${agent.name}.`}>
      <section className="workspace-section">
        <div className="section-heading"><div><h3>Direct x402</h3><p>Pay a registered x402 resource directly under the agent&apos;s active policy.</p></div></div>
        <PaidRequestForm agents={agents} defaultAgentId={agentId} />
      </section>
      {process.env.MASUMI_ESCROW_ENABLED === "true" && <MasumiEscrowPanel
        agents={agents.map(({ id, name, status, network }) => ({ id, name, status, network }))}
        defaultAgentId={agentId}
        canOperate={roles.includes("OWNER") || roles.includes("OPERATOR")}
        canAuthorizeRefund={roles.includes("OWNER") || roles.includes("PROVIDER_ADMIN")}
      />}
    </FormPage>
  );
}
