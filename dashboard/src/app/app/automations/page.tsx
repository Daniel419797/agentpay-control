import { AutomationOperations } from "@/components/automation-operations";
import { AutomationRuleActions } from "@/components/automation-rule-actions";
import { ContractAllowlistForm } from "@/components/contract-allowlist-form";
import { db } from "@/lib/db";
import { currentWorkspace, workspaceHasRole } from "@/lib/workspace";

export default async function AutomationsPage() {
  const workspace = await currentWorkspace();
  const organizationId = workspace?.organization.id;
  const canCreate = Boolean(workspace && workspaceHasRole(workspace, ["OWNER", "OPERATOR"]));
  const canManage = Boolean(workspace && workspaceHasRole(workspace, ["OWNER"]));
  const canExecute = Boolean(workspace && workspaceHasRole(workspace, ["OWNER", "OPERATOR"]));
  const [rules, agents, assets, contracts, contractNetworks] = organizationId ? await Promise.all([
    db.automationRule.findMany({ where: { organizationId }, include: { agent: { select: { name: true } }, _count: { select: { executions: true } } }, orderBy: { createdAt: "desc" } }),
    canCreate ? db.agent.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canCreate ? db.asset.findMany({ where: { verified: true }, select: { id: true, symbol: true, network: true }, orderBy: [{ network: "asc" }, { symbol: "asc" }] }) : Promise.resolve([]),
    canCreate ? db.contractAllowlistEntry.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, contractAddress: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canManage ? db.chainNetwork.findMany({ where: { enabled: true, supportsContracts: true, family: "HEDERA" }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }) : Promise.resolve([]),
  ]) : [[], [], [], [], []];

  return <div className="page">
    <div className="page-heading"><div><h1>Automations</h1><p>Guarded schedules, event triggers, x402 payments, invoices, and allowlisted contract calls.</p></div></div>
    <section className="panel">
      {!rules.length ? <div className="empty-state"><strong>No automation rules</strong><p>{canCreate ? "Create a draft rule below, review its controls, then have an Owner activate it." : "No autonomous rules are configured for this workspace."}</p></div> : <div className="record-list">{rules.map((rule) => <div className="record-row rule-row" key={rule.id}>
        <div><div className="record-title">{rule.name}</div><div className="record-subtitle">{rule.agent.name} · {rule.triggerType.replaceAll("_", " ")} → {rule.actionType.replaceAll("_", " ")}</div></div>
        <div className="record-aside"><span className="record-meta">{rule._count.executions} executions · {rule.approvalThreshold} approvals</span><span className="status-badge status-settled">{rule.status}</span><AutomationRuleActions ruleId={rule.id} status={rule.status} version={rule.version} triggerType={rule.triggerType} canManage={canManage} canExecute={canExecute} /></div>
      </div>)}</div>}
    </section>
    {canCreate ? <AutomationOperations
      agents={agents.map((agent) => ({ id: agent.id, label: agent.name }))}
      assets={assets.map((asset) => ({ id: asset.id, label: `${asset.symbol} · ${asset.network}` }))}
      contracts={contracts.map((contract) => ({ id: contract.id, label: `${contract.name} · ${contract.contractAddress}` }))}
    /> : <section className="panel section-gap"><h2 className="panel-title">Automation changes</h2><p className="panel-description">Creating or manually running automation requires Owner or Operator access. Activation and contract execution authority require an Owner.</p></section>}
    {canManage && <ContractAllowlistForm networks={contractNetworks.map((network) => ({ id: network.id, label: network.displayName }))} />}
  </div>;
}
