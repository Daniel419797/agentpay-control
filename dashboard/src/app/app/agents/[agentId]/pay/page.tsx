import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
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

  return (
    <FormPage title="Send paid request" description={`Create a policy-controlled x402 request from ${agent.name}.`}>
      <PaidRequestForm agents={agents} defaultAgentId={agentId} />
    </FormPage>
  );
}
