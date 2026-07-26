import { AutomationOperations } from "@/components/automation-operations";
import { AutomationRuleActions } from "@/components/automation-rule-actions";
import { ContractAllowlistForm } from "@/components/contract-allowlist-form";
import { db } from "@/lib/db";
import { currentWorkspace } from "@/lib/workspace";

export default async function AutomationsPage() {
  const workspace = await currentWorkspace();
  const organizationId = workspace?.organization.id;
  const [rules, agents, assets, contracts, contractNetworks] = organizationId ? await Promise.all([
    db.automationRule.findMany({ where: { organizationId }, include: { agent: { select: { name: true } }, _count: { select: { executions: true } } }, orderBy: { createdAt: "desc" } }),
    db.agent.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.asset.findMany({ where: { verified: true }, select: { id: true, symbol: true, network: true }, orderBy: [{ network: "asc" }, { symbol: "asc" }] }),
    db.contractAllowlistEntry.findMany({ where: { organizationId, active: true }, select: { id: true, name: true, contractAddress: true }, orderBy: { name: "asc" } }),
    db.chainNetwork.findMany({ where: { enabled: true, supportsContracts: true, family: "HEDERA" }, select: { id: true, displayName: true }, orderBy: { displayName: "asc" } }),
  ]) : [[], [], [], [], []];

  return <div className="page">
    <div className="page-heading"><div><h1>Automations</h1><p>Guarded schedules, event triggers, x402 payments, invoices, and allowlisted contract calls.</p></div></div>
    <section className="panel">
      {!rules.length ? <div className="empty-state"><strong>No automation rules</strong><p>Create a draft rule below, review its controls, then activate it.</p></div> : <div className="record-list">{rules.map((rule) => <div className="record-row rule-row" key={rule.id}>
        <div><div className="record-title">{rule.name}</div><div className="record-subtitle">{rule.agent.name} · {rule.triggerType.replaceAll("_", " ")} → {rule.actionType.replaceAll("_", " ")}</div></div>
        <div className="record-aside"><span className="record-meta">{rule._count.executions} executions · {rule.approvalThreshold} approvals</span><span className="status-badge status-settled">{rule.status}</span><AutomationRuleActions ruleId={rule.id} status={rule.status} version={rule.version} triggerType={rule.triggerType} /></div>
      </div>)}</div>}
    </section>
    <AutomationOperations
      agents={agents.map((agent) => ({ id: agent.id, label: agent.name }))}
      assets={assets.map((asset) => ({ id: asset.id, label: `${asset.symbol} · ${asset.network}` }))}
      contracts={contracts.map((contract) => ({ id: contract.id, label: `${contract.name} · ${contract.contractAddress}` }))}
    />
    <ContractAllowlistForm networks={contractNetworks.map((network) => ({ id: network.id, label: network.displayName }))} />
  </div>;
}
