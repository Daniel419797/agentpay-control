import { notFound } from "next/navigation";

import { FormPage } from "@/components/workspace-page";
import { CredentialManager } from "@/components/credential-manager";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function CredentialsPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  const workspace = await currentWorkspace();
  if (!workspace) notFound();
  const agent = await db.agent.findFirst({
    where: { id: agentId, organizationId: workspace.organization.id },
    select: { id: true, name: true },
  });
  if (!agent) notFound();
  const credentials = await db.agentCredential.findMany({
    where: { agentId },
    select: { id: true, label: true, prefix: true, scopes: true, status: true, expiresAt: true, lastUsedAt: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <FormPage title="Agent credentials" description={`Scoped, secret-once API credentials for ${agent.name}.`}>
      <CredentialManager agentId={agentId} existing={credentials} />
    </FormPage>
  );
}
