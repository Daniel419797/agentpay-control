import { InvoiceCreateForm } from "@/components/invoice-create-form";
import { FormPage } from "@/components/workspace-page";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function NewInvoicePage() {
  const workspace = await currentWorkspace();
  const organizationId = workspace?.organization.id;
  const [agents, assets] = organizationId ? await Promise.all([
    db.agent.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.asset.findMany({ where: { verified: true }, select: { id: true, symbol: true, network: true }, orderBy: [{ network: "asc" }, { symbol: "asc" }] }),
  ]) : [[], []];

  return <FormPage title="Create invoice" description="Create an agent-to-agent invoice with an exact, policy-controlled settlement amount.">
    <InvoiceCreateForm
      issuerAgents={agents.map((agent) => ({ id: agent.id, label: agent.name }))}
      assets={assets.map((asset) => ({ id: asset.id, label: `${asset.symbol} · ${asset.network}` }))}
    />
  </FormPage>;
}
