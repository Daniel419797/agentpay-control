import { CreditCard, Landmark } from "lucide-react";
import { CardOperations } from "@/components/card-operations";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { currentWorkspace, workspaceHasRole } from "@/lib/workspace";

function Empty({ text }: { text: string }) { return <div className="empty-state"><strong>Nothing to show</strong><p>{text}</p></div>; }
function statusClass(status: string) { return ["ACTIVE", "SUCCEEDED", "APPROVED"].includes(status) ? "status-settled" : ["PENDING", "PROCESSING", "SUBMISSION_UNKNOWN", "FROZEN"].includes(status) ? "status-approval" : "status-error"; }

export default async function CardsPage() {
  const workspace = await currentWorkspace();
  const organizationId = workspace?.organization.id;
  const canOperate = Boolean(workspace && workspaceHasRole(workspace, ["OWNER", "OPERATOR"]));
  const canOpenFiatAccount = Boolean(workspace && workspaceHasRole(workspace, ["OWNER"]));
  const config = getConfig();
  const [cards, accounts, authorizations, agents, cardholders, transfers] = organizationId ? await Promise.all([
    db.virtualCard.findMany({ where: { organizationId }, include: { agent: { select: { name: true } } }, orderBy: { createdAt: "desc" } }),
    db.fiatAccount.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" } }),
    db.cardAuthorization.findMany({ where: { organizationId }, include: { virtualCard: { include: { agent: { select: { name: true } } } } }, orderBy: { requestedAt: "desc" }, take: 20 }),
    canOperate ? db.agent.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    canOperate ? db.cardholderProfile.findMany({ where: { organizationId, status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    db.fiatTransfer.findMany({ where: { organizationId }, orderBy: { createdAt: "desc" }, take: 20 }),
  ]) : [[], [], [], [], [], []];
  const providerLabel = config.VIRTUAL_CARDS_ENABLED ? `${config.CARD_PROVIDER} enabled` : `${config.CARD_PROVIDER} configured · live rail disabled`;
  return <div className="page"><div className="page-heading"><div><h1>Cards & fiat</h1><p>Controlled virtual cards and fiat movement with provider-backed state, step-up protection, and reconciliation.</p></div><span className={`status-badge ${config.VIRTUAL_CARDS_ENABLED ? "status-settled" : "status-approval"}`}>{providerLabel}</span></div>
    {config.CARD_PROVIDER === "SANDBOX" && <div className="inline-notice" role="note"><strong>Sandbox provider.</strong> Card and fiat actions on this environment are test fixtures, not live financial products. Production configuration cannot enable live card/fiat flags with the sandbox provider.</div>}
    <div className="compact-metrics"><div><CreditCard size={17} aria-hidden="true"/><span>Active cards</span><strong>{cards.filter((card) => card.status === "ACTIVE").length}</strong></div><div><Landmark size={17} aria-hidden="true"/><span>Fiat accounts</span><strong>{accounts.length}</strong></div><div><span>Recent authorizations</span><strong>{authorizations.length}</strong></div></div>
    {canOperate ? <CardOperations
      enabled={config.VIRTUAL_CARDS_ENABLED}
      provider={config.CARD_PROVIDER}
      canOpenFiatAccount={canOpenFiatAccount}
      agents={agents.map((agent) => ({ id: agent.id, label: agent.name }))}
      cardholders={cardholders.map((cardholder) => ({ id: cardholder.id, label: cardholder.name }))}
      cards={cards.map((card) => ({ id: card.id, label: card.nickname ?? `•••• ${card.last4}`, status: card.status, version: card.version }))}
      fiatAccounts={accounts.map((account) => ({ id: account.id, label: `${account.currency} · ${account.status}`, currency: account.currency, status: account.status }))}
    /> : <section className="panel section-gap"><h2 className="panel-title">Financial operations</h2><p className="panel-description">This role has read-only access. Cardholder PII and card/fiat mutation controls are available only to authorized Owner/Operator roles; opening a fiat account requires an Owner.</p></section>}
    <div className="page-grid"><section className="panel"><div className="panel-header"><h2 className="panel-title">Virtual cards</h2></div>{cards.length ? <div className="record-list">{cards.map((card) => <div className="record-row" key={card.id}><div><div className="record-title">{card.nickname ?? `${card.brand ?? "Virtual"} •••• ${card.last4}`}</div><div className="record-subtitle">{card.agent.name} · {card.currency}</div></div><div className="record-aside"><span className="record-meta">{card.spendingLimitMinor ? `${card.spendingLimitMinor} ${card.currency} minor units` : "Policy limits"}</span><span className={`status-badge ${statusClass(card.status)}`}>{card.status}</span></div></div>)}</div> : <Empty text="No virtual cards have been issued." />}</section>
      <section className="panel"><div className="panel-header"><h2 className="panel-title">Fiat accounts</h2></div>{accounts.length ? <div className="record-list">{accounts.map((account) => <div className="record-row" key={account.id}><div><div className="record-title">{account.currency} operating account</div><div className="record-subtitle">{account.provider} fiat rail</div></div><div className="record-aside"><span className="record-meta">{account.availableMinor.toString()} available · {account.pendingMinor.toString()} pending (minor units)</span><span className={`status-badge ${statusClass(account.status)}`}>{account.status}</span></div></div>)}</div> : <Empty text="No fiat accounts are connected." />}</section></div>
    <section className="panel section-gap"><div className="panel-header"><h2 className="panel-title">Fiat transfers</h2></div>{transfers.length ? <div className="record-list">{transfers.map((transfer) => <div className="record-row" key={transfer.id}><div><div className="record-title">{transfer.direction} · {transfer.amountMinor.toString()} {transfer.currency} minor units</div><div className="record-subtitle">{transfer.description ?? "Fiat movement"} · {transfer.createdAt.toLocaleString()}</div></div><span className={`status-badge ${statusClass(transfer.status)}`}>{transfer.status.replaceAll("_", " ")}</span></div>)}</div> : <Empty text="No fiat transfers have been submitted." />}</section>
    <section className="panel section-gap"><div className="panel-header"><h2 className="panel-title">Authorization activity</h2></div>{authorizations.length ? <><div className="table-wrap"><table className="data-table"><thead><tr><th>Card / agent</th><th>Merchant</th><th>Amount</th><th>Decision</th><th>Requested</th></tr></thead><tbody>{authorizations.map((row) => <tr key={row.id}><td><div className="cell-primary">•••• {row.virtualCard.last4}</div><div className="cell-secondary">{row.virtualCard.agent.name}</div></td><td>{row.merchantName ?? "Unknown merchant"}<div className="cell-secondary">{row.merchantCategory ?? "Uncategorized"}</div></td><td>{row.amountMinor.toString()} {row.currency} minor</td><td><span className={`status-badge ${statusClass(row.status)}`}>{row.status}</span></td><td>{row.requestedAt.toLocaleString()}</td></tr>)}</tbody></table></div><div className="transaction-mobile" aria-label="Recent card authorizations">{authorizations.map((row) => <article className="transaction-card" key={`mobile-${row.id}`}><div className="transaction-top"><div><div className="transaction-resource">{row.merchantName ?? "Unknown merchant"}</div><div className="transaction-meta">•••• {row.virtualCard.last4} · {row.virtualCard.agent.name}</div></div><div className="transaction-amount">{row.amountMinor.toString()} {row.currency}</div></div><div className="transaction-bottom"><span className={`status-badge ${statusClass(row.status)}`}>{row.status}</span><span className="transaction-meta">{row.requestedAt.toLocaleString()}</span></div><div className="transaction-meta">{row.merchantCategory ?? "Uncategorized"} · minor units</div></article>)}</div></> : <Empty text="Card authorizations will appear here." />}</section>
  </div>;
}
